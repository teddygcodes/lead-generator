/**
 * Job postings sync orchestrator.
 * Fetches electrician job postings via Google CSE, matches them against existing companies,
 * creates JOB_POSTING signals for matched companies, and optionally creates company stubs
 * for unmatched posting sources so they can be enriched later.
 */

import { db } from '@/lib/db'
import { fetchElectricianJobPostings } from '@/lib/signals/job-postings'
import { normalizeForMatch, matchScore, VALID_COUNTIES } from '@/lib/jobs/sync-permits'

export interface JobPostingSyncResult {
  /** Signals created for postings matched to existing companies. */
  matched: number
  /** Signals created for postings that led to new stub company creation. */
  created: number
  /** Postings skipped (no company extracted, dedup hit, or too-short name). */
  skipped: number
  /** Net-new stub companies created. */
  newCompanies: number
}

export async function syncJobPostingSignals(): Promise<JobPostingSyncResult> {
  const postings = await fetchElectricianJobPostings(VALID_COUNTIES)

  // Load all non-DEMO companies for matching
  const companies = await db.company.findMany({
    where: { doNotContact: false, recordOrigin: { not: 'DEMO' } },
    select: { id: true, name: true, normalizedName: true },
  })

  let matched = 0
  let created = 0
  let skipped = 0
  let newCompanies = 0

  for (const posting of postings) {
    if (!posting.company) {
      skipped++
      continue
    }

    const normalizedCandidate = normalizeForMatch(posting.company)

    // Match against existing companies
    let bestCompanyId: string | null = null
    let bestScore = 0
    for (const c of companies) {
      const score = matchScore(normalizedCandidate, c.normalizedName ?? '')
      if (score > bestScore) {
        bestScore = score
        bestCompanyId = c.id
      }
    }

    let companyId: string | null = bestScore >= 0.85 ? bestCompanyId : null

    // Create a stub company if no confident match found.
    // Require at least 3 characters to avoid garbage stubs.
    if (!companyId && posting.company.length >= 3) {
      const stub = await db.company.create({
        data: {
          name: posting.company,
          normalizedName: normalizeForMatch(posting.company),
          segments: ['UNKNOWN'],
          sourceConfidence: 0.3,
          recordOrigin: 'DISCOVERED',
          state: 'GA',
        },
      })
      companyId = stub.id
      companies.push({ id: stub.id, name: stub.name, normalizedName: stub.normalizedName })
      newCompanies++
    }

    if (!companyId) {
      skipped++
      continue
    }

    // 7-day dedup: skip if we already created a JOB_POSTING signal for this company recently
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000)
    const existing = await db.signal.findFirst({
      where: {
        companyId,
        signalType: 'JOB_POSTING',
        createdAt: { gte: sevenDaysAgo },
      },
      select: { id: true },
    })

    if (existing) {
      skipped++
      continue
    }

    // Create the signal
    await db.signal.create({
      data: {
        companyId,
        sourceType: 'COMPANY_DISCOVERY',
        sourceName: 'Google Job Search',
        sourceUrl: posting.url,
        title: posting.title,
        snippet: posting.snippet,
        signalType: 'JOB_POSTING',
        signalDate: new Date(),
        relevanceScore: 0.8,
      },
    })

    if (bestScore >= 0.85) {
      matched++
    } else {
      created++
    }
  }

  return { matched, created, skipped, newCompanies }
}
