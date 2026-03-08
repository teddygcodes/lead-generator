import { db } from '@/lib/db'
import { cleanupStaleJobs } from '@/lib/jobs/cleanup'
import { formatDate, formatDuration } from '@/lib/format'
import { JobStatusBadge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata = { title: 'Jobs — Electrical Leads Engine' }

const JOB_DISPLAY_LIMIT = 500

export default async function JobsPage() {
  // v1 startup fallback: clean up stale RUNNING jobs on page load.
  // Idempotent — safe to call on every render. Replace with Next.js instrumentation
  // or a proper startup hook when one is added to the project.
  await cleanupStaleJobs()

  const jobs = await db.crawlJob.findMany({
    orderBy: { startedAt: 'desc' },
    take: JOB_DISPLAY_LIMIT,
  })

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Crawl Jobs</h1>
        <p className="text-sm text-gray-500 mt-1">Operational log of all enrichment and import runs</p>
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          title="No jobs yet"
          description="Import companies or run enrichment to see job history here."
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded divide-y divide-gray-100">
          {jobs.map((job) => {
            const duration =
              job.startedAt && job.finishedAt
                ? formatDuration(job.startedAt, job.finishedAt)
                : null

            return (
              <details key={job.id} className="group">
                <summary className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-gray-50 list-none">
                  <div className="flex-shrink-0">
                    <JobStatusBadge status={job.status} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{job.sourceType}</span>
                      {job.errorMessage && (
                        <span className="text-xs text-red-600 truncate max-w-xs">
                          {job.errorMessage.slice(0, 80)}
                          {job.errorMessage.length > 80 ? '…' : ''}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {formatDate(job.createdAt)}
                      {duration && ` · ${duration}`}
                    </div>
                  </div>

                  <div className="flex items-center gap-6 text-xs text-gray-500 flex-shrink-0">
                    <span title="Found">
                      <span className="font-medium text-gray-700">{job.recordsFound ?? '—'}</span> found
                    </span>
                    <span title="Created">
                      <span className="font-medium text-green-700">{job.recordsCreated ?? '—'}</span> created
                    </span>
                    <span title="Updated">
                      <span className="font-medium text-blue-700">{job.recordsUpdated ?? '—'}</span> updated
                    </span>
                    <span className="text-gray-300">▸</span>
                  </div>
                </summary>

                <div className="px-4 pb-4 pt-2 bg-gray-50 border-t border-gray-100">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                    <div>
                      <dt className="text-gray-400 uppercase tracking-wide text-2xs font-medium mb-0.5">Job ID</dt>
                      <dd className="font-mono text-gray-700">{job.id}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-400 uppercase tracking-wide text-2xs font-medium mb-0.5">Source</dt>
                      <dd className="text-gray-700">{job.sourceType}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-400 uppercase tracking-wide text-2xs font-medium mb-0.5">Started</dt>
                      <dd className="text-gray-700">{job.startedAt ? formatDate(job.startedAt) : '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-400 uppercase tracking-wide text-2xs font-medium mb-0.5">Finished</dt>
                      <dd className="text-gray-700">{job.finishedAt ? formatDate(job.finishedAt) : '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-400 uppercase tracking-wide text-2xs font-medium mb-0.5">Records found</dt>
                      <dd className="text-gray-700">{job.recordsFound ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-400 uppercase tracking-wide text-2xs font-medium mb-0.5">Created / Updated</dt>
                      <dd className="text-gray-700">{job.recordsCreated ?? '—'} / {job.recordsUpdated ?? '—'}</dd>
                    </div>
                    {job.errorMessage && (
                      <div className="col-span-2">
                        <dt className="text-gray-400 uppercase tracking-wide text-2xs font-medium mb-0.5">Error</dt>
                        <dd className="font-mono text-red-700 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">
                          {job.errorMessage}
                        </dd>
                      </div>
                    )}
                    {job.metadata && typeof job.metadata === 'object' && Object.keys(job.metadata).length > 0 && (
                      <div className="col-span-2">
                        <dt className="text-gray-400 uppercase tracking-wide text-2xs font-medium mb-0.5">Metadata</dt>
                        <dd className="font-mono text-gray-600 bg-white border border-gray-200 p-2 rounded text-2xs whitespace-pre-wrap">
                          {JSON.stringify(job.metadata, null, 2)}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              </details>
            )
          })}
        </div>
      )}
      {jobs.length >= JOB_DISPLAY_LIMIT && (
        <p className="mt-3 text-center text-xs text-gray-400">
          Showing up to {JOB_DISPLAY_LIMIT} most recent jobs
        </p>
      )}
    </div>
  )
}
