'use client'

import { useState, useCallback } from 'react'
import { Search, Plus, Loader2, Globe, Star, Phone } from 'lucide-react'
import Link from 'next/link'
import { normalizeName, normalizePhone } from '@/lib/normalization'
import type { PlaceResult } from '@/lib/sources/google-places'
import { CountyMap } from './CountyMap'

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const DEFAULT_PRESETS = [
  'Electricians Gwinnett County GA',
  'Electricians Hall County GA',
  'Commercial Electrician Forsyth County',
  'Electrical Contractors Cobb County',
  'EV Charger Installers Atlanta GA',
  'Industrial Electricians North Georgia',
]

function getPresetsForCounty(county: string | null): string[] {
  if (!county) return DEFAULT_PRESETS
  return [
    `Electrical Contractors ${county} County GA`,
    `Commercial Electrician ${county} County GA`,
    `Industrial Electrician ${county} GA`,
    `Low Voltage Contractor ${county} County GA`,
    `EV Charger Installer ${county} GA`,
    `Generator Installation ${county} GA`,
  ]
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StatusEntry {
  inDB: boolean
  hasActivePermit: boolean
  companyId?: string
}

type StatusMap = Record<string, StatusEntry>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPhone(raw: string | null): string {
  if (!raw) return '—'
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return raw
}

function formatRating(rating: number | null): string {
  if (rating == null) return '—'
  return `${rating.toFixed(1)} ★`
}

function shortDomain(url: string | null): string {
  if (!url) return '—'
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProspectingView() {
  const [query, setQuery] = useState('Electricians Gwinnett County GA')
  const [activePreset, setActivePreset] = useState<string | null>(null)
  const [selectedCounty, setSelectedCounty] = useState<string | null>(null)
  const [results, setResults] = useState<PlaceResult[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | undefined>()
  const [statusMap, setStatusMap] = useState<StatusMap>({})
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [isAddingAll, setIsAddingAll] = useState(false)
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [configMissing, setConfigMissing] = useState(false)
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null)

  function showToast(message: string, variant: 'success' | 'error' = 'success') {
    setToast({ message, variant })
    setTimeout(() => setToast(null), 4000)
  }

  // ---- Check DB status for a list of places ----
  const checkStatus = useCallback(async (places: PlaceResult[]) => {
    if (places.length === 0) return
    setIsChecking(true)
    try {
      const phones = places
        .map((p) => normalizePhone(p.phone))
        .filter((p): p is string => Boolean(p))
        .join(',')
      const names = places
        .map((p) => normalizeName(p.name))
        .filter(Boolean)
        .join(',')
      const placeIds = places.map((p) => p.placeId).filter(Boolean).join(',')

      const params = new URLSearchParams()
      if (phones) params.set('phones', phones)
      if (names) params.set('names', names)
      if (placeIds) params.set('placeIds', placeIds)

      const res = await fetch(`/api/places/check?${params}`)
      if (!res.ok) return

      const data = (await res.json()) as {
        byPhone: Record<string, { companyId: string; companyName: string; recordOrigin: string; hasActivePermit: boolean }>
        byName: Record<string, { companyId: string; companyName: string; recordOrigin: string; hasActivePermit: boolean }>
        byPlaceId: Record<string, { companyId: string; companyName: string; recordOrigin: string; hasActivePermit: boolean }>
      }

      setStatusMap((prev) => {
        const next = { ...prev }
        for (const place of places) {
          const normalizedPhone = normalizePhone(place.phone) ?? ''
          const normalizedNameVal = normalizeName(place.name)
          // Prefer googlePlaceId match (most precise) over phone/name fuzzy match
          const match =
            data.byPlaceId[place.placeId] ??
            data.byPhone[normalizedPhone] ??
            data.byName[normalizedNameVal]
          next[place.placeId] = {
            inDB: Boolean(match),
            hasActivePermit: match?.hasActivePermit ?? false,
            companyId: match?.companyId,
          }
        }
        return next
      })
    } catch {
      // Non-critical — status will just show as unknown
    } finally {
      setIsChecking(false)
    }
  }, [])

  // ---- Core search logic (accepts query string directly to avoid stale state) ----
  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) return
    setIsSearching(true)
    setError(null)
    setConfigMissing(false)
    setResults([])
    setStatusMap({})
    setNextPageToken(undefined)

    try {
      const res = await fetch(`/api/places/search?query=${encodeURIComponent(q.trim())}`)
      if (!res.ok) {
        const body = await res.json()
        if (body.error === 'GOOGLE_PLACES_NOT_CONFIGURED') {
          setConfigMissing(true)
          return
        }
        setError(body.error ?? 'Search failed')
        return
      }
      const data = (await res.json()) as { results: PlaceResult[]; nextPageToken?: string }
      setResults(data.results)
      setNextPageToken(data.nextPageToken)
      await checkStatus(data.results)
    } catch {
      setError('Network error — please try again')
    } finally {
      setIsSearching(false)
    }
  }, [checkStatus])

  // ---- Manual search button ----
  const handleSearch = () => {
    setActivePreset(null)
    runSearch(query)
  }

  // ---- Preset click — populate query + immediately search ----
  const handlePreset = (preset: string) => {
    setActivePreset(preset)
    setQuery(preset)
    runSearch(preset)
  }

  // ---- County map click ----
  const handleCountySelect = useCallback((county: string) => {
    setSelectedCounty(county)
    setActivePreset(null)
    const q = `Electrical Contractors ${county} County GA`
    setQuery(q)
    runSearch(q)
  }, [runSearch])

  // ---- Clear county filter ----
  const handleClearCounty = () => {
    setSelectedCounty(null)
    setActivePreset(null)
  }

  // ---- Load more ----
  const handleLoadMore = async () => {
    if (!nextPageToken) return
    setIsLoadingMore(true)
    try {
      const res = await fetch(
        `/api/places/search?query=${encodeURIComponent(query.trim())}&pageToken=${encodeURIComponent(nextPageToken)}`,
      )
      if (!res.ok) return
      const data = (await res.json()) as { results: PlaceResult[]; nextPageToken?: string }
      const newResults = data.results
      setResults((prev) => [...prev, ...newResults])
      setNextPageToken(data.nextPageToken)
      await checkStatus(newResults)
    } catch {
      // silently fail
    } finally {
      setIsLoadingMore(false)
    }
  }

  // ---- Add single place ----
  const handleAdd = async (place: PlaceResult) => {
    setAddingIds((prev) => new Set(prev).add(place.placeId))
    try {
      const res = await fetch('/api/places/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          places: [{
            placeId: place.placeId,
            name: place.name,
            phone: place.phone,
            address: place.formattedAddress,
            rating: place.rating,
            website: place.website,
          }],
        }),
      })
      if (res.ok) {
        const data = (await res.json()) as { created: number; updated: number; skipped: number }
        setStatusMap((prev) => ({
          ...prev,
          [place.placeId]: { inDB: true, hasActivePermit: false },
        }))
        showToast(
          data.created > 0 ? 'Added 1 new contractor'
          : data.updated > 0 ? 'Already in database (updated)'
          : 'Already in database'
        )
      } else {
        showToast('Failed to add — check console', 'error')
      }
    } catch {
      showToast('Failed to add — check console', 'error')
    } finally {
      setAddingIds((prev) => {
        const next = new Set(prev)
        next.delete(place.placeId)
        return next
      })
    }
  }

  // ---- Add all new ----
  const handleAddAll = async () => {
    const newPlaces = results.filter((p) => !statusMap[p.placeId]?.inDB)
    if (newPlaces.length === 0) return
    setIsAddingAll(true)
    try {
      const res = await fetch('/api/places/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          places: newPlaces.map((p) => ({
            placeId: p.placeId,
            name: p.name,
            phone: p.phone,
            address: p.formattedAddress,
            rating: p.rating,
            website: p.website,
          })),
        }),
      })
      if (res.ok) {
        const data = (await res.json()) as { created: number; updated: number; skipped: number }
        setStatusMap((prev) => {
          const next = { ...prev }
          for (const p of newPlaces) {
            next[p.placeId] = { inDB: true, hasActivePermit: false }
          }
          return next
        })
        const msg =
          data.created > 0
            ? `Added ${data.created} new contractor${data.created !== 1 ? 's' : ''}${data.updated > 0 ? ` · ${data.updated} already existed` : ''}`
            : data.skipped > 0
            ? `All already in database (${data.skipped} skipped)`
            : 'All already in database'
        showToast(msg)
      } else {
        showToast('Failed to add — check console', 'error')
      }
    } catch {
      showToast('Failed to add — check console', 'error')
    } finally {
      setIsAddingAll(false)
    }
  }

  const newCount = results.filter((p) => !statusMap[p.placeId]?.inDB).length
  const presets = getPresetsForCounty(selectedCounty)

  return (
    <>
      {/* ----------------------------------------------------------------- */}
      {/* LEFT — County map panel (non-scrolling)                           */}
      {/* ----------------------------------------------------------------- */}
      <div className="w-80 flex-shrink-0 border-r border-gray-200 flex flex-col bg-white">
        <CountyMap onCountySelect={handleCountySelect} selectedCounty={selectedCounty} />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* RIGHT — Search + results (independently scrolling)               */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-4 space-y-3">
          {/* Page title */}
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Prospecting</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Search Google Places to discover new electrical contractors and add them to your database.
            </p>
          </div>

          {/* Config missing banner */}
          {configMissing && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <strong>Google Places API key not configured.</strong>{' '}
              Add <code className="font-mono text-xs">GOOGLE_PLACES_API_KEY</code> to your environment variables.
            </div>
          )}

          {/* Search card */}
          <div className="card p-3">
            {/* County filter chip */}
            {selectedCounty && (
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5">
                  {selectedCounty} County
                </span>
                <button
                  onClick={handleClearCounty}
                  className="text-gray-400 hover:text-gray-600 text-sm leading-none"
                  title="Clear county filter"
                >
                  ×
                </button>
                <span className="text-[10px] text-gray-400">— click another county or search freely</span>
              </div>
            )}

            {/* Preset pills */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {presets.map((preset) => (
                <button
                  key={preset}
                  onClick={() => handlePreset(preset)}
                  disabled={isSearching}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50
                    ${activePreset === preset
                      ? 'border border-blue-400 bg-blue-50 text-blue-700'
                      : 'border border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100'
                    }`}
                >
                  {preset}
                </button>
              ))}
            </div>

            {/* Search input row */}
            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActivePreset(null)
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="electricians Hall County GA"
                className="flex-1 rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none"
              />
              <button
                onClick={handleSearch}
                disabled={isSearching || !query.trim()}
                className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-50"
              >
                {isSearching ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Search size={13} />
                )}
                Search
              </button>
            </div>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </div>

          {/* Results */}
          {results.length > 0 && (
            <div className="card">
              {/* Table header */}
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
                <span className="text-xs font-medium text-gray-700">
                  {results.length} result{results.length !== 1 ? 's' : ''}
                  {isChecking && (
                    <span className="ml-2 text-gray-400">
                      <Loader2 size={11} className="inline animate-spin" /> checking DB…
                    </span>
                  )}
                </span>
                {newCount > 0 && (
                  <button
                    onClick={handleAddAll}
                    disabled={isAddingAll}
                    className="btn-primary flex items-center gap-1.5 text-xs disabled:opacity-50"
                  >
                    {isAddingAll ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Plus size={11} />
                    )}
                    Add All New ({newCount})
                  </button>
                )}
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-left text-gray-500">
                      <th className="px-4 py-2 font-medium">Business Name</th>
                      <th className="px-4 py-2 font-medium">Phone</th>
                      <th className="px-4 py-2 font-medium">Address</th>
                      <th className="px-4 py-2 font-medium">Rating</th>
                      <th className="px-4 py-2 font-medium">Website</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {results.map((place) => {
                      const status = statusMap[place.placeId]
                      const isAdding = addingIds.has(place.placeId)

                      return (
                        <tr key={place.placeId} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5">
                            <span className="font-medium text-gray-800">{place.name}</span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-600">
                            {place.phone ? (
                              <a
                                href={`tel:${place.phone}`}
                                className="flex items-center gap-1 hover:text-blue-600"
                              >
                                <Phone size={10} />
                                {formatPhone(place.phone)}
                              </a>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-gray-500 max-w-[200px] truncate">
                            {place.formattedAddress ?? '—'}
                          </td>
                          <td className="px-4 py-2.5 text-gray-600">
                            {place.rating != null ? (
                              <span className="flex items-center gap-0.5">
                                <Star size={10} className="text-amber-400" />
                                {formatRating(place.rating)}
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            {place.website ? (
                              <a
                                href={place.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-blue-600 hover:underline truncate max-w-[140px]"
                              >
                                <Globe size={10} />
                                {shortDomain(place.website)}
                              </a>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusCell
                              status={status}
                              isAdding={isAdding}
                              onAdd={() => handleAdd(place)}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Load More */}
              {nextPageToken && (
                <div className="border-t border-gray-100 px-4 py-3 text-center">
                  <button
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                    className="btn-secondary flex items-center gap-1.5 text-xs mx-auto disabled:opacity-50"
                  >
                    {isLoadingMore && <Loader2 size={11} className="animate-spin" />}
                    Load More
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 max-w-xs rounded-lg px-4 py-3 text-sm font-medium shadow-lg
            ${toast.variant === 'success' ? 'bg-gray-900 text-white' : 'bg-red-600 text-white'}`}
        >
          {toast.message}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// StatusCell sub-component
// ---------------------------------------------------------------------------

function StatusCell({
  status,
  isAdding,
  onAdd,
}: {
  status: StatusEntry | undefined
  isAdding: boolean
  onAdd: () => void
}) {
  if (isAdding) {
    return (
      <span className="flex items-center gap-1 text-gray-400">
        <Loader2 size={11} className="animate-spin" />
        Adding…
      </span>
    )
  }

  if (!status) {
    // Still checking — show Add button as default
    return (
      <button
        onClick={onAdd}
        className="flex items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-blue-700"
      >
        <Plus size={10} />
        Add
      </button>
    )
  }

  // In DB + active permit → green badge linking to company detail
  if (status.inDB && status.hasActivePermit) {
    return (
      <Link href={`/companies/${status.companyId}`}>
        <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700 hover:bg-green-100 cursor-pointer">
          In DB · Active Permit
        </span>
      </Link>
    )
  }

  // In DB, no active permit → gray badge, no action
  if (status.inDB) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
        In DB
      </span>
    )
  }

  // Not in DB → blue Add button
  return (
    <button
      onClick={onAdd}
      className="flex items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-blue-700"
    >
      <Plus size={10} />
      Add
    </button>
  )
}
