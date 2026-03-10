'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Zap, RefreshCw } from 'lucide-react'

// ---- Types ----------------------------------------------------------------

interface PermitCompany {
  id: string
  name: string
  leadScore: number
  lastContactedAt: string | null
}

interface Permit {
  id: string
  permitNumber: string
  permitType: 'ELECTRICAL' | 'BUILDING' | 'MECHANICAL' | 'OTHER'
  description: string | null
  status: string
  county: string
  jobAddress: string | null
  jobValue: number | null
  valueIsEstimated: boolean
  estimatedValueBucket: string | null
  filedAt: string
  issuedAt: string | null
  inspectionAt: string | null
  contractorName: string
  company: PermitCompany | null
  isNewCompany: boolean
}

interface SignalsResponse {
  permits: Permit[]
  lastSyncAt: string | null
}

// ---- Filter types ----------------------------------------------------------

type StatusFilter = 'ALL' | 'ISSUED' | 'INSPECTED'
type ValueFilter = 20000 | 100000 | 500000

// ---- Helpers ---------------------------------------------------------------

const BUCKET_RANGE: Record<string, string> = {
  UNDER_20K: '< $20k',
  '20K_TO_100K': '$20k–$100k',
  '100K_TO_500K': '~$100k–$500k',
  '500K_PLUS': '$500k+',
}

function formatValue(permit: Permit): { display: string; estimated: boolean } {
  if (permit.jobValue !== null) {
    const formatted = '$' + permit.jobValue.toLocaleString('en-US')
    return { display: formatted, estimated: false }
  }
  if (permit.estimatedValueBucket && BUCKET_RANGE[permit.estimatedValueBucket]) {
    return { display: `${BUCKET_RANGE[permit.estimatedValueBucket]} (est.)`, estimated: true }
  }
  return { display: 'Value unknown', estimated: false }
}

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months === 1) return '1 month ago'
  return `${months} months ago`
}

function permitValueThreshold(permit: Permit, minValue: ValueFilter): boolean {
  // Confirmed value
  if (permit.jobValue !== null) return permit.jobValue >= minValue

  // Estimated bucket
  if (permit.estimatedValueBucket) {
    const bucketMin: Record<string, number> = {
      UNDER_20K: 0,
      '20K_TO_100K': 20_000,
      '100K_TO_500K': 100_000,
      '500K_PLUS': 500_000,
    }
    const bMin = bucketMin[permit.estimatedValueBucket] ?? 0
    return bMin >= minValue
  }

  return false
}

// ---- Skeleton card ---------------------------------------------------------

function SkeletonCard() {
  return (
    <div className="px-4 py-3 animate-pulse">
      <div className="flex items-center justify-between mb-2">
        <div className="h-3.5 bg-gray-200 rounded w-2/5" />
        <div className="h-4 bg-gray-200 rounded w-14" />
      </div>
      <div className="h-3 bg-gray-100 rounded w-3/4 mb-2" />
      <div className="h-3 bg-gray-100 rounded w-1/3" />
    </div>
  )
}

// ---- Status pill -----------------------------------------------------------

function StatusPill({ status }: { status: string }) {
  const normalized = status.toUpperCase()
  if (normalized === 'ISSUED') {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 leading-4">
        Issued
      </span>
    )
  }
  if (normalized === 'INSPECTED') {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 leading-4">
        Inspected
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 leading-4">
      {status}
    </span>
  )
}

// ---- Main component --------------------------------------------------------

export function PermitSignals() {
  const [permits, setPermits] = useState<Permit[]>([])
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [valueFilter, setValueFilter] = useState<ValueFilter>(20000)

  const fetchSignals = useCallback(async () => {
    try {
      const res = await fetch('/api/permits/signals')
      if (!res.ok) throw new Error(`Signals fetch failed: ${res.status}`)
      const data: SignalsResponse = await res.json()
      setPermits(data.permits)
      setLastSyncAt(data.lastSyncAt)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load signals')
    }
  }, [])

  useEffect(() => {
    fetchSignals().finally(() => setLoading(false))
  }, [fetchSignals])

  async function syncNow() {
    setSyncing(true)
    try {
      const res = await fetch('/api/permits/sync', { method: 'POST' })
      if (!res.ok) throw new Error(`Sync failed: ${res.status}`)
      await fetchSignals()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  // Client-side filtering — no refetch
  const filtered = permits.filter((p) => {
    if (statusFilter !== 'ALL' && p.status.toUpperCase() !== statusFilter) return false
    if (!permitValueThreshold(p, valueFilter)) return false
    return true
  })

  // ---- Render ---------------------------------------------------------------

  return (
    <div className="card">
      {/* Section header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <span className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
          <Zap size={13} className="text-yellow-500" />
          Active Project Signals
        </span>
        <div className="flex items-center gap-3">
          {lastSyncAt && (
            <span className="text-[11px] text-gray-400">
              Last synced: {relativeTime(lastSyncAt)}
            </span>
          )}
          <button
            onClick={syncNow}
            disabled={syncing}
            className="btn-secondary flex items-center gap-1 text-[11px] px-2.5 py-1 h-auto disabled:opacity-50"
          >
            <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-2">
        {/* Status filter */}
        <div className="flex items-center gap-1">
          {(['ALL', 'ISSUED', 'INSPECTED'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {s === 'ALL' ? 'All' : s === 'ISSUED' ? 'Issued' : 'Inspected'}
            </button>
          ))}
        </div>

        <span className="text-gray-200 select-none">|</span>

        {/* Value filter */}
        <div className="flex items-center gap-1">
          {([20000, 100000, 500000] as ValueFilter[]).map((v) => (
            <button
              key={v}
              onClick={() => setValueFilter(v)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                valueFilter === v
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {v === 20000 ? '$20k+' : v === 100000 ? '$100k+' : '$500k+'}
            </button>
          ))}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="divide-y divide-gray-50">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-gray-500 mb-3">No active project signals found.</p>
            <button
              onClick={syncNow}
              disabled={syncing}
              className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 mx-auto disabled:opacity-50"
            >
              <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing…' : 'Sync Now'}
            </button>
          </div>
        ) : (
          filtered.map((permit) => {
            const { display: valueDisplay, estimated: isEstimated } = formatValue(permit)

            return (
              <div key={permit.id} className="px-4 py-3">
                {/* Row 1: contractor name + score badge */}
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-bold text-gray-900 line-clamp-1 flex items-center gap-1">
                    <Zap size={11} className="text-yellow-400 flex-none" />
                    {permit.contractorName}
                  </span>
                  {permit.company && (
                    <span className="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 leading-4 flex-none">
                      Score: {permit.company.leadScore}
                    </span>
                  )}
                </div>

                {/* Row 2: value + type + county + age */}
                <p className="text-[11px] text-gray-500 mb-1.5">
                  {isEstimated ? (
                    <em className="text-gray-400">{valueDisplay}</em>
                  ) : (
                    <span className={permit.jobValue === null ? 'text-gray-400' : undefined}>
                      {valueDisplay}
                    </span>
                  )}{' '}
                  · {permit.permitType}{' '}
                  · {permit.county}{' '}
                  · {relativeTime(permit.filedAt)}
                </p>

                {/* Row 3: status pill + company link or new badge */}
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusPill status={permit.status} />
                  {permit.company ? (
                    <Link
                      href={`/companies/${permit.company.id}`}
                      className="text-[11px] text-blue-600 hover:underline"
                    >
                      {permit.company.name}
                    </Link>
                  ) : permit.isNewCompany ? (
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 leading-4">
                      New — pending enrichment
                    </span>
                  ) : null}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
