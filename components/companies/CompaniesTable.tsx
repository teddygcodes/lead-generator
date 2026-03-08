'use client'

import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { ScoreBadge, StatusBadge } from '@/components/ui/Badge'
import { formatPhone } from '@/lib/format'
import { ChevronLeft, ChevronRight, Globe, Radio } from 'lucide-react'

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

  function setPage(p: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(p))
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
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
                className={`hover:bg-gray-50 transition-colors ${company.doNotContact ? 'opacity-50' : ''}`}
              >
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
