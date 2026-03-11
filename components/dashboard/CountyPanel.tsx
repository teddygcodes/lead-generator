'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'

interface CompanyRow {
  id: string
  name: string
  leadScore: number
  segments: string[]
  description: string | null
  phone: string | null
  city: string | null
}

function ScoreBadge({ score }: { score: number }) {
  const variant = score >= 70 ? 'green' : score >= 50 ? 'yellow' : 'gray'
  return <Badge variant={variant}>{score}</Badge>
}

interface CountyPanelProps {
  county: string
  onClose: () => void
}

export function CountyPanel({ county, onClose }: CountyPanelProps) {
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/dashboard/county/${encodeURIComponent(county)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load county data (${r.status})`)
        return r.json()
      })
      .then((data) => setCompanies(data.companies ?? []))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load county data')
        setCompanies([])
      })
      .finally(() => setLoading(false))
  }, [county])

  return (
    <div className="absolute right-0 top-0 z-10 flex h-full w-80 flex-col border-l border-gray-200 bg-white shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <span className="text-sm font-semibold text-gray-900">{county} County</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={15} />
        </button>
      </div>

      {/* View all link */}
      <div className="border-b border-gray-100 px-4 py-2">
        <Link
          href={`/companies?county=${encodeURIComponent(county)}`}
          className="text-xs text-blue-600 hover:underline"
        >
          View all in Companies page →
        </Link>
      </div>

      {/* Company list */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
        {loading ? (
          <div className="px-4 py-6 text-center text-xs text-gray-400">Loading…</div>
        ) : error ? (
          <div className="px-4 py-6 text-center text-xs text-red-400">{error}</div>
        ) : companies.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-gray-400">No companies in this county</div>
        ) : (
          companies.map((c) => (
            <Link
              key={c.id}
              href={`/companies/${c.id}`}
              className="block px-4 py-2.5 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-gray-900 leading-tight line-clamp-1">
                  {c.name}
                </span>
                <ScoreBadge score={c.leadScore} />
              </div>
              {c.segments.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {c.segments.slice(0, 2).map((s) => (
                    <span
                      key={s}
                      className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 capitalize leading-4"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
              {c.description && (
                <p className="text-[11px] text-gray-500 line-clamp-1 mb-0.5">{c.description}</p>
              )}
              {c.phone && (
                <p className="text-[11px] text-gray-400">{c.phone}</p>
              )}
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
