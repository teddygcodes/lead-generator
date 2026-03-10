'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Phone, Mail, PhoneCall } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'

interface Lead {
  id: string
  name: string
  leadScore: number
  county: string | null
  city: string | null
  segments: string[]
  description: string | null
  phone: string | null
  email: string | null
}

function ScoreBadge({ score }: { score: number }) {
  const variant = score >= 70 ? 'green' : score >= 50 ? 'yellow' : 'gray'
  return <Badge variant={variant}>{score}</Badge>
}

export function TopLeads() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [contactedIds, setContactedIds] = useState<Set<string>>(new Set())
  const [marking, setMarking] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/dashboard/top-leads')
      .then((r) => r.json())
      .then((data) => setLeads(data.leads ?? []))
      .catch(() => setLeads([]))
      .finally(() => setLoading(false))
  }, [])

  async function handleMarkContacted(id: string) {
    setMarking(id)
    try {
      await fetch(`/api/dashboard/company/${id}/contact`, { method: 'PATCH' })
      setContactedIds((prev) => new Set([...prev, id]))
    } finally {
      setMarking(null)
    }
  }

  const visible = leads.filter((l) => !contactedIds.has(l.id))

  return (
    <div className="card flex flex-col">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <span className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
          <PhoneCall size={13} className="text-gray-400" />
          Top Leads to Call This Week
        </span>
        <Link href="/companies?minScore=60&status=NEW" className="text-xs text-blue-600 hover:underline">
          View all
        </Link>
      </div>

      <div className="flex-1 divide-y divide-gray-50 overflow-y-auto" style={{ maxHeight: 460 }}>
        {loading ? (
          <div className="px-4 py-8 text-center text-xs text-gray-400">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-gray-500">
              No high-score uncontacted leads yet.
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Run enrichment or lower the score threshold.
            </p>
          </div>
        ) : (
          <>
            {visible.map((lead) => (
              <div key={lead.id} className="px-4 py-3">
                {/* Name + score */}
                <div className="flex items-start justify-between gap-2 mb-1">
                  <Link
                    href={`/companies/${lead.id}`}
                    className="text-xs font-semibold text-gray-900 hover:text-blue-600 line-clamp-1"
                  >
                    {lead.name}
                  </Link>
                  <ScoreBadge score={lead.leadScore} />
                </div>

                {/* Location */}
                {(lead.county || lead.city) && (
                  <p className="text-[11px] text-gray-400 mb-1">
                    {[lead.city, lead.county ? `${lead.county} Co.` : null].filter(Boolean).join(', ')}
                  </p>
                )}

                {/* Segments */}
                {lead.segments.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {lead.segments.map((s) => (
                      <span
                        key={s}
                        className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 capitalize leading-4"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}

                {/* Outreach angle (description) */}
                {lead.description && (
                  <p className="text-xs text-gray-600 leading-relaxed mb-2">{lead.description}</p>
                )}

                {/* Phone + Mark Contacted */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {lead.phone && (
                      <a
                        href={`tel:${lead.phone}`}
                        className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-blue-600"
                      >
                        <Phone size={11} />
                        {lead.phone}
                      </a>
                    )}
                    {!lead.phone && lead.email && (
                      <a
                        href={`mailto:${lead.email}`}
                        className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-blue-600 truncate max-w-[160px]"
                      >
                        <Mail size={11} />
                        {lead.email}
                      </a>
                    )}
                  </div>
                  <button
                    onClick={() => handleMarkContacted(lead.id)}
                    disabled={marking === lead.id}
                    className="btn-secondary text-[11px] px-2 py-0.5 h-auto flex-none disabled:opacity-50"
                  >
                    {marking === lead.id ? 'Saving…' : 'Mark Contacted'}
                  </button>
                </div>
              </div>
            ))}

            {leads.length < 10 && (
              <div className="px-4 py-3 text-center text-[11px] text-gray-400 border-t border-gray-50">
                Enrich more companies to expand this list
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
