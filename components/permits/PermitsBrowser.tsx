'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { Loader2, RefreshCw, MapPin, FileText, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { PermitSlideOver } from './PermitSlideOver'

// ─── Types ───────────────────────────────────────────────────────────────────

export type CountyStat = {
  count: number
  lastSynced: string | null
  newest: string | null
}

export type SerializedPermit = {
  id: string
  permitNumber: string
  permitType: string
  description: string | null
  status: string
  jobAddress: string | null
  county: string
  jobValue: number | null
  isResidential: boolean
  filedAt: string
  issuedAt: string | null
  contractorName: string
  contractorPhone: string | null
  companyId: string | null
  source: string
}

interface PermitsBrowserProps {
  counties: string[]
  initialStats: Record<string, CountyStat>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const ms = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatDate(isoStr: string): string {
  const d = new Date(isoStr)
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`
}

function formatValue(v: number | null): string {
  if (v === null) return '—'
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function statusBadge(status: string): string {
  switch (status.toUpperCase()) {
    case 'ISSUED':    return 'bg-green-100 text-green-700'
    case 'APPLIED':   return 'bg-blue-100 text-blue-700'
    case 'INSPECTED': return 'bg-amber-100 text-amber-700'
    case 'CLOSED':    return 'bg-gray-100 text-gray-500'
    default:          return 'bg-gray-100 text-gray-500'
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function PermitsBrowser({ counties, initialStats }: PermitsBrowserProps) {
  const [selectedCounty, setSelectedCounty] = useState<string | null>(null)
  const [permits, setPermits] = useState<SerializedPermit[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [search, setSearch] = useState('')
  const [stats, setStats] = useState<Record<string, CountyStat>>(initialStats)
  const [syncingCounty, setSyncingCounty] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedPermitId, setSelectedPermitId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [rematching, setRematching] = useState(false)
  const [rematchMsg, setRematchMsg] = useState<string | null>(null)

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadPermits = useCallback(async (county: string, p: number, q: string) => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/permits/list?county=${encodeURIComponent(county)}&page=${p}&search=${encodeURIComponent(q)}&limit=50`
      )
      const data = await res.json() as {
        permits: SerializedPermit[]
        total: number
        page: number
        pages: number
      }
      setPermits(data.permits)
      setTotal(data.total)
      setPage(data.page)
      setPages(data.pages)
    } catch (err) {
      console.error('[PermitsBrowser] loadPermits failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Load permits when county changes
  useEffect(() => {
    if (selectedCounty) {
      setSearch('')
      setPage(1)
      void loadPermits(selectedCounty, 1, '')
    }
  }, [selectedCounty, loadPermits])

  // Debounced search
  function handleSearchChange(value: string) {
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (selectedCounty) {
        setPage(1)
        void loadPermits(selectedCounty, 1, value)
      }
    }, 300)
  }

  async function handleSync(county: string) {
    setSyncingCounty(county)
    try {
      await fetch('/api/permits/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ county }),
        // Cherokee uses a headless browser fetch; allow up to 90 s before giving up
        signal: AbortSignal.timeout(90_000),
      })
      // Refresh stats
      const freshStats = await fetch('/api/permits/stats').then(r => r.json()) as Record<string, CountyStat>
      setStats(freshStats)
      // If this is the selected county, refresh permits too
      if (selectedCounty === county) {
        await loadPermits(county, 1, search)
        setPage(1)
      }
    } catch (err) {
      console.error('[PermitsBrowser] sync failed:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setSyncMsg(msg.includes('timeout') || msg.includes('abort') ? 'Sync timed out — try again' : `Sync failed: ${msg}`)
    } finally {
      setSyncingCounty(null)
    }
  }

  async function handleBulkSync() {
    if (!selectedCounty || syncing) return
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await fetch('/api/permits/bulk-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ county: selectedCounty }),
      })
      const data = await res.json() as { syncedCount?: number; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Unknown error')
      setSyncMsg(`Synced ${data.syncedCount ?? 0} permits ✓`)
      setTimeout(() => {
        setSyncMsg(null)
        void loadPermits(selectedCounty, 1, search)
        setPage(1)
      }, 3000)
    } catch (err) {
      console.error('[PermitsBrowser] bulk-sync failed:', err)
      setSyncMsg('Sync failed')
      setTimeout(() => setSyncMsg(null), 3000)
    } finally {
      setSyncing(false)
    }
  }

  async function handleRematch() {
    if (!selectedCounty || rematching) return
    setRematching(true)
    setRematchMsg(null)
    try {
      const res = await fetch('/api/permits/rematch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ county: selectedCounty }),
      })
      const data = await res.json() as { matched?: number; cleared?: number; newCompaniesCreated?: number; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Unknown error')
      setRematchMsg(`Re-matched ${data.matched ?? 0} of ${data.cleared ?? 0} permits ✓`)
      setTimeout(() => {
        setRematchMsg(null)
        void loadPermits(selectedCounty, 1, search)
        setPage(1)
      }, 3000)
    } catch (err) {
      console.error('[PermitsBrowser] rematch failed:', err)
      setRematchMsg('Re-match failed')
      setTimeout(() => setRematchMsg(null), 3000)
    } finally {
      setRematching(false)
    }
  }

  const pageStart = (page - 1) * 50 + 1
  const pageEnd = Math.min(page * 50, total)

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* ── Left panel: county list ── */}
      <aside className="w-64 flex-none border-r border-gray-200 bg-white overflow-y-auto">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Counties</p>
        </div>

        <div className="py-1">
          {counties.map(county => {
            const stat = stats[county] ?? { count: 0, lastSynced: null, newest: null }
            const isSelected = selectedCounty === county
            const isSyncing = syncingCounty === county

            return (
              <div
                key={county}
                onClick={() => setSelectedCounty(county)}
                className={[
                  'px-4 py-3 cursor-pointer border-l-2 transition-colors',
                  isSelected
                    ? 'bg-blue-50 border-blue-500'
                    : 'border-transparent hover:bg-gray-50',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={['text-sm font-medium', isSelected ? 'text-blue-700' : 'text-gray-800'].join(' ')}>
                    {county}
                  </span>
                  <span className="text-xs font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">
                    {stat.count.toLocaleString()}
                  </span>
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {stat.lastSynced ? `Synced ${timeAgo(stat.lastSynced)}` : 'Never synced'}
                </p>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    void handleSync(county)
                  }}
                  disabled={isSyncing}
                  className="mt-1.5 flex items-center gap-1 rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSyncing ? (
                    <><Loader2 size={10} className="animate-spin" /> Syncing…</>
                  ) : (
                    <><RefreshCw size={10} /> Sync</>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </aside>

      {/* ── Right panel: permits browser ── */}
      <main className="flex-1 overflow-y-auto bg-gray-50">
        {!selectedCounty ? (
          // Empty state — no county selected
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
            <MapPin size={36} className="opacity-30" />
            <p className="text-sm font-medium">Select a county to view permits</p>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold text-gray-900">{selectedCounty} Permits</h1>
                <p className="text-sm text-gray-500 mt-0.5">
                  {total.toLocaleString()} permits
                  {stats[selectedCounty]?.newest && (
                    <span className="ml-1">through {formatDate(stats[selectedCounty].newest!)}</span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
                {rematchMsg && (
                  <span className={`text-xs font-medium ${rematchMsg.includes('failed') ? 'text-red-600' : 'text-green-600'}`}>{rematchMsg}</span>
                )}
                {syncMsg && (
                  <span className="text-xs font-medium text-green-600">{syncMsg}</span>
                )}
                <button
                  onClick={() => void handleRematch()}
                  disabled={rematching || syncing}
                  title="Clear all company links for this county and re-run matching with the current algorithm"
                  className="flex items-center gap-1.5 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 shadow-sm hover:bg-amber-100 hover:border-amber-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {rematching
                    ? <><Loader2 size={12} className="animate-spin" /> Re-matching…</>
                    : <><RefreshCw size={12} /> Re-match</>
                  }
                </button>
                <button
                  onClick={() => void handleBulkSync()}
                  disabled={syncing || rematching}
                  title="Link unlinked permits whose contractor name already has a match in this county"
                  className="flex items-center gap-1.5 rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {syncing
                    ? <><Loader2 size={12} className="animate-spin" /> Syncing…</>
                    : <><RefreshCw size={12} /> Sync Linked</>
                  }
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={e => handleSearchChange(e.target.value)}
                placeholder="Search contractor, address, or permit #…"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Table or empty states */}
            {loading ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 size={20} className="animate-spin mr-2" />
                <span className="text-sm">Loading permits…</span>
              </div>
            ) : permits.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
                <FileText size={32} className="opacity-30" />
                <p className="text-sm font-medium">
                  {search ? 'No permits match your search' : 'No permits synced yet — click Sync to fetch'}
                </p>
              </div>
            ) : (
              <>
                <div className="card overflow-hidden p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/80">
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contractor</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Address</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Permit #</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Filed</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {permits.map(permit => (
                        <tr
                          key={permit.id}
                          onClick={() => setSelectedPermitId(permit.id)}
                          className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                        >
                          {/* Contractor */}
                          <td className="px-4 py-2.5">
                            {permit.companyId ? (
                              <Link
                                href={`/companies/${permit.companyId}`}
                                onClick={e => e.stopPropagation()}
                                className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                              >
                                {permit.contractorName || '—'}
                              </Link>
                            ) : (
                              <span className="font-medium text-gray-800">
                                {permit.contractorName || <span className="text-gray-400 font-normal italic">Unknown</span>}
                              </span>
                            )}
                          </td>

                          {/* Phone */}
                          <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                            {permit.contractorPhone ?? <span className="text-gray-300">—</span>}
                          </td>

                          {/* Address */}
                          <td className="px-4 py-2.5 text-gray-600 max-w-[180px] truncate">
                            {permit.jobAddress ?? <span className="text-gray-300">—</span>}
                          </td>

                          {/* Permit # */}
                          <td className="px-4 py-2.5">
                            <span className="font-mono text-xs text-gray-600">{permit.permitNumber}</span>
                          </td>

                          {/* Filed date */}
                          <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                            {formatDate(permit.filedAt)}
                          </td>

                          {/* Status badge */}
                          <td className="px-4 py-2.5">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadge(permit.status)}`}>
                              {permit.status}
                            </span>
                          </td>

                          {/* Residential / Commercial */}
                          <td className="px-4 py-2.5">
                            {permit.isResidential ? (
                              <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600">Res</span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-600">Comm</span>
                            )}
                          </td>

                          {/* Value */}
                          <td className="px-4 py-2.5 text-right text-gray-600 whitespace-nowrap">
                            {formatValue(permit.jobValue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>{/* overflow-x-auto */}
                </div>

                {/* Pagination */}
                {(() => {
                  function goTo(p: number) {
                    setPage(p)
                    void loadPermits(selectedCounty!, p, search)
                  }

                  // Build page number window: always show first, last, current ±2, with '…' gaps
                  const pageNums: (number | '…')[] = []
                  const add = (n: number) => { if (!pageNums.includes(n)) pageNums.push(n) }
                  add(1)
                  for (let i = Math.max(2, page - 2); i <= Math.min(pages - 1, page + 2); i++) add(i)
                  if (pages > 1) add(pages)
                  const withEllipsis: (number | '…')[] = []
                  for (let i = 0; i < pageNums.length; i++) {
                    withEllipsis.push(pageNums[i])
                    if (i < pageNums.length - 1 && (pageNums[i + 1] as number) - (pageNums[i] as number) > 1) {
                      withEllipsis.push('…')
                    }
                  }

                  const btnBase = 'inline-flex items-center justify-center h-8 min-w-[2rem] rounded px-2 text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed'
                  const btnNav = `${btnBase} text-gray-500 hover:bg-gray-100 hover:text-gray-800`
                  const btnPage = `${btnBase} text-gray-600 hover:bg-gray-100 hover:text-gray-900`
                  const btnActive = `${btnBase} bg-blue-600 text-white shadow-sm`

                  return (
                    <div className="flex items-center justify-between border-t border-gray-100 px-1 py-2">
                      <span className="text-xs text-gray-500">
                        {pageStart.toLocaleString()}–{pageEnd.toLocaleString()} of {total.toLocaleString()} permits
                      </span>
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => goTo(1)} disabled={page <= 1 || loading} className={btnNav} title="First page">
                          <ChevronsLeft size={15} />
                        </button>
                        <button onClick={() => goTo(page - 1)} disabled={page <= 1 || loading} className={btnNav} title="Previous page">
                          <ChevronLeft size={15} />
                        </button>
                        <div className="flex items-center gap-0.5 mx-1">
                          {withEllipsis.map((p, i) =>
                            p === '…' ? (
                              <span key={`ellipsis-${i}`} className="px-1 text-xs text-gray-400 select-none">…</span>
                            ) : (
                              <button
                                key={p}
                                onClick={() => goTo(p as number)}
                                disabled={loading}
                                className={p === page ? btnActive : btnPage}
                              >
                                {p}
                              </button>
                            )
                          )}
                        </div>
                        <button onClick={() => goTo(page + 1)} disabled={page >= pages || loading} className={btnNav} title="Next page">
                          <ChevronRight size={15} />
                        </button>
                        <button onClick={() => goTo(pages)} disabled={page >= pages || loading} className={btnNav} title="Last page">
                          <ChevronsRight size={15} />
                        </button>
                      </div>
                    </div>
                  )
                })()}
              </>
            )}
          </div>
        )}
      </main>

      {/* Permit detail slide-over */}
      {selectedPermitId && (
        <PermitSlideOver
          permitId={selectedPermitId}
          onClose={() => setSelectedPermitId(null)}
          onUpdate={() => {
            if (selectedCounty) void loadPermits(selectedCounty, page, search)
          }}
        />
      )}
    </div>
  )
}
