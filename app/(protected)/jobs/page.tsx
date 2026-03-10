import { db } from '@/lib/db'
import { cleanupStaleJobs } from '@/lib/jobs/cleanup'
import { JobControlPanel } from '@/components/jobs/JobControlPanel'
import { JobHistoryList } from '@/components/jobs/JobHistoryList'
import type { LastRun } from '@/components/jobs/JobControlPanel'
import type { SerializedJob } from '@/components/jobs/JobHistoryList'

export const metadata = { title: 'Jobs — Electrical Leads Engine' }

async function getJobsPageData() {
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  const realOnly = { recordOrigin: { not: 'DEMO' as const } }

  const [
    totalCompanies,
    signalsThisWeek,
    recentImports,
    uncontactedHighScore,
    needEnrichmentCount,
    lastDiscovery,
    lastWebsite,
    lastRegistry,
    jobs,
  ] = await Promise.all([
    db.company.count({ where: realOnly }),
    db.signal.count({ where: { createdAt: { gte: weekAgo }, company: realOnly } }),
    db.crawlJob.count({ where: { sourceType: 'CSV_IMPORT', createdAt: { gte: weekAgo } } }),
    db.company.count({ where: { leadScore: { gte: 60 }, status: 'NEW', ...realOnly } }),
    db.company.count({ where: { lastEnrichedAt: null, ...realOnly } }),
    db.crawlJob.findFirst({
      where: { sourceType: 'COMPANY_DISCOVERY', status: 'COMPLETED' },
      orderBy: { finishedAt: 'desc' },
    }),
    db.crawlJob.findFirst({
      where: { sourceType: 'COMPANY_WEBSITE', status: 'COMPLETED' },
      orderBy: { finishedAt: 'desc' },
    }),
    db.crawlJob.findFirst({
      where: { sourceType: 'LICENSE', status: 'COMPLETED' },
      orderBy: { finishedAt: 'desc' },
    }),
    db.crawlJob.findMany({ orderBy: { startedAt: 'desc' }, take: 500 }),
  ])

  function serializeLastRun(
    job: { finishedAt: Date | null; recordsFound: number | null; recordsCreated: number | null; recordsUpdated: number | null } | null,
  ): LastRun {
    if (!job) return null
    return {
      finishedAt: job.finishedAt?.toISOString() ?? null,
      recordsFound: job.recordsFound,
      recordsCreated: job.recordsCreated,
      recordsUpdated: job.recordsUpdated,
    }
  }

  const serializedJobs: SerializedJob[] = jobs.map((j) => ({
    id: j.id,
    createdAt: j.createdAt.toISOString(),
    sourceType: j.sourceType,
    status: j.status,
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
    recordsFound: j.recordsFound,
    recordsCreated: j.recordsCreated,
    recordsUpdated: j.recordsUpdated,
    errorMessage: j.errorMessage,
    metadata: (j.metadata as Record<string, unknown> | null) ?? null,
  }))

  return {
    totalCompanies,
    signalsThisWeek,
    recentImports,
    uncontactedHighScore,
    needEnrichmentCount,
    lastDiscovery: serializeLastRun(lastDiscovery),
    lastWebsite: serializeLastRun(lastWebsite),
    lastRegistry: serializeLastRun(lastRegistry),
    jobs: serializedJobs,
  }
}

export default async function JobsPage() {
  // v1 startup fallback: clean up stale RUNNING jobs on page load.
  await cleanupStaleJobs()

  const data = await getJobsPageData()

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Jobs</h1>
        <p className="text-sm text-gray-500 mt-1">
          Control center for data discovery and enrichment
        </p>
      </div>

      <JobControlPanel
        totalCompanies={data.totalCompanies}
        signalsThisWeek={data.signalsThisWeek}
        recentImports={data.recentImports}
        uncontactedHighScore={data.uncontactedHighScore}
        needEnrichmentCount={data.needEnrichmentCount}
        lastDiscovery={data.lastDiscovery}
        lastWebsite={data.lastWebsite}
        lastRegistry={data.lastRegistry}
      />

      <JobHistoryList jobs={data.jobs} />
    </div>
  )
}
