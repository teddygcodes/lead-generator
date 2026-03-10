'use client'

import { useState } from 'react'
import { formatDate, formatDuration } from '@/lib/format'
import { JobStatusBadge } from '@/components/ui/Badge'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SerializedJob {
  id: string
  createdAt: string
  sourceType: string
  status: string
  startedAt: string | null
  finishedAt: string | null
  recordsFound: number | null
  recordsCreated: number | null
  recordsUpdated: number | null
  errorMessage: string | null
  metadata: Record<string, unknown> | null
}

type FilterTab = 'All' | 'Discovery' | 'Website' | 'Registry' | 'Import'

const FILTER_TABS: FilterTab[] = ['All', 'Discovery', 'Website', 'Registry', 'Import']

const FILTER_SOURCE_TYPES: Record<FilterTab, string | null> = {
  All: null,
  Discovery: 'COMPANY_DISCOVERY',
  Website: 'COMPANY_WEBSITE',
  Registry: 'LICENSE',
  Import: 'CSV_IMPORT',
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  COMPANY_DISCOVERY: 'Company Discovery',
  COMPANY_WEBSITE: 'Website Enrichment',
  LICENSE: 'Business Registry',
  CSV_IMPORT: 'CSV Import',
  PERMIT: 'Permit Scan',
  MANUAL: 'Manual',
}

// ─── Component ───────────────────────────────────────────────────────────────

export function JobHistoryList({ jobs }: { jobs: SerializedJob[] }) {
  const [activeFilter, setActiveFilter] = useState<FilterTab>('All')

  const filtered =
    activeFilter === 'All'
      ? jobs
      : jobs.filter((j) => j.sourceType === FILTER_SOURCE_TYPES[activeFilter])

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-gray-400">Job History</h2>
        <span className="text-xs text-gray-400">
          {filtered.length} job{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-3">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveFilter(tab)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeFilter === tab
                ? 'bg-gray-900 text-white'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Job list */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
          No {activeFilter === 'All' ? '' : activeFilter.toLowerCase() + ' '}jobs yet.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded divide-y divide-gray-100">
          {filtered.map((job) => {
            const duration =
              job.startedAt && job.finishedAt
                ? formatDuration(new Date(job.startedAt), new Date(job.finishedAt))
                : null

            return (
              <details key={job.id} className="group">
                <summary className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-gray-50 list-none">
                  <div className="flex-shrink-0">
                    <JobStatusBadge status={job.status} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {SOURCE_TYPE_LABELS[job.sourceType] ?? job.sourceType}
                      </span>
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
                      <span className="font-medium text-gray-700">{job.recordsFound ?? '—'}</span>{' '}
                      found
                    </span>
                    <span title="Created">
                      <span className="font-medium text-green-700">
                        {job.recordsCreated ?? '—'}
                      </span>{' '}
                      created
                    </span>
                    <span title="Updated">
                      <span className="font-medium text-blue-700">
                        {job.recordsUpdated ?? '—'}
                      </span>{' '}
                      updated
                    </span>
                    <span className="text-gray-300">▸</span>
                  </div>
                </summary>

                <div className="px-4 pb-4 pt-2 bg-gray-50 border-t border-gray-100">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                    <div>
                      <dt className="text-gray-400 uppercase tracking-wide text-2xs font-medium mb-0.5">
                        Job ID
                      </dt>
                      <dd className="font-mono text-gray-700">{job.id}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-400 uppercase tracking-wide text-2xs font-medium mb-0.5">
                        Source
                      </dt>
                      <dd className="text-gray-700">
                        {SOURCE_TYPE_LABELS[job.sourceType] ?? job.sourceType}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-400 uppercase tracking-wide text-2xs font-medium mb-0.5">
                        Started
                      </dt>
                      <dd className="text-gray-700">
                        {job.startedAt ? formatDate(job.startedAt) : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-400 uppercase tracking-wide text-2xs font-medium mb-0.5">
                        Finished
                      </dt>
                      <dd className="text-gray-700">
                        {job.finishedAt ? formatDate(job.finishedAt) : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-400 uppercase tracking-wide text-2xs font-medium mb-0.5">
                        Records found
                      </dt>
                      <dd className="text-gray-700">{job.recordsFound ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-400 uppercase tracking-wide text-2xs font-medium mb-0.5">
                        Created / Updated
                      </dt>
                      <dd className="text-gray-700">
                        {job.recordsCreated ?? '—'} / {job.recordsUpdated ?? '—'}
                      </dd>
                    </div>
                    {job.errorMessage && (
                      <div className="col-span-2">
                        <dt className="text-gray-400 uppercase tracking-wide text-2xs font-medium mb-0.5">
                          Error
                        </dt>
                        <dd className="font-mono text-red-700 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">
                          {job.errorMessage}
                        </dd>
                      </div>
                    )}
                    {job.metadata &&
                      typeof job.metadata === 'object' &&
                      Object.keys(job.metadata).length > 0 && (
                        <div className="col-span-2">
                          <dt className="text-gray-400 uppercase tracking-wide text-2xs font-medium mb-0.5">
                            Metadata
                          </dt>
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

      {jobs.length >= 500 && (
        <p className="mt-3 text-center text-xs text-gray-400">
          Showing up to 500 most recent jobs
        </p>
      )}
    </div>
  )
}
