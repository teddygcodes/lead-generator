/**
 * sync-permits.ts
 *
 * Full permit ingest, match, and scoring sync job.
 * Fetches from all 6 configured sources in parallel, upserts permits,
 * matches or creates companies, updates denormalized permit fields, and rescores.
 */

import { accelaAdapter } from '@/lib/permits/accela'
import { accelaAcaAdapter } from '@/lib/permits/accela-aca'
import { fetchDekalbPermits } from '@/lib/permits/dekalb'
import { fetchCherokeePermits } from '@/lib/permits/cherokee'
import { fetchCobbPermits } from '@/lib/permits/cobb'
import type { NormalizedPermit } from '@/lib/permits/base'
import { scoreCompany } from '@/lib/scoring'
import { normalizeName, normalizePhone } from '@/lib/normalization'
import { db } from '@/lib/db'

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface SyncSummary {
  sources: { name: string; fetched: number; failed: boolean }[]
  totalFetched: number
  newPermits: number
  updatedPermits: number
  companiesMatched: number
  newCompaniesCreated: number
  enrichmentQueued: number
  errors: string[]
}

// ---------------------------------------------------------------------------
// Source registry — all permit data sources with their county groupings
// ---------------------------------------------------------------------------

type SourceEntry = { name: string; fetch: () => Promise<NormalizedPermit[]> }

const ALL_SOURCES: SourceEntry[] = [
  { name: 'ACCELA_GWINNETT', fetch: () => accelaAdapter('GWINNETT_COUNTY') },  // REST API (inactive — returns [] until county authorizes our app)
  { name: 'ACCELA_HALLCO',   fetch: () => accelaAdapter('HALL_COUNTY') },
  { name: 'ACCELA_ATLANTA',  fetch: () => accelaAdapter('ATLANTA_GA') },
  { name: 'ACA_ATLANTA',     fetch: () => accelaAcaAdapter('ATLANTA_GA') },     // HTML scraper via ACA citizen portal (active)
  { name: 'ACA_GWINNETT',    fetch: () => accelaAcaAdapter('GWINNETT') },
  { name: 'ACA_HALLCO',      fetch: () => accelaAcaAdapter('HALLCO') },
  { name: 'ARCGIS_DEKALB',   fetch: () => fetchDekalbPermits() },               // ArcGIS FeatureServer REST API (public, no auth required)
  { name: 'CHEROKEE_HTML',   fetch: () => fetchCherokeePermits() },             // Cherokee County PHP portal HTML scraper
  { name: 'ACA_COBB',       fetch: () => fetchCobbPermits() },                  // Cobb County ACA portal scraper (requires COBB_ACA_USERNAME + COBB_ACA_PASSWORD)
  // EnerGov (Forsyth, Jackson) removed — API returns no contractor name so permits
  // can never be matched to companies or affect scoring. Re-add if contractor detail
  // endpoint becomes available.
]

const COUNTY_SOURCE_NAMES: Record<string, string[]> = {
  Gwinnett: ['ACCELA_GWINNETT', 'ACA_GWINNETT'],
  Hall:     ['ACCELA_HALLCO',   'ACA_HALLCO'],
  Fulton:   ['ACCELA_ATLANTA',  'ACA_ATLANTA'],  // Atlanta is a city in Fulton County
  DeKalb:   ['ARCGIS_DEKALB'],
  Cherokee: ['CHEROKEE_HTML'],
  Cobb:     ['ACA_COBB'],
}

/** Valid county values accepted by the sync API route. */
export const VALID_COUNTIES = Object.keys(COUNTY_SOURCE_NAMES)

// ---------------------------------------------------------------------------
// Keywords used to qualify new-company creation from unmatched permits
// ---------------------------------------------------------------------------

const QUALIFYING_KEYWORDS = [
  'Electric',
  'Electrical',
  'Power',
  'Systems',
  'Service',
  'Contracting',
  'Contractors',
  'Construction',
  'Industrial',
  'Mechanical',
  'Controls',
  'Technologies',
]

// ---------------------------------------------------------------------------
// Company matching helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a company name for fuzzy matching.
 * Strips legal suffixes (LLC, Inc) and common descriptor words (Electric, Power, etc.).
 * Falls back to legal-suffix-only stripping if full stripping yields fewer than 2 characters,
 * preventing names like "Power Solutions Group" from collapsing to "" and matching everything.
 */
export function normalizeForMatch(name: string): string {
  const LEGAL_SUFFIXES = ['llc', 'inc', 'corp', 'co', 'ltd']
  const DESCRIPTOR_SUFFIXES = [
    'electric', 'electrical', 'power', 'systems', 'services',
    'solutions', 'contractors', 'group',
  ]
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
  const strip = (s: string, words: string[]) => {
    for (const w of words) s = s.replace(new RegExp(`\\b${w}\\b`, 'g'), '')
    return s.replace(/\s+/g, ' ').trim()
  }

  const full = strip(clean(name), [...LEGAL_SUFFIXES, ...DESCRIPTOR_SUFFIXES])

  // Fall back to legal-suffix-only strip if the result is too degraded to match reliably:
  //   - ≤1 word total  → e.g. "Strada Services LLC"  → "strada"  (too generic)
  //   - no word ≥2 chars → e.g. "T & D Electric Inc" → "t d"     (initials only, false-matches)
  const fullWords = full.split(' ').filter(Boolean)
  const hasSubstantiveWord = fullWords.some(w => w.length >= 2)
  if (fullWords.length >= 2 && hasSubstantiveWord) return full
  return strip(clean(name), LEGAL_SUFFIXES)
}

/**
 * Score the similarity between two pre-normalized names.
 * Returns 1.0 for exact match, 0.85 for word-set containment, 0.75 for 3-word trigram overlap, 0 otherwise.
 * Returns 0 if either string is empty — prevents spurious matches when normalization over-strips.
 *
 * The containment check uses WORD-SET matching (not character substring) to prevent short tokens
 * like "ces" from matching inside "servi-ces" at the character level.
 * e.g. "smith electrical" ⊆ {"smith","electrical","services"} → 0.85  ✓
 *      "ces"              ⊄ {"brown","electrical","services"}  → 0      ✓
 */
export function matchScore(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1.0

  // Word-set containment: all words of one name must exist (as whole words) in the other
  const wordsA = a.split(' ').filter(Boolean)
  const wordsB = b.split(' ').filter(Boolean)
  const setA = new Set(wordsA)
  const setB = new Set(wordsB)
  const bInA = wordsB.every(w => setA.has(w))
  const aInB = wordsA.every(w => setB.has(w))
  if (bInA || aInB) return 0.85

  // 3-word trigram overlap (word-joined trigrams, character-compared against joined target)
  const joinedB = wordsB.join(' ')
  for (let i = 0; i <= wordsA.length - 3; i++) {
    const trigram = wordsA.slice(i, i + 3).join(' ')
    if (joinedB.includes(trigram)) return 0.75
  }
  return 0
}

// ---------------------------------------------------------------------------
// Permit signal scoring
// ---------------------------------------------------------------------------

/**
 * Compute a permit signal score (0–30) based on active permit statuses,
 * job values, estimated value buckets, and recent activity volume.
 */
function computePermitSignalScore(
  permits: { status: string; jobValue: number | null; estimatedValueBucket: string | null }[],
  permitCount30Days: number,
  activeJobCount: number,
): number {
  let score = 0

  if (activeJobCount > 0) {
    const activePermits = permits.filter((p) => ['ISSUED', 'INSPECTED'].includes(p.status))

    const maxConfirmedValue = Math.max(
      ...activePermits.filter((p) => p.jobValue !== null).map((p) => p.jobValue as number),
      0,
    )

    if (maxConfirmedValue >= 500_000) {
      score = 25
    } else if (maxConfirmedValue >= 100_000) {
      score = 20
    } else if (maxConfirmedValue >= 20_000) {
      score = 15
    } else {
      // Fall back to estimated value buckets at half weight
      const hasEstimated500k = activePermits.some((p) => p.estimatedValueBucket === '500K_PLUS')
      const hasEstimated100k = activePermits.some((p) => p.estimatedValueBucket === '100K_TO_500K')
      const hasEstimated20k = activePermits.some((p) => p.estimatedValueBucket === '20K_TO_100K')

      if (hasEstimated500k) score = 12
      else if (hasEstimated100k) score = 10
      else if (hasEstimated20k) score = 7
      else score = 5 // active but no value data
    }
  } else if (permitCount30Days >= 1) {
    score = 3
  }

  // Volume bonus — tiered by permit count in last 30 days.
  // Primary signal for ACA permits (no job value). Rewards busy contractors.
  if (permitCount30Days >= 15)     score += 17
  else if (permitCount30Days >= 10) score += 12
  else if (permitCount30Days >= 6)  score += 8
  else if (permitCount30Days >= 3)  score += 5
  else if (permitCount30Days >= 1)  score += 2

  // Cap at 30 before scoreCompany() applies its own maxScore cap
  return Math.min(score, 30)
}

// ---------------------------------------------------------------------------
// Shared helper: update one company's permit-derived fields and rescore
// ---------------------------------------------------------------------------

export async function updateCompanyPermitStats(companyId: string): Promise<string | null> {
  try {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const permits = await db.permit.findMany({
      where: { companyId },
      select: { filedAt: true, status: true, jobValue: true, estimatedValueBucket: true },
    })
    if (permits.length === 0) return null

    const lastPermitAt = permits.reduce(
      (max, p) => (p.filedAt > max ? p.filedAt : max),
      permits[0].filedAt,
    )
    const permitCount30Days = permits.filter((p) => p.filedAt >= thirtyDaysAgo).length
    const activeJobCount = permits.filter((p) =>
      ['ISSUED', 'INSPECTED'].includes(p.status),
    ).length
    const permitSignalScore = computePermitSignalScore(permits, permitCount30Days, activeJobCount)

    const company = await db.company.findUnique({
      where: { id: companyId },
      include: { signals: true, contacts: true },
    })
    if (!company) return null

    const score = scoreCompany({
      county: company.county,
      state: company.state,
      segments: company.segments,
      specialties: company.specialties,
      description: company.description,
      website: company.website,
      email: company.email,
      phone: company.phone,
      street: company.street,
      sourceConfidence: company.sourceConfidence,
      signals: company.signals,
      contacts: company.contacts,
      permitSignalScore,
    })

    await db.company.update({
      where: { id: companyId },
      data: {
        lastPermitAt,
        permitCount30Days,
        activeJobCount,
        permitSignalScore,
        leadScore: score.leadScore,
        activeScore: score.activeScore,
      },
    })
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function syncPermits(county?: string): Promise<SyncSummary> {
  const errors: string[] = []

  // -------------------------------------------------------------------------
  // STEP 1 — Parallel fetch from selected sources
  // -------------------------------------------------------------------------

  const sources = county
    ? ALL_SOURCES.filter(s => COUNTY_SOURCE_NAMES[county]?.includes(s.name))
    : ALL_SOURCES

  console.log(
    county
      ? `[sync-permits] Starting fetch for ${county} (${sources.map(s => s.name).join(', ')})…`
      : '[sync-permits] Starting parallel fetch from all sources…',
  )

  const results = await Promise.allSettled(sources.map(s => s.fetch()))

  const sourceSummaries: SyncSummary['sources'] = []
  const allPermits: NormalizedPermit[] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const name = sources[i].name

    if (result.status === 'fulfilled') {
      const permits = result.value
      console.log(`[sync-permits] ${name}: fetched ${permits.length} permits`)
      sourceSummaries.push({ name, fetched: permits.length, failed: false })
      allPermits.push(...permits)
    } else {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
      console.warn(`[sync-permits] ${name}: FAILED — ${message}`)
      sourceSummaries.push({ name, fetched: 0, failed: true })
      errors.push(`${name}: ${message}`)
    }
  }

  console.log(`[sync-permits] Total permits fetched: ${allPermits.length}`)

  // -------------------------------------------------------------------------
  // STEP 1b — Cross-source deduplication by permitNumber
  //
  // Both the REST API adapter (accela.ts) and the ACA scraper (accela-aca.ts)
  // may eventually return data for the same permits. Deduplicate by permitNumber
  // before upserting so we never create two DB rows for the same physical permit.
  // Keep the first occurrence (earlier sources in ALL_SOURCES order win).
  // -------------------------------------------------------------------------

  const seenPermitNumbers = new Set<string>()
  const deduplicatedPermits: NormalizedPermit[] = []
  for (const permit of allPermits) {
    if (!seenPermitNumbers.has(permit.permitNumber)) {
      seenPermitNumbers.add(permit.permitNumber)
      deduplicatedPermits.push(permit)
    }
  }
  if (deduplicatedPermits.length < allPermits.length) {
    console.log(
      `[sync-permits] Cross-source dedup: removed ${allPermits.length - deduplicatedPermits.length} duplicate permit numbers`,
    )
  }
  // Replace allPermits with the deduplicated set for all downstream steps
  allPermits.splice(0, allPermits.length, ...deduplicatedPermits)

  // -------------------------------------------------------------------------
  // STEP 2 — Bulk upsert permits; identify new vs updated
  //
  // Fix 2: replace the N+1 findUnique+upsert loop with a single bulk lookup,
  // then createMany for new records and individual updates for existing ones.
  // -------------------------------------------------------------------------

  let newPermits = 0
  let updatedPermits = 0

  // Bulk fetch all (source, externalId) pairs that already exist in the DB
  const existingPermitRows = await db.permit.findMany({
    where: {
      OR: allPermits.map((p) => ({ source: p.source, externalId: p.externalId })),
    },
    select: { source: true, externalId: true, id: true },
  })
  const existingSet = new Set(existingPermitRows.map((p) => `${p.source}:${p.externalId}`))

  // Split into creates vs updates
  const toCreate = allPermits.filter((p) => !existingSet.has(`${p.source}:${p.externalId}`))
  const toUpdate = allPermits.filter((p) => existingSet.has(`${p.source}:${p.externalId}`))

  // Bulk-insert new permits
  if (toCreate.length > 0) {
    await db.permit.createMany({
      data: toCreate.map((p) => ({
        source: p.source,
        externalId: p.externalId,
        permitNumber: p.permitNumber,
        permitType: p.permitType,
        description: p.description,
        status: p.status,
        jobAddress: p.jobAddress,
        county: p.county,
        jobValue: p.jobValue,
        isResidential: p.isResidential,
        filedAt: p.filedAt,
        issuedAt: p.issuedAt,
        inspectionAt: p.inspectionAt,
        closedAt: p.closedAt,
        contractorName: p.contractorName,
        contractorPhone: p.contractorPhone,
        contractorLicense: p.contractorLicense,
      })),
      skipDuplicates: true,
    })
    newPermits += toCreate.length
  }

  // Update the 6 mutable fields on existing permits
  for (const permit of toUpdate) {
    try {
      await db.permit.update({
        where: {
          source_externalId: { source: permit.source, externalId: permit.externalId },
        },
        data: {
          status: permit.status,
          issuedAt: permit.issuedAt,
          inspectionAt: permit.inspectionAt,
          closedAt: permit.closedAt,
          jobValue: permit.jobValue,
          contractorPhone: permit.contractorPhone,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`Update failed for ${permit.source}/${permit.externalId}: ${message}`)
    }
  }
  updatedPermits += toUpdate.length

  // Re-query the newly created permits to obtain their DB ids for matching
  let newPermitRecords: Array<{
    id: string
    source: string
    externalId: string
    contractorName: string | null
    contractorPhone: string | null
    county: string | null
  }> = []

  if (toCreate.length > 0) {
    newPermitRecords = await db.permit.findMany({
      where: {
        OR: toCreate.map((p) => ({ source: p.source, externalId: p.externalId })),
      },
      select: {
        id: true,
        source: true,
        externalId: true,
        contractorName: true,
        contractorPhone: true,
        county: true,
      },
    })
  }

  console.log(`[sync-permits] Upserted — new: ${newPermits}, updated: ${updatedPermits}`)

  // -------------------------------------------------------------------------
  // STEP 3 — Company matching (new permits only)
  // -------------------------------------------------------------------------

  let companiesMatched = 0
  let newCompaniesCreated = 0
  let enrichmentQueued = 0

  // Track which companyIds were touched for step 4
  const affectedCompanyIds = new Set<string>()

  if (newPermitRecords.length > 0) {
    // Load all companies once for matching (include phone for veto logic)
    const companies = await db.company.findMany({
      select: { id: true, name: true, normalizedName: true, phone: true },
    })

    // Pre-compute normalizedName for every company before the inner loop
    const normalizedCompanies = companies.map((c) => ({
      id: c.id,
      name: c.name,
      normalizedName: normalizeForMatch(c.name),
      phone: c.phone ?? null,
    }))

    console.log(`[sync-permits] Matching ${newPermitRecords.length} new permits against ${companies.length} companies…`)

    for (const record of newPermitRecords) {
      if (!record.contractorName) continue

      const normalizedContractor = normalizeForMatch(record.contractorName)

      // Find best match — iterate pre-computed normalizedCompanies
      let bestScore = 0
      let bestCompanyId: string | null = null

      for (const nc of normalizedCompanies) {
        const score = matchScore(normalizedContractor, nc.normalizedName)
        if (score > bestScore) {
          bestScore = score
          bestCompanyId = nc.id
        }
      }

      // Phone veto: if score is sub-1.0 and both sides have a phone that differs,
      // the permit belongs to a different company — reject the match.
      // Uses normalizePhone() so "(770) 555-1234" and "7705551234" compare equal.
      if (bestScore >= 0.85 && bestScore < 1.0 && bestCompanyId !== null && record.contractorPhone) {
        const permPhone = normalizePhone(record.contractorPhone)
        const matchedCo = normalizedCompanies.find((nc) => nc.id === bestCompanyId)
        const coPhone = normalizePhone(matchedCo?.phone ?? '')
        if (permPhone && coPhone && permPhone !== coPhone) {
          bestScore = 0
          bestCompanyId = null
        }
      }

      if (bestScore >= 0.85 && bestCompanyId !== null) {
        // Wrap in per-permit try/catch
        try {
          await db.permit.update({
            where: { id: record.id },
            data: {
              companyId: bestCompanyId,
              matchConfidence: bestScore,
              matchedAt: new Date(),
            },
          })
          affectedCompanyIds.add(bestCompanyId)
          companiesMatched++
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          errors.push(`Permit match update failed for permit id=${record.id}: ${message}`)
        }
      } else {
        // No match — conditionally create a new company
        const hasQualifyingKeyword = QUALIFYING_KEYWORDS.some((kw) =>
          record.contractorName!.toLowerCase().includes(kw.toLowerCase()),
        )

        if (hasQualifyingKeyword) {
          try {
            const newCompany = await db.company.create({
              data: {
                name: record.contractorName!,
                normalizedName: normalizeName(record.contractorName),
                county: record.county,
                state: 'GA',
                phone: record.contractorPhone ?? undefined,
                recordOrigin: 'PERMIT_DISCOVERY',
                leadScore: 20,
                status: 'NEW',
                // lastEnrichedAt intentionally omitted → auto-queues for enrichment
              },
            })

            await db.permit.update({
              where: { id: record.id },
              data: {
                companyId: newCompany.id,
                matchConfidence: 1.0,
                matchedAt: new Date(),
              },
            })

            // Add to in-memory list so subsequent permits in this batch can match it
            normalizedCompanies.push({
              id: newCompany.id,
              name: newCompany.name,
              normalizedName: normalizeForMatch(newCompany.name),
              phone: newCompany.phone ?? null,
            })

            affectedCompanyIds.add(newCompany.id)
            newCompaniesCreated++
            enrichmentQueued++
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            errors.push(`Company create failed for "${record.contractorName}": ${message}`)
          }
        }
      }
    }
  }

  console.log(
    `[sync-permits] Matching done — matched: ${companiesMatched}, created: ${newCompaniesCreated}, enrichmentQueued: ${enrichmentQueued}`,
  )

  // -------------------------------------------------------------------------
  // STEP 4 — Update denormalized Company permit fields and rescore
  //
  // Fix 3: compute permitSignalScore locally, then call scoreCompany() once,
  // then write all fields in a single db.company.update (was two writes).
  // -------------------------------------------------------------------------

  const affectedIds = [...affectedCompanyIds]
  console.log(`[sync-permits] Updating permit fields for ${affectedIds.length} affected companies…`)

  for (const companyId of affectedIds) {
    const err = await updateCompanyPermitStats(companyId)
    if (err) errors.push(`Company update failed for companyId=${companyId}: ${err}`)
  }

  // -------------------------------------------------------------------------
  // STEP 5 — Return SyncSummary
  // -------------------------------------------------------------------------

  const summary: SyncSummary = {
    sources: sourceSummaries,
    totalFetched: allPermits.length,
    newPermits,
    updatedPermits,
    companiesMatched,
    newCompaniesCreated,
    enrichmentQueued,
    errors,
  }

  console.log('[sync-permits] Sync complete:', summary)

  return summary
}

// ---------------------------------------------------------------------------
// rematchPermits — clear and re-run company matching for all permits in a
// county using the current (fixed) normalizeForMatch logic.
// Use this to repair bad matches created by older versions of the algorithm.
// ---------------------------------------------------------------------------

export interface RematchSummary {
  county: string
  cleared: number
  matched: number
  newCompaniesCreated: number
  errors: string[]
}

export async function rematchPermits(county: string): Promise<RematchSummary> {
  const errors: string[] = []

  // Step 1 — Load every permit for this county
  const permits = await db.permit.findMany({
    where: { county },
    select: { id: true, contractorName: true, contractorPhone: true },
  })
  console.log(`[rematch-permits] ${county}: ${permits.length} permits to re-match`)

  // Step 2 — Clear all existing company links for this county
  const { count: cleared } = await db.permit.updateMany({
    where: { county },
    data: { companyId: null, matchConfidence: null, matchedAt: null },
  })
  console.log(`[rematch-permits] ${county}: cleared ${cleared} existing matches`)

  // Step 3 — Load all companies and pre-compute normalized names (include phone for veto)
  const companies = await db.company.findMany({
    select: { id: true, name: true, phone: true },
  })
  const normalizedCompanies = companies.map((c) => ({
    id: c.id,
    name: c.name,
    normalizedName: normalizeForMatch(c.name),
    phone: c.phone ?? null,
  }))

  let matched = 0
  let newCompaniesCreated = 0
  const affectedCompanyIds = new Set<string>()

  for (const record of permits) {
    if (!record.contractorName) continue

    const normalizedContractor = normalizeForMatch(record.contractorName)

    let bestScore = 0
    let bestCompanyId: string | null = null

    for (const nc of normalizedCompanies) {
      const score = matchScore(normalizedContractor, nc.normalizedName)
      if (score > bestScore) {
        bestScore = score
        bestCompanyId = nc.id
      }
    }

    // Phone veto: if score is sub-1.0 and both sides have a phone that differs,
    // the permit belongs to a different company — reject the match.
    if (bestScore >= 0.85 && bestScore < 1.0 && bestCompanyId !== null && record.contractorPhone) {
      const permPhone = normalizePhone(record.contractorPhone)
      const matchedCo = normalizedCompanies.find((nc) => nc.id === bestCompanyId)
      const coPhone = normalizePhone(matchedCo?.phone ?? '')
      if (permPhone && coPhone && permPhone !== coPhone) {
        bestScore = 0
        bestCompanyId = null
      }
    }

    if (bestScore >= 0.85 && bestCompanyId !== null) {
      try {
        await db.permit.update({
          where: { id: record.id },
          data: { companyId: bestCompanyId, matchConfidence: bestScore, matchedAt: new Date() },
        })
        affectedCompanyIds.add(bestCompanyId)
        matched++
      } catch (err) {
        errors.push(`Match update failed for permit ${record.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else {
      // No match — create a new company if name has a qualifying keyword
      const hasQualifyingKeyword = QUALIFYING_KEYWORDS.some((kw) =>
        record.contractorName!.toLowerCase().includes(kw.toLowerCase()),
      )
      if (hasQualifyingKeyword) {
        try {
          const newCompany = await db.company.create({
            data: {
              name: record.contractorName!,
              normalizedName: normalizeName(record.contractorName),
              county,
              state: 'GA',
              phone: record.contractorPhone ?? undefined,
              recordOrigin: 'PERMIT_DISCOVERY',
              leadScore: 20,
              status: 'NEW',
            },
          })
          await db.permit.update({
            where: { id: record.id },
            data: { companyId: newCompany.id, matchConfidence: 1.0, matchedAt: new Date() },
          })
          // Add to in-memory list so later permits in this run can match it
          normalizedCompanies.push({
            id: newCompany.id,
            name: newCompany.name,
            normalizedName: normalizeForMatch(newCompany.name),
            phone: newCompany.phone ?? null,
          })
          affectedCompanyIds.add(newCompany.id)
          newCompaniesCreated++
          matched++
        } catch (err) {
          errors.push(`Company create failed for "${record.contractorName}": ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  // Step 4 — Rescore all affected companies
  console.log(`[rematch-permits] ${county}: rescoring ${affectedCompanyIds.size} companies…`)
  for (const companyId of affectedCompanyIds) {
    const err = await updateCompanyPermitStats(companyId)
    if (err) errors.push(`Score update failed for companyId=${companyId}: ${err}`)
  }

  console.log(
    `[rematch-permits] ${county}: matched=${matched}, newCompanies=${newCompaniesCreated}, errors=${errors.length}`,
  )
  return { county, cleared, matched, newCompaniesCreated, errors }
}
