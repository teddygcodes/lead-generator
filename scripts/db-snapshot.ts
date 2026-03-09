// dev-only — not for production
// Run: pnpm tsx scripts/db-snapshot.ts
// Captures a DB state snapshot for baseline and post-run comparison.

import { db } from '@/lib/db'

async function main() {
  const companies = await db.company.count()
  const companiesWithWebsite = await db.company.count({ where: { website: { not: null } } })
  const companiesEnriched = await db.company.count({ where: { lastEnrichedAt: { not: null } } })
  const signalsByType = await db.signal.groupBy({ by: ['signalType'], _count: true })

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const recentWebsiteSignals = await db.signal.count({
    where: { signalType: 'WEBSITE_CONTENT', createdAt: { gte: thirtyDaysAgo } },
  })

  const jobs = await db.crawlJob.count()
  const recentJobs = await db.crawlJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      sourceType: true,
      status: true,
      createdAt: true,
      recordsFound: true,
      recordsCreated: true,
      recordsUpdated: true,
      metadata: true,
    },
  })

  console.log('=== DB Snapshot ===')
  console.log(JSON.stringify({ companies, companiesWithWebsite, companiesEnriched, recentWebsiteSignals, signalsByType, jobs, recentJobs }, null, 2))

  // Extended: recent enriched companies
  const recentlyEnriched = await db.company.findMany({
    where: { lastEnrichedAt: { not: null } },
    select: { id: true, name: true, website: true, lastEnrichedAt: true, segments: true, specialties: true },
    take: 10,
    orderBy: { lastEnrichedAt: 'desc' },
  })

  // Extended: recent signals
  const recentSignals = await db.signal.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      companyId: true,
      signalType: true,
      sourceType: true,
      sourceName: true,
      createdAt: true,
      relevanceScore: true,
      metadata: true,
    },
  })

  // Extended: recent jobs detail
  const recentJobsDetail = await db.crawlJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      sourceType: true,
      status: true,
      recordsFound: true,
      recordsCreated: true,
      recordsUpdated: true,
      metadata: true,
      errorMessage: true,
      startedAt: true,
      finishedAt: true,
    },
  })

  console.log('\n=== Recently Enriched Companies ===')
  console.log(JSON.stringify(recentlyEnriched, null, 2))

  console.log('\n=== Recent Signals ===')
  console.log(JSON.stringify(recentSignals, null, 2))

  console.log('\n=== Recent Jobs Detail ===')
  console.log(JSON.stringify(recentJobsDetail, null, 2))

  // Duplicate WEBSITE_CONTENT check (companyId + canonicalDomain)
  const websiteSignals = await db.signal.findMany({
    where: { signalType: 'WEBSITE_CONTENT', createdAt: { gte: thirtyDaysAgo } },
    select: { companyId: true, metadata: true, createdAt: true },
  })

  const seen = new Map<string, number>()
  const malformed: string[] = []
  for (const s of websiteSignals) {
    const domain = (s.metadata as Record<string, unknown>)?.canonicalDomain
    if (!domain || typeof domain !== 'string') {
      malformed.push(s.companyId)
      continue
    }
    const key = `${s.companyId}:${domain}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  const dupes = [...seen.entries()].filter(([, count]) => count > 1)

  console.log('\n=== WEBSITE_CONTENT Duplicate Check (30-day window) ===')
  console.log('Duplicate (companyId:domain) pairs:', dupes)
  if (malformed.length > 0) {
    console.warn('Signals with missing/malformed canonicalDomain (companyIds):', malformed)
  }
  if (dupes.length === 0) {
    console.log('✓ No duplicates found')
  }

  await db.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
