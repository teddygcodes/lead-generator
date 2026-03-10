/**
 * sync-permits.ts
 *
 * Full permit ingest, match, and scoring sync job.
 * Fetches from all 6 configured sources in parallel, upserts permits,
 * matches or creates companies, updates denormalized permit fields, and rescores.
 */

import { accelaAdapter } from '@/lib/permits/accela'
import { accelaAcaAdapter } from '@/lib/permits/accela-aca'
import type { NormalizedPermit } from '@/lib/permits/base'
import { scoreCompany } from '@/lib/scoring'
import { normalizeName } from '@/lib/normalization'
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
// Source name constants (matches order of Promise.allSettled results)
// ---------------------------------------------------------------------------

const SOURCE_NAMES = [
  'ACCELA_GWINNETT',   // REST API (inactive — returns [] until county authorizes our app)
  'ACCELA_HALLCO',
  'ACCELA_ATLANTA',
  'ACA_ATLANTA',       // HTML scraper via ACA citizen portal (active)
  'ACA_GWINNETT',
  'ACA_HALLCO',
  // EnerGov (Forsyth, Jackson) removed — API returns no contractor name so permits
  // can never be matched to companies or affect scoring. Re-add if contractor detail
  // endpoint becomes available.
] as const

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
 * Strips business-type suffixes and cleans whitespace.
 */
function normalizeForMatch(name: string): string {
  const STRIP_SUFFIXES = [
    'llc', 'inc', 'corp', 'co', 'ltd', 'electric', 'electrical',
    'power', 'systems', 'services', 'solutions', 'contractors', 'group',
  ]
  let n = name.toLowerCase()
  n = n.replace(/[^a-z0-9 ]/g, ' ')
  for (const suffix of STRIP_SUFFIXES) {
    n = n.replace(new RegExp(`\\b${suffix}\\b`, 'g'), '')
  }
  return n.replace(/\s+/g, ' ').trim()
}

/**
 * Score the similarity between two pre-normalized names.
 * Returns 1.0 for exact match, 0.85 for contains, 0.75 for 3-word trigram overlap, 0 otherwise.
 */
function matchScore(a: string, b: string): number {
  if (a === b) return 1.0
  if (a.includes(b) || b.includes(a)) return 0.85
  const wordsA = a.split(' ').filter(Boolean)
  const wordsB = b.split(' ').filter(Boolean)
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
// Main export
// ---------------------------------------------------------------------------

export async function syncPermits(): Promise<SyncSummary> {
  const errors: string[] = []

  // -------------------------------------------------------------------------
  // STEP 1 — Parallel fetch from all active sources
  // -------------------------------------------------------------------------

  console.log('[sync-permits] Starting parallel fetch from all sources…')

  const results = await Promise.allSettled([
    accelaAdapter('GWINNETT_COUNTY'),     // REST API (inactive — returns [])
    accelaAdapter('HALL_COUNTY'),
    accelaAdapter('ATLANTA_GA'),
    accelaAcaAdapter('ATLANTA_GA'),       // HTML scraper (active)
    accelaAcaAdapter('GWINNETT'),
    accelaAcaAdapter('HALLCO'),
  ])

  const sourceSummaries: SyncSummary['sources'] = []
  const allPermits: NormalizedPermit[] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const name = SOURCE_NAMES[i]

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
  // Keep the first occurrence (earlier sources in SOURCE_NAMES order win).
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
    // Load all companies once for matching
    const companies = await db.company.findMany({
      select: { id: true, name: true, normalizedName: true },
    })

    // Fix 4: pre-compute normalizedName for every company before the inner loop
    const normalizedCompanies = companies.map((c) => ({
      id: c.id,
      name: c.name,
      normalizedName: normalizeForMatch(c.name),
    }))

    console.log(`[sync-permits] Matching ${newPermitRecords.length} new permits against ${companies.length} companies…`)

    for (const record of newPermitRecords) {
      if (!record.contractorName) continue

      const normalizedContractor = normalizeForMatch(record.contractorName)

      // Find best match — iterate pre-computed normalizedCompanies (Fix 4)
      let bestScore = 0
      let bestCompanyId: string | null = null

      for (const nc of normalizedCompanies) {
        const score = matchScore(normalizedContractor, nc.normalizedName)
        if (score > bestScore) {
          bestScore = score
          bestCompanyId = nc.id
        }
      }

      if (bestScore >= 0.75 && bestCompanyId !== null) {
        // Fix 1: wrap the permit.update for matched company in a per-permit try/catch
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
    try {
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      // Query 1 of 3: get all permits for this company (needed for scoring)
      const permits = await db.permit.findMany({
        where: { companyId },
        select: {
          filedAt: true,
          status: true,
          jobValue: true,
          estimatedValueBucket: true,
        },
      })

      if (permits.length === 0) continue

      const lastPermitAt = permits.reduce(
        (max, p) => (p.filedAt > max ? p.filedAt : max),
        permits[0].filedAt,
      )
      const permitCount30Days = permits.filter((p) => p.filedAt >= thirtyDaysAgo).length
      const activeJobCount = permits.filter((p) =>
        ['ISSUED', 'INSPECTED'].includes(p.status),
      ).length

      // Compute permitSignalScore locally — do NOT write it yet
      const permitSignalScore = computePermitSignalScore(permits, permitCount30Days, activeJobCount)

      // Query 2 of 3: fetch company + relations needed by scoreCompany
      const company = await db.company.findUnique({
        where: { id: companyId },
        include: { signals: true, contacts: true },
      })

      if (!company) continue

      // Score using the freshly computed permitSignalScore
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

      // Query 3 of 3: single update with all fields at once
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`Company update failed for companyId=${companyId}: ${message}`)
    }
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
