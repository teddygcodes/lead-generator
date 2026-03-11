'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import {
  X,
  Search,
  Link2,
  Link2Off,
  Plus,
  Loader2,
  CheckCircle,
  ExternalLink,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

type FullPermit = {
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
  inspectionAt: string | null
  contractorName: string
  contractorPhone: string | null
  contractorLicense: string | null
  source: string
  externalId: string
  matchConfidence: number | null
  company: { id: string; name: string; status: string } | null
}

type CompanyHit = {
  id: string
  name: string
  county: string | null
  status: string
}

export interface PermitSlideOverProps {
  permitId: string
  onClose: () => void
  onUpdate: () => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusBadge(status: string): string {
  switch (status.toUpperCase()) {
    case 'ISSUED':    return 'bg-green-100 text-green-700'
    case 'APPLIED':   return 'bg-blue-100 text-blue-700'
    case 'INSPECTED': return 'bg-amber-100 text-amber-700'
    case 'CLOSED':    return 'bg-gray-100 text-gray-500'
    default:          return 'bg-gray-100 text-gray-500'
  }
}

function statusDot(status: string): string {
  switch (status) {
    case 'ACTIVE':         return 'bg-green-500'
    case 'QUALIFYING':     return 'bg-blue-500'
    case 'NEW':            return 'bg-gray-400'
    case 'INACTIVE':       return 'bg-amber-400'
    case 'DO_NOT_CONTACT': return 'bg-red-500'
    default:               return 'bg-gray-300'
  }
}

function formatDate(isoStr: string | null): string {
  if (!isoStr) return '—'
  const d = new Date(isoStr)
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

function formatValue(v: number | null): string {
  if (v === null) return '—'
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PermitSlideOver({ permitId, onClose, onUpdate }: PermitSlideOverProps) {
  const [permit, setPermit] = useState<FullPermit | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [hits, setHits] = useState<CompanyHit[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [pendingCreate, setPendingCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createWebsite, setCreateWebsite] = useState('')
  const [createCounty, setCreateCounty] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load full permit on open
  useEffect(() => {
    setLoading(true)
    fetch(`/api/permits/${permitId}`)
      .then(r => r.json())
      .then(data => setPermit(data as FullPermit))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [permitId])

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Debounced company search
  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setHits([]); return }
    setSearchLoading(true)
    try {
      const res = await fetch(`/api/companies?search=${encodeURIComponent(q)}&limit=10`)
      const data = await res.json() as { data: CompanyHit[] }
      setHits(data.data ?? [])
    } catch (err) {
      console.error('[PermitSlideOver] search failed:', err)
    } finally {
      setSearchLoading(false)
    }
  }, [])

  function handleSearchChange(value: string) {
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void runSearch(value), 300)
  }

  async function linkCompany(companyId: string | null) {
    if (!permit) return
    setSaving(true)
    try {
      const patchRes = await fetch(`/api/permits/${permit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })
      const patchData = await patchRes.json() as { cascadeCount?: number }
      const cascadeCount = patchData.cascadeCount ?? 0

      // Re-fetch to get updated company relation
      const updated = await fetch(`/api/permits/${permit.id}`).then(r => r.json()) as FullPermit
      setPermit(updated)
      setSearch('')
      setHits([])
      if (companyId) {
        setSavedMsg(cascadeCount > 0 ? `Linked ✓ — also synced ${cascadeCount} more` : 'Linked ✓')
      } else {
        setSavedMsg('Unlinked')
      }
      setTimeout(() => setSavedMsg(null), 3000)
      onUpdate()
    } catch (err) {
      console.error('[PermitSlideOver] linkCompany failed:', err)
    } finally {
      setSaving(false)
    }
  }

  function normalizeWebsite(url: string): string | undefined {
    const trimmed = url.trim()
    if (!trimmed) return undefined
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  }

  async function createAndLink(name: string, website: string, county: string) {
    if (!permit || !name.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          county: county.trim() || undefined,
          phone: permit.contractorPhone ?? undefined,
          website: normalizeWebsite(website),
          status: 'NEW',
          recordOrigin: 'MANUAL',
        }),
      })
      const data = await res.json() as { id?: string; error?: string }
      if (!res.ok) {
        setCreateError(data.error ?? 'Failed to create company')
        return
      }
      await linkCompany(data.id!)
      setPendingCreate(false)
      setCreateWebsite('')
      setCreateCounty('')
    } catch (err) {
      console.error('[PermitSlideOver] createAndLink failed:', err)
      setCreateError('Network error — please try again')
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-[440px] bg-white shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-900">
            {loading ? 'Loading…' : `Permit #${permit?.permitNumber ?? '—'}`}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-gray-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : !permit ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            Permit not found
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">

            {/* ── Permit details ── */}
            <div className="px-5 py-4 space-y-4">
              {/* Status / type row */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadge(permit.status)}`}>
                  {permit.status}
                </span>
                {permit.isResidential ? (
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600">Residential</span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-600">Commercial</span>
                )}
                <span className="text-xs text-gray-400">{permit.county} Co.</span>
              </div>

              {/* Data grid */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {permit.jobAddress && (
                  <div className="col-span-2">
                    <dt className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Address</dt>
                    <dd className="mt-0.5 text-gray-800">{permit.jobAddress}</dd>
                  </div>
                )}
                {permit.description && (
                  <div className="col-span-2">
                    <dt className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Description</dt>
                    <dd className="mt-0.5 text-gray-800">{permit.description}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Filed</dt>
                  <dd className="mt-0.5 text-gray-800">{formatDate(permit.filedAt)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Issued</dt>
                  <dd className="mt-0.5 text-gray-800">{formatDate(permit.issuedAt)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Value</dt>
                  <dd className="mt-0.5 text-gray-800">{formatValue(permit.jobValue)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Permit Type</dt>
                  <dd className="mt-0.5 text-gray-800">{permit.permitType}</dd>
                </div>
                {permit.contractorLicense && (
                  <div>
                    <dt className="text-[10px] font-medium uppercase tracking-wider text-gray-400">License #</dt>
                    <dd className="mt-0.5 font-mono text-xs text-gray-700">{permit.contractorLicense}</dd>
                  </div>
                )}
                <div className="col-span-2">
                  <dt className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Source</dt>
                  <dd className="mt-0.5 font-mono text-xs text-gray-500">{permit.source} · {permit.externalId}</dd>
                </div>
              </dl>
            </div>

            <div className="border-t border-gray-100 mx-5" />

            {/* ── Contractor from permit ── */}
            <div className="px-5 py-4">
              <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 mb-2">
                Contractor (from permit)
              </p>

              {/* Name + Google search button */}
              <div className="flex items-center gap-2 group">
                <p className="text-sm font-medium text-gray-900">
                  {permit.contractorName || <span className="text-gray-400 italic font-normal">Unknown</span>}
                </p>
                {permit.contractorName && (
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(permit.contractorName + ' electrical contractor ' + permit.county + ' GA')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Search Google for this contractor"
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 transition-all"
                  >
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>

              {/* Phone + Google search button */}
              {permit.contractorPhone && (
                <div className="flex items-center gap-2 group mt-0.5">
                  <p className="text-sm text-gray-500">{permit.contractorPhone}</p>
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(permit.contractorPhone)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Search Google for this phone number"
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 transition-all"
                  >
                    <ExternalLink size={13} />
                  </a>
                </div>
              )}

              {permit.contractorLicense && (
                <p className="text-xs text-gray-400 font-mono mt-0.5">Lic: {permit.contractorLicense}</p>
              )}
            </div>

            <div className="border-t border-gray-100 mx-5" />

            {/* ── Linked Company ── */}
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                  Linked Company
                </p>
                {savedMsg && (
                  <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                    <CheckCircle size={12} />
                    {savedMsg}
                  </span>
                )}
              </div>

              {/* Currently linked company */}
              {permit.company && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${statusDot(permit.company.status)}`} />
                    <Link
                      href={`/companies/${permit.company.id}`}
                      className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline truncate"
                      onClick={e => e.stopPropagation()}
                    >
                      {permit.company.name}
                    </Link>
                    <span className="text-xs text-gray-400 flex-shrink-0">{permit.company.status}</span>
                  </div>
                  <button
                    onClick={() => void linkCompany(null)}
                    disabled={saving}
                    title="Unlink this company"
                    className="flex-shrink-0 flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                  >
                    <Link2Off size={13} />
                    Unlink
                  </button>
                </div>
              )}

              {/* Company search input */}
              <div>
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => handleSearchChange(e.target.value)}
                    placeholder={permit.company ? 'Search to change company…' : 'Search company name…'}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-8 pr-8 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-white transition-colors"
                  />
                  {searchLoading && (
                    <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
                  )}
                </div>

                {/* Search results dropdown */}
                {hits.length > 0 && (
                  <div className="mt-1 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
                    {hits.map(hit => (
                      <button
                        key={hit.id}
                        onClick={() => void linkCompany(hit.id)}
                        disabled={saving}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 disabled:opacity-50"
                      >
                        <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${statusDot(hit.status)}`} />
                        <span className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-900 block truncate">{hit.name}</span>
                          {hit.county && <span className="text-xs text-gray-400">{hit.county}</span>}
                        </span>
                        <Link2 size={13} className="flex-shrink-0 text-gray-300" />
                      </button>
                    ))}
                  </div>
                )}

                {/* No results message */}
                {search.trim() && !searchLoading && hits.length === 0 && (
                  <p className="mt-2 text-xs text-gray-400">No companies match &ldquo;{search}&rdquo;</p>
                )}
              </div>

              {/* Create new company option — only shown when unlinked and contractor name available */}
              {permit.contractorName && !permit.company && (
                <div>
                  <div className="flex items-center gap-2 my-1">
                    <div className="flex-1 border-t border-gray-100" />
                    <span className="text-xs text-gray-400">or</span>
                    <div className="flex-1 border-t border-gray-100" />
                  </div>

                  {!pendingCreate ? (
                    // Step 1: trigger button
                    <button
                      onClick={() => { setPendingCreate(true); setCreateName(permit.contractorName); setCreateCounty(permit.county ?? '') }}
                      disabled={saving}
                      className="w-full flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-sm text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Plus size={14} className="flex-shrink-0" />
                      <span className="text-left">
                        Create <span className="font-medium">&ldquo;{permit.contractorName}&rdquo;</span> as new company
                      </span>
                    </button>
                  ) : (
                    // Step 2: editable name + website + confirm
                    <div className="rounded-lg border border-blue-200 bg-blue-50/40 px-3 py-2.5 space-y-2">
                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-1">Company name</p>
                        <input
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          type="text"
                          value={createName}
                          onChange={e => setCreateName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Escape') { e.stopPropagation(); setPendingCreate(false); setCreateWebsite('') }
                          }}
                          className="w-full rounded border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Company name…"
                        />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-1">Website <span className="font-normal text-gray-400">(optional)</span></p>
                        <input
                          type="text"
                          value={createWebsite}
                          onChange={e => setCreateWebsite(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Escape') { e.stopPropagation(); setPendingCreate(false); setCreateWebsite(''); setCreateCounty('') }
                          }}
                          className="w-full rounded border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="https://…"
                        />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-1">County <span className="font-normal text-gray-400">(optional)</span></p>
                        <input
                          type="text"
                          value={createCounty}
                          onChange={e => setCreateCounty(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && createName.trim()) void createAndLink(createName, createWebsite, createCounty)
                            if (e.key === 'Escape') { e.stopPropagation(); setPendingCreate(false); setCreateWebsite(''); setCreateCounty('') }
                          }}
                          className="w-full rounded border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="e.g. DeKalb"
                        />
                      </div>
                      {createError && (
                        <p className="text-xs text-red-500">{createError}</p>
                      )}
                      <div className="flex items-center gap-2 pt-0.5">
                        <button
                          onClick={() => void createAndLink(createName, createWebsite, createCounty)}
                          disabled={!createName.trim() || creating}
                          className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {creating
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Plus size={12} />
                          }
                          Create & link
                        </button>
                        <button
                          onClick={() => { setPendingCreate(false); setCreateWebsite(''); setCreateCounty(''); setCreateError(null) }}
                          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </>
  )
}
