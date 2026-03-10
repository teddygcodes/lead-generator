/**
 * sync-permits.ts
 *
 * Full permit ingest, match, and scoring sync job.
 * Fetches from all 6 configured sources in parallel, upserts permits,
 * matches or creates companies, updates denormalized permit fields, and rescores.
 */

import { accelaAdapter } from '@/lib/permits/accela'
import { energovAdapter } from '@/lib/permits/energov'
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
  'ACCELA_GWINNETT',
  'ACCELA_COBB',
  'ACCELA_HALLCO',
  'ACCELA_ATLANTA',
  'ENERGOV_FORSYTH',
  'ENERGOV_JACKSON',
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

  // Bonus for high recent activity
  if (permitCount30Days >= 3) score += 5

  return score
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function syncPermits(): Promise<SyncSummary> {
  const errors: string[] = []

  // -------------------------------------------------------------------------
  // STEP 1 — Parallel fetch from all 6 sources
  // -------------------------------------------------------------------------

  console.log('[sync-permits] Starting parallel fetch from all sources…')

  const results = await Promise.allSettled([
    accelaAdapter('GWINNETT_COUNTY'),
    accelaAdapter('COBB_COUNTY'),
    accelaAdapter('HALL_COUNTY'),
    accelaAdapter('ATLANTA_GA'),
    energovAdapter('FORSYTH'),
    energovAdapter('JACKSON'),
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
  // STEP 2 — Upsert each permit; identify new vs updated
  // -------------------------------------------------------------------------

  let newPermits = 0
  let updatedPermits = 0

  // Permits that are brand-new (need matching in step 3)
  const newPermitRecords: Array<{ dbId: string; permit: NormalizedPermit }> = []

  for (const permit of allPermits) {
    try {
      // Check existence first so we can track new vs updated
      const existing = await db.permit.findUnique({
        where: {
          source_externalId: { source: permit.source, externalId: permit.externalId },
        },
        select: { id: true },
      })

      const upserted = await db.permit.upsert({
        where: {
          source_externalId: { source: permit.source, externalId: permit.externalId },
        },
        create: {
          source: permit.source,
          externalId: permit.externalId,
          permitNumber: permit.permitNumber,
          permitType: permit.permitType,
          description: permit.description,
          status: permit.status,
          jobAddress: permit.jobAddress,
          county: permit.county,
          jobValue: permit.jobValue,
          isResidential: permit.isResidential,
          filedAt: permit.filedAt,
          issuedAt: permit.issuedAt,
          inspectionAt: permit.inspectionAt,
          closedAt: permit.closedAt,
          contractorName: permit.contractorName,
          contractorPhone: permit.contractorPhone,
          contractorLicense: permit.contractorLicense,
        },
        update: {
          status: permit.status,
          issuedAt: permit.issuedAt,
          inspectionAt: permit.inspectionAt,
          closedAt: permit.closedAt,
          jobValue: permit.jobValue,
          contractorPhone: permit.contractorPhone,
        },
      })

      if (!existing) {
        newPermits++
        newPermitRecords.push({ dbId: upserted.id, permit })
      } else {
        updatedPermits++
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`Upsert failed for ${permit.source}/${permit.externalId}: ${message}`)
    }
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

    console.log(`[sync-permits] Matching ${newPermitRecords.length} new permits against ${companies.length} companies…`)

    for (const { dbId, permit } of newPermitRecords) {
      if (!permit.contractorName) continue

      const normalizedContractor = normalizeForMatch(permit.contractorName)

      // Find best match
      let bestScore = 0
      let bestCompanyId: string | null = null

      for (const company of companies) {
        const normalizedCompany = normalizeForMatch(company.name)
        const score = matchScore(normalizedContractor, normalizedCompany)
        if (score > bestScore) {
          bestScore = score
          bestCompanyId = company.id
        }
      }

      if (bestScore >= 0.75 && bestCompanyId !== null) {
        // Matched to existing company
        await db.permit.update({
          where: { id: dbId },
          data: {
            companyId: bestCompanyId,
            matchConfidence: bestScore,
            matchedAt: new Date(),
          },
        })
        affectedCompanyIds.add(bestCompanyId)
        companiesMatched++
      } else {
        // No match — conditionally create a new company
        const hasQualifyingKeyword = QUALIFYING_KEYWORDS.some((kw) =>
          permit.contractorName.toLowerCase().includes(kw.toLowerCase()),
        )

        if (hasQualifyingKeyword) {
          try {
            const newCompany = await db.company.create({
              data: {
                name: permit.contractorName,
                normalizedName: normalizeName(permit.contractorName),
                county: permit.county,
                state: 'GA',
                phone: permit.contractorPhone ?? undefined,
                recordOrigin: 'PERMIT_DISCOVERY',
                leadScore: 20,
                status: 'NEW',
                // lastEnrichedAt intentionally omitted → auto-queues for enrichment
              },
            })

            await db.permit.update({
              where: { id: dbId },
              data: {
                companyId: newCompany.id,
                matchConfidence: 1.0,
                matchedAt: new Date(),
              },
            })

            // Add to in-memory list so subsequent permits in this batch can match it
            companies.push({
              id: newCompany.id,
              name: newCompany.name,
              normalizedName: newCompany.normalizedName,
            })

            affectedCompanyIds.add(newCompany.id)
            newCompaniesCreated++
            enrichmentQueued++
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            errors.push(`Company create failed for "${permit.contractorName}": ${message}`)
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
  // -------------------------------------------------------------------------

  const affectedIds = [...affectedCompanyIds]
  console.log(`[sync-permits] Updating permit fields for ${affectedIds.length} affected companies…`)

  for (const companyId of affectedIds) {
    try {
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

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

      const permitSignalScore = computePermitSignalScore(permits, permitCount30Days, activeJobCount)

      await db.company.update({
        where: { id: companyId },
        data: { lastPermitAt, permitCount30Days, activeJobCount, permitSignalScore },
      })

      // Rescore with updated permitSignalScore
      const company = await db.company.findUnique({
        where: { id: companyId },
        include: { signals: true, contacts: true },
      })

      if (company) {
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
          permitSignalScore: company.permitSignalScore,
        })

        await db.company.update({
          where: { id: companyId },
          data: { leadScore: score.leadScore, activeScore: score.activeScore },
        })
      }
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
