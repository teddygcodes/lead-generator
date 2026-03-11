import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { scoreCompany } from '@/lib/scoring'
import { StatusBadge, Badge } from '@/components/ui/Badge'
import { formatDate, formatPhone } from '@/lib/format'
import { Globe, Phone, Mail, MapPin, Calendar, Radio, Users, Tag, FileText } from 'lucide-react'
import Link from 'next/link'
import { EnrichButton } from '@/components/companies/EnrichButton'
import { WebsiteEditor } from '@/components/companies/WebsiteEditor'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export default async function CompanyDetailPage({ params }: Params) {
  const { id } = await params

  const company = await db.company.findUnique({
    where: { id },
    include: {
      signals: { orderBy: { signalDate: 'desc' }, take: 50 },
      contacts: { orderBy: { confidenceScore: 'desc' }, take: 50 },
      userNotes: { orderBy: { createdAt: 'desc' }, take: 5 },
      tags: { include: { tag: true } },
      permits: { orderBy: { filedAt: 'desc' }, take: 50 },
    },
  })

  if (!company) notFound()

  const score = scoreCompany({
    county: company.county,
    state: company.state,
    segments: company.segments,
    specialties: company.specialties,
    description: company.description,
    website: company.website,
    email: company.email,
    phone: company.phone,
    street: company.street,
    sourceConfidence: company.sourceConfidence,
    permitSignalScore: company.permitSignalScore,
    permitCount30Days: company.permitCount30Days,
    signals: company.signals,
    contacts: company.contacts,
  })

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Identity band — above fold, order: identity → contactability → score → reasons → outreach → enrichment status */}
      <div className="card p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-semibold text-gray-900">{company.name}</h1>
              <StatusBadge status={company.status} />
              {company.doNotContact && (
                <Badge variant="red">Do Not Contact</Badge>
              )}
            </div>
            {/* Location */}
            <div className="mt-1 flex items-center gap-3 text-xs text-gray-500 flex-wrap">
              {(company.city || company.county) && (
                <span className="flex items-center gap-1">
                  <MapPin size={11} />
                  {[company.street, company.city, company.county && `${company.county} Co.`, company.state, company.zip]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              )}
              {company.territory && (
                <span className="text-gray-400">Territory: {company.territory}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-none">
            {company.website && (
              <EnrichButton companyId={company.id} />
            )}
            <Link href="/companies" className="btn-secondary text-xs">
              ← Back
            </Link>
          </div>
        </div>

        {/* Contactability row */}
        <div className="mt-3 flex items-center gap-4 flex-wrap">
          <WebsiteEditor
            companyId={company.id}
            initialWebsite={company.website}
            initialDomain={company.domain}
          />
          {company.phone && (
            <a
              href={`tel:${company.phone}`}
              className="flex items-center gap-1 text-xs text-gray-700 hover:text-blue-600"
            >
              <Phone size={12} />
              {formatPhone(company.phone)}
            </a>
          )}
          {company.email && (
            <a
              href={`mailto:${company.email}`}
              className="flex items-center gap-1 text-xs text-gray-700 hover:text-blue-600"
            >
              <Mail size={12} />
              {company.email}
            </a>
          )}
        </div>
      </div>

      {/* Score + Reasons + Outreach — above fold */}
      <div className="grid grid-cols-3 gap-3">
        {/* Scores */}
        <div className="card p-3">
          <p className="text-xs font-medium text-gray-500 mb-2">Lead Score</p>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold text-gray-900">{score.leadScore}</span>
            <span className="text-xs text-gray-400 mb-1">/ 100</span>
          </div>
          <div className="mt-2">
            <p className="text-xs text-gray-500">Active Score</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="flex-1 h-1.5 rounded-full bg-gray-100">
                <div
                  className="h-1.5 rounded-full bg-blue-400"
                  style={{ width: `${Math.min(score.activeScore, 100)}%` }}
                />
              </div>
              <span className="text-xs text-gray-600 font-medium">{score.activeScore}</span>
            </div>
          </div>
        </div>

        {/* Score reasons */}
        <div className="card p-3 col-span-2">
          <p className="text-xs font-medium text-gray-500 mb-2">Score Reasons</p>
          {score.reasons.length === 0 ? (
            <p className="text-xs text-gray-400">No scoring signals available</p>
          ) : (
            <ul className="space-y-1">
              {score.reasons.map((reason, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-gray-700">
                  <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-green-400 flex-none" />
                  {reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Outreach angle */}
      <div className="card p-3 bg-blue-50 border-blue-100">
        <p className="text-xs font-medium text-blue-700 mb-1">Outreach Angle</p>
        <p className="text-sm text-blue-900">{score.outreachAngle}</p>
      </div>

      {/* Enrichment status */}
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <Calendar size={12} />
        <span>
          Last enriched:{' '}
          {company.lastEnrichedAt ? (
            <span className="text-gray-700">{formatDate(company.lastEnrichedAt)}</span>
          ) : (
            <span className="text-gray-400">Not yet enriched</span>
          )}
        </span>
        {company.sourceConfidence !== null && company.sourceConfidence !== undefined && company.sourceConfidence > 0 && (
          <span>Confidence: {Math.round(company.sourceConfidence * 100)}%</span>
        )}
      </div>

      {/* Below fold: segments, specialties, AI summary, product demand */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-3">
          <p className="text-xs font-medium text-gray-500 mb-2">Segments</p>
          {company.segments.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {company.segments.map((s) => (
                <Badge key={s} variant="blue" className="capitalize">
                  {s}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">Not classified — enrich to classify</p>
          )}
        </div>
        <div className="card p-3">
          <p className="text-xs font-medium text-gray-500 mb-2">Specialties</p>
          {company.specialties.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {company.specialties.map((s) => (
                <Badge key={s} variant="default" className="capitalize">
                  {s}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">No specialties detected yet</p>
          )}
        </div>
      </div>

      {/* AI summary + product demand */}
      <div className="card p-3">
        <p className="text-xs font-medium text-gray-500 mb-1">AI Summary</p>
        {company.description ? (
          <p className="text-sm text-gray-700">{company.description}</p>
        ) : (
          <p className="text-xs text-gray-400">
            Not yet enriched. Click &quot;Enrich&quot; to extract website content and classify this company.
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3">
          <p className="text-xs font-medium text-gray-500 mb-1">Likely Product Demand</p>
          {score.likelyProductDemandCategories.length > 0 ? (
            <ul className="space-y-0.5">
              {score.likelyProductDemandCategories.map((cat) => (
                <li key={cat} className="text-xs text-gray-700">
                  {cat}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-400">—</p>
          )}
        </div>
        <div className="card p-3">
          <p className="text-xs font-medium text-gray-500 mb-1">Sales Motion</p>
          <p className="text-xs text-gray-700">{score.likelySalesMotion}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs font-medium text-gray-500 mb-1">Buyer Value</p>
          <p className="text-xs text-gray-700">{score.likelyBuyerValue}</p>
        </div>
      </div>

      {/* Signals timeline */}
      <div className="card">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
          <Radio size={13} className="text-gray-400" />
          <span className="text-xs font-medium text-gray-700">Signals ({company.signals.length})</span>
        </div>
        {company.signals.length === 0 ? (
          <div className="px-4 py-6 text-xs text-gray-400 text-center">No signals recorded</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {company.signals.map((signal) => (
              <div key={signal.id} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-700">{signal.title ?? signal.signalType}</span>
                      <Badge variant="gray" className="text-2xs">{signal.signalType}</Badge>
                      {signal.sourceUrl && (
                        <a
                          href={signal.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline truncate max-w-[160px]"
                        >
                          {signal.sourceName ?? 'Source'}
                        </a>
                      )}
                    </div>
                    {signal.snippet && (
                      <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{signal.snippet}</p>
                    )}
                  </div>
                  <span className="flex-none text-xs text-gray-400">
                    {formatDate(signal.signalDate ?? signal.createdAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Contacts */}
      <div className="card">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
          <Users size={13} className="text-gray-400" />
          <span className="text-xs font-medium text-gray-700">Contacts ({company.contacts.length})</span>
        </div>
        {company.contacts.length === 0 ? (
          <div className="px-4 py-6 text-xs text-gray-400 text-center">No contacts on file</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {company.contacts.map((contact) => (
              <div key={contact.id} className="flex items-center gap-4 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-800">{contact.name ?? '—'}</p>
                  {contact.title && <p className="text-xs text-gray-500">{contact.title}</p>}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {contact.phone && (
                    <a href={`tel:${contact.phone}`} className="text-gray-600 hover:text-blue-600">
                      {formatPhone(contact.phone)}
                    </a>
                  )}
                  {contact.email && (
                    <a href={`mailto:${contact.email}`} className="text-gray-600 hover:text-blue-600">
                      {contact.email}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Permits */}
      <div className="card">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
          <FileText size={13} className="text-gray-400" />
          <span className="text-xs font-medium text-gray-700">Permits ({company.permits.length})</span>
        </div>
        {company.permits.length === 0 ? (
          <div className="px-4 py-6 text-xs text-gray-400 text-center">No permits on file</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {company.permits.map((permit) => {
              const statusColor =
                { ISSUED: 'bg-green-100 text-green-700', INSPECTED: 'bg-blue-100 text-blue-700' }[
                  permit.status.toUpperCase()
                ] ?? 'bg-gray-100 text-gray-500'
              const detailParts = [
                permit.jobAddress,
                permit.description,
                permit.county,
              ].filter(Boolean)
              return (
                <div key={permit.id} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-gray-800">{permit.permitNumber}</span>
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 leading-4">
                          {permit.permitType}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium leading-4 ${statusColor}`}>
                          {permit.status}
                        </span>
                        {permit.isResidential && (
                          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600 leading-4">
                            Residential
                          </span>
                        )}
                      </div>
                      {detailParts.length > 0 && (
                        <p className="mt-0.5 text-xs text-gray-500 line-clamp-1">
                          {detailParts.join(' · ')}
                        </p>
                      )}
                    </div>
                    <span className="flex-none text-xs text-gray-400">
                      {formatDate(permit.filedAt)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Notes/Tags placeholder */}
      <div className="card p-3 border-dashed">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Tag size={12} />
          <span>Notes &amp; Tags — coming later</span>
        </div>
      </div>
    </div>
  )
}
