'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { ScoreBadge, StatusBadge } from '@/components/ui/Badge'
import { formatPhone } from '@/lib/format'
import { ChevronLeft, ChevronRight, Globe, Radio, RefreshCw, Trash2, X } from 'lucide-react'

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
  const [enriching, setEnriching] = useState(false)
  const [enrichStatus, setEnrichStatus] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteStatus, setDeleteStatus] = useState<string | null>(null)

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
    setEnriching(true)
    setEnrichStatus(null)
    try {
      const res = await fetch('/api/enrich/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 10 }),
      })
      const data = await res.json()
      if (!res.ok) {
        setEnrichStatus(data.error ?? 'Enrichment failed')
      } else {
        setEnrichStatus(`Enriched ${data.processed} ${data.processed === 1 ? 'company' : 'companies'}`)
        router.refresh()
      }
    } catch {
      setEnrichStatus('Network error')
    } finally {
      setEnriching(false)
    }
  }

  return (
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
          {deleteStatus && (
            <span className={`text-xs ${deleteStatus.startsWith('Deleted') ? 'text-green-600' : 'text-red-500'}`}>
              {deleteStatus}
            </span>
          )}
          <button
            onClick={handleEnrichSelected}
            disabled={enriching || deleting || selectedIds.size === 0}
            className="btn-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw size={11} className={enriching ? 'animate-spin' : ''} />
            {selectedIds.size > 0 ? `Enrich Selected (${selectedIds.size})` : 'Enrich Selected'}
          </button>
          <button
            onClick={handleEnrichAll}
            disabled={enriching || deleting}
            className="btn-secondary text-xs"
          >
            <RefreshCw size={11} className={enriching && selectedIds.size === 0 ? 'animate-spin' : ''} />
            Enrich All
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
              <th className="table-cell-compact text-left font-medium text-gray-600 w-64">Company</th>
              <th className="table-cell-compact text-left font-medium text-gray-600 w-28">Location</th>
              <th className="table-cell-compact text-left font-medium text-gray-600 w-28">Segment</th>
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
                <td className="table-cell-compact">
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
                    <span className="text-xs text-gray-600 capitalize">
                      {company.segments.slice(0, 2).join(', ')}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </td>
                <td className="table-cell-compact text-center">
                  <ScoreBadge score={company.leadScore} />
                </td>
                <td className="table-cell-compact">
                  <StatusBadge status={company.status} />
                </td>
                <td className="table-cell-compact text-xs">
                  {company.phone ? (
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
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2">
          <span className="text-xs text-gray-500">
            Showing {((pagination.page - 1) * pagination.limit) + 1}–
            {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
            {pagination.total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-gray-500 px-2">
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              onClick={() => setPage(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
