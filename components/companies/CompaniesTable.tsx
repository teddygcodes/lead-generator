'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { ScoreBadge, StatusBadge } from '@/components/ui/Badge'
import { formatPhone } from '@/lib/format'
import { BarChart2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Globe, Radio, RefreshCw, Trash2, X } from 'lucide-react'

interface Company {
  id: string
  name: string
  city: string | null
  county: string | null
  website: string | null
  domain: string | null
  phone: string | null
  email: string | null
  segments: string[]
  specialties: string[]
  leadScore: number | null
  activeScore: number | null
  status: string
  lastEnrichedAt: Date | null
  doNotContact: boolean
  employeeSizeEstimate: string | null
  description: string | null
  serviceAreas: string[]
  _count: { signals: number }
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

interface CompaniesTableProps {
  companies: Company[]
  pagination: Pagination
}

export function CompaniesTable({ companies, pagination }: CompaniesTableProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // "Enrich Selected" state
  const [enriching, setEnriching] = useState(false)
  const [enrichStatus, setEnrichStatus] = useState<string | null>(null)

  // "Enrich All" state — separate so both buttons are independently tracked
  const [enrichingAll, setEnrichingAll] = useState(false)
  const [enrichAllProgress, setEnrichAllProgress] = useState<{
    done: number; total: number; succeeded: number; failed: number
  } | null>(null)
  const [enrichAllStatus, setEnrichAllStatus] = useState<string | null>(null)

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteStatus, setDeleteStatus] = useState<string | null>(null)

  // "Resync Scores" state — reruns scoring model on stored data, no enrichment
  const [rescoring, setRescoring] = useState(false)
  const [rescoreStatus, setRescoreStatus] = useState<string | null>(null)

  // Hover card state — single shared instance positioned via fixed coords
  const [hoveredCompany, setHoveredCompany] = useState<Company | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null)

  const pageIds = companies.map((c) => c.id)
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))
  const somePageSelected = pageIds.some((id) => selectedIds.has(id))

  function toggleAll() {
    if (allPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        pageIds.forEach((id) => next.delete(id))
        return next
      })
    } else {
      setSelectedIds((prev) => new Set([...prev, ...pageIds]))
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleEnrichSelected() {
    if (selectedIds.size === 0) return
    setEnriching(true)
    setEnrichStatus(null)
    try {
      const res = await fetch('/api/enrich/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyIds: [...selectedIds] }),
      })
      const data = await res.json()
      if (!res.ok) {
        setEnrichStatus(data.error ?? 'Enrichment failed')
      } else {
        setEnrichStatus(`Enriched ${data.processed} of ${data.total}`)
        setSelectedIds(new Set())
        router.refresh()
      }
    } catch {
      setEnrichStatus('Network error')
    } finally {
      setEnriching(false)
    }
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return
    setDeleting(true)
    setDeleteStatus(null)
    try {
      const res = await fetch('/api/companies/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyIds: [...selectedIds] }),
      })
      const data = await res.json()
      if (!res.ok) {
        setDeleteStatus(data.error ?? 'Delete failed')
      } else {
        setDeleteStatus(`Deleted ${data.deleted} ${data.deleted === 1 ? 'company' : 'companies'}`)
        setSelectedIds(new Set())
        setConfirmDelete(false)
        router.refresh()
      }
    } catch {
      setDeleteStatus('Network error')
    } finally {
      setDeleting(false)
    }
  }

  function setPage(p: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(p))
    router.push(`${pathname}?${params.toString()}`)
  }

  async function handleEnrichAll() {
    setEnrichingAll(true)
    setEnrichAllStatus(null)
    setEnrichAllProgress(null)

    try {
      // 1. Fetch all pending IDs from the queue endpoint
      const queueRes = await fetch('/api/enrich/batch')
      if (!queueRes.ok) {
        setEnrichAllStatus('Failed to load enrich queue')
        return
      }
      const { ids, total } = await queueRes.json() as { ids: string[]; total: number }

      if (total === 0) {
        setEnrichAllStatus('Nothing to enrich')
        return
      }

      setEnrichAllProgress({ done: 0, total, succeeded: 0, failed: 0 })

      // 2. Process in sequential chunks of 5 with a delay between batches
      const CHUNK_SIZE = 5
      const DELAY_MS = 750
      let succeeded = 0
      let failed = 0

      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE)
        try {
          const res = await fetch('/api/enrich/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companyIds: chunk }),
          })
          const data = await res.json()
          if (res.ok) {
            succeeded += (data.processed as number) ?? 0
            failed += ((data.total as number) ?? chunk.length) - ((data.processed as number) ?? 0)
          } else {
            failed += chunk.length
          }
        } catch {
          // Don't stop — log this chunk as failed and continue
          failed += chunk.length
        }

        const done = Math.min(i + CHUNK_SIZE, ids.length)
        setEnrichAllProgress({ done, total, succeeded, failed })

        // Pause between batches (skip after last chunk)
        if (i + CHUNK_SIZE < ids.length) {
          await new Promise((r) => setTimeout(r, DELAY_MS))
        }
      }

      // 3. Show summary and refresh
      const parts = [`${succeeded} enriched`]
      if (failed > 0) parts.push(`${failed} failed`)
      setEnrichAllStatus(parts.join(', '))
      setEnrichAllProgress(null)
      router.refresh()
    } catch {
      setEnrichAllStatus('Network error')
      setEnrichAllProgress(null)
    } finally {
      setEnrichingAll(false)
    }
  }

  async function handleRescore() {
    setRescoring(true)
    setRescoreStatus(null)
    try {
      const res = await fetch('/api/rescore', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setRescoreStatus(data.error ?? 'Rescore failed')
      } else {
        setRescoreStatus(`Rescored ${data.updated}`)
        router.refresh()
      }
    } catch {
      setRescoreStatus('Network error')
    } finally {
      setRescoring(false)
    }
  }

  return (
    <>
    <div className="card overflow-hidden">
      {/* Persistent toolbar */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2 bg-gray-50">
        <span className="text-xs text-gray-500">
          {selectedIds.size > 0 ? (
            <>
              <span className="font-medium text-blue-700">{selectedIds.size}</span>
              {' '}{selectedIds.size === 1 ? 'company' : 'companies'} selected
              <button
                onClick={() => { setSelectedIds(new Set()); setEnrichStatus(null); setDeleteStatus(null); setConfirmDelete(false) }}
                className="ml-2 text-gray-400 hover:text-gray-600"
                title="Clear selection"
              >
                <X size={12} className="inline" />
              </button>
            </>
          ) : (
            'Select companies to enrich or delete'
          )}
        </span>
        <div className="flex items-center gap-2">
          {enrichStatus && (
            <span className={`text-xs ${enrichStatus.startsWith('Enriched') ? 'text-green-600' : 'text-red-500'}`}>
              {enrichStatus}
            </span>
          )}
          {enrichAllStatus && !enrichingAll && (
            <span className={`text-xs ${enrichAllStatus.includes('enriched') ? 'text-green-600' : enrichAllStatus === 'Nothing to enrich' ? 'text-gray-400' : 'text-red-500'}`}>
              {enrichAllStatus}
            </span>
          )}
          {rescoreStatus && !rescoring && (
            <span className={`text-xs ${rescoreStatus.startsWith('Rescored') ? 'text-green-600' : 'text-red-500'}`}>
              {rescoreStatus}
            </span>
          )}
          {deleteStatus && (
            <span className={`text-xs ${deleteStatus.startsWith('Deleted') ? 'text-green-600' : 'text-red-500'}`}>
              {deleteStatus}
            </span>
          )}
          <button
            onClick={handleEnrichSelected}
            disabled={enriching || enrichingAll || deleting || selectedIds.size === 0}
            className="btn-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw size={11} className={enriching ? 'animate-spin' : ''} />
            {selectedIds.size > 0 ? `Enrich Selected (${selectedIds.size})` : 'Enrich Selected'}
          </button>
          <button
            onClick={handleEnrichAll}
            disabled={enrichingAll || enriching || deleting}
            className="btn-secondary text-xs min-w-[6rem]"
          >
            <RefreshCw size={11} className={enrichingAll ? 'animate-spin' : ''} />
            {enrichAllProgress
              ? `${enrichAllProgress.done} / ${enrichAllProgress.total}…`
              : 'Enrich All'}
          </button>
          <button
            onClick={handleRescore}
            disabled={rescoring || enriching || enrichingAll || deleting}
            className="btn-secondary text-xs"
            title="Resync all scores using current scoring model (no enrichment)"
          >
            <BarChart2 size={11} className={rescoring ? 'animate-pulse' : ''} />
            {rescoring ? 'Rescoring…' : 'Resync Scores'}
          </button>
          <div className="w-px h-4 bg-gray-200" />
          {confirmDelete ? (
            <>
              <span className="text-xs text-red-600 font-medium">Delete {selectedIds.size} {selectedIds.size === 1 ? 'company' : 'companies'}?</span>
              <button
                onClick={handleDeleteSelected}
                disabled={deleting}
                className="rounded px-2 py-1 text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
              >
                <Trash2 size={11} className={deleting ? 'animate-pulse' : ''} />
                {deleting ? 'Deleting…' : 'Confirm'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => { setConfirmDelete(true); setDeleteStatus(null) }}
              disabled={enriching || deleting || selectedIds.size === 0}
              className="rounded px-2 py-1 text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Trash2 size={11} />
              {selectedIds.size > 0 ? `Delete Selected (${selectedIds.size})` : 'Delete Selected'}
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="table-cell-compact w-8">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  ref={(el) => { if (el) el.indeterminate = somePageSelected && !allPageSelected }}
                  onChange={toggleAll}
                  className="rounded border-gray-300 text-blue-600 cursor-pointer"
                />
              </th>
              <th className="table-cell-compact text-left font-medium text-gray-600 w-64">
                {(() => {
                  const currentSort = searchParams.get('sort') || 'leadScore'
                  const currentOrder = searchParams.get('order') || 'desc'
                  const isActive = currentSort === 'name'
                  const nextOrder = isActive && currentOrder === 'asc' ? 'desc' : 'asc'
                  return (
                    <button
                      onClick={() => {
                        const params = new URLSearchParams(searchParams.toString())
                        params.set('sort', 'name')
                        params.set('order', nextOrder)
                        params.delete('page')
                        router.push(`${pathname}?${params.toString()}`)
                      }}
                      className={`flex items-center gap-1 hover:text-blue-600 transition-colors ${isActive ? 'text-blue-600' : ''}`}
                      title="Sort by name"
                    >
                      Company
                      <span className="text-[10px]">
                        {isActive ? (currentOrder === 'asc' ? '▲' : '▼') : '⇅'}
                      </span>
                    </button>
                  )
                })()}
              </th>
              <th className="table-cell-compact text-left font-medium text-gray-600 w-28">Location</th>
              <th className="table-cell-compact text-left font-medium text-gray-600 w-36">Segment</th>
              <th className="table-cell-compact text-left font-medium text-gray-600 w-16">Size</th>
              <th className="table-cell-compact text-center font-medium text-gray-600 w-16">Score</th>
              <th className="table-cell-compact text-left font-medium text-gray-600 w-24">Status</th>
              <th className="table-cell-compact text-left font-medium text-gray-600 w-32">Contact</th>
              <th className="table-cell-compact text-center font-medium text-gray-600 w-16">Signals</th>
              <th className="table-cell-compact text-left font-medium text-gray-600">Web</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {companies.map((company) => (
              <tr
                key={company.id}
                className={`hover:bg-gray-50 transition-colors ${company.doNotContact ? 'opacity-50' : ''} ${selectedIds.has(company.id) ? 'bg-blue-50/50' : ''}`}
              >
                <td className="table-cell-compact">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(company.id)}
                    onChange={() => toggleOne(company.id)}
                    className="rounded border-gray-300 text-blue-600 cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
                <td
                  className="table-cell-compact"
                  onMouseEnter={(e) => {
                    if (!company.description) return
                    const rect = e.currentTarget.getBoundingClientRect()
                    setTooltipPos({ top: rect.bottom + 4, left: rect.left })
                    setHoveredCompany(company)
                  }}
                  onMouseLeave={() => { setHoveredCompany(null); setTooltipPos(null) }}
                >
                  <Link
                    href={`/companies/${company.id}`}
                    className="font-medium text-gray-900 hover:text-blue-600 line-clamp-1"
                  >
                    {company.name}
                  </Link>
                </td>
                <td className="table-cell-compact text-gray-500 text-xs">
                  {company.city && company.county
                    ? `${company.city}, ${company.county}`
                    : company.county ?? company.city ?? '—'}
                </td>
                <td className="table-cell-compact">
                  {company.segments.length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-gray-600 capitalize">
                        {company.segments.slice(0, 2).join(', ')}
                      </span>
                      {company.specialties.length > 0 && (
                        <div className="flex flex-wrap gap-0.5">
                          {company.specialties.slice(0, 2).map((s) => (
                            <span
                              key={s}
                              className="inline-block rounded bg-gray-100 px-1 text-[10px] leading-4 text-gray-500 max-w-[90px] truncate"
                              title={s}
                            >
                              {s}
                            </span>
                          ))}
                          {company.specialties.length > 2 && (
                            <span className="text-[10px] text-gray-400" title={company.specialties.slice(2).join(', ')}>
                              +{company.specialties.length - 2}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </td>
                <td className="table-cell-compact text-xs text-gray-500">
                  {company.employeeSizeEstimate ?? <span className="text-gray-300">—</span>}
                </td>
                <td className="table-cell-compact text-center">
                  <ScoreBadge score={company.leadScore} />
                </td>
                <td className="table-cell-compact">
                  <StatusBadge status={company.status} />
                </td>
                <td className="table-cell-compact text-xs">
                  {formatPhone(company.phone) ? (
                    <a
                      href={`tel:${company.phone}`}
                      className="text-gray-600 hover:text-blue-600"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {formatPhone(company.phone)}
                    </a>
                  ) : company.email ? (
                    <a
                      href={`mailto:${company.email}`}
                      className="text-gray-600 hover:text-blue-600 truncate block max-w-[120px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {company.email}
                    </a>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="table-cell-compact text-center">
                  {company._count.signals > 0 ? (
                    <span className="inline-flex items-center gap-0.5 text-xs text-blue-600">
                      <Radio size={11} />
                      {company._count.signals}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">0</span>
                  )}
                </td>
                <td className="table-cell-compact">
                  {company.domain ? (
                    <a
                      href={`https://${company.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-400 hover:text-blue-600"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Globe size={13} />
                    </a>
                  ) : (
                    <span className="text-gray-200">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (() => {
        const { page, totalPages, total, limit } = pagination
        const from = (page - 1) * limit + 1
        const to = Math.min(page * limit, total)

        // Build the page number window: always show first, last, current ±2, with '…' gaps
        const pageNums: (number | '…')[] = []
        const add = (n: number) => { if (!pageNums.includes(n)) pageNums.push(n) }
        add(1)
        for (let i = Math.max(2, page - 2); i <= Math.min(totalPages - 1, page + 2); i++) add(i)
        add(totalPages)
        // Insert ellipses where gaps are >1
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
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2">
            <span className="text-xs text-gray-500">
              {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-0.5">
              <button onClick={() => setPage(1)} disabled={page <= 1} className={btnNav} title="First page">
                <ChevronsLeft size={15} />
              </button>
              <button onClick={() => setPage(page - 1)} disabled={page <= 1} className={btnNav} title="Previous page">
                <ChevronLeft size={15} />
              </button>
              <div className="flex items-center gap-0.5 mx-1">
                {withEllipsis.map((p, i) =>
                  p === '…' ? (
                    <span key={`ellipsis-${i}`} className="px-1 text-xs text-gray-400 select-none">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p as number)}
                      className={p === page ? btnActive : btnPage}
                    >
                      {p}
                    </button>
                  )
                )}
              </div>
              <button onClick={() => setPage(page + 1)} disabled={page >= totalPages} className={btnNav} title="Next page">
                <ChevronRight size={15} />
              </button>
              <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} className={btnNav} title="Last page">
                <ChevronsRight size={15} />
              </button>
            </div>
          </div>
        )
      })()}
    </div>

      {/* Rich hover card — fixed positioning bypasses table overflow clipping */}
      {hoveredCompany && tooltipPos && (
        <div
          style={{
            position: 'fixed',
            top: tooltipPos.top,
            left: Math.min(tooltipPos.left, window.innerWidth - 340),
            width: 320,
            zIndex: 50,
          }}
          className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 pointer-events-none"
        >
          <p className="text-xs font-semibold text-gray-900 mb-1.5 leading-tight">
            {hoveredCompany.name}
          </p>
          {hoveredCompany.description && (
            <p className="text-xs text-gray-600 leading-relaxed mb-2">
              {hoveredCompany.description}
            </p>
          )}
          {hoveredCompany.specialties.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {hoveredCompany.specialties.map((s) => (
                <span key={s} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 leading-4">
                  {s}
                </span>
              ))}
            </div>
          )}
          {hoveredCompany.serviceAreas.length > 0 && (
            <p className="text-[11px] text-gray-500">
              <span className="font-medium">Areas:</span>{' '}
              {hoveredCompany.serviceAreas.join(', ')}
            </p>
          )}
          {hoveredCompany.employeeSizeEstimate && (
            <p className="text-[11px] text-gray-500 mt-0.5">
              <span className="font-medium">Est. size:</span>{' '}
              {hoveredCompany.employeeSizeEstimate} employees
            </p>
          )}
        </div>
      )}
    </>
  )
}
