'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import { CountyPanel } from './CountyPanel'

interface CountyData {
  county: string
  totalCompanies: number
  highScoreCount: number
  uncontactedCount: number
  avgScore: number
  topLead: { name: string; score: number } | null
}

interface TooltipState {
  data: CountyData
  x: number
  y: number
}

const PRIORITY_COUNTIES = new Set([
  'Fulton', 'Gwinnett', 'Cobb', 'Forsyth', 'Hall', 'Cherokee',
  'Barrow', 'Jackson', 'DeKalb', 'Paulding', 'Henry', 'Douglas',
])

const MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#f3f4f6' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', stylers: [{ color: '#bfdbfe' }] },
  { featureType: 'landscape', stylers: [{ color: '#f9fafb' }] },
]

function colorScale(count: number): string {
  if (count === 0) return '#e5e7eb'
  if (count < 5)  return '#bfdbfe'
  if (count < 10) return '#60a5fa'
  if (count < 20) return '#2563eb'
  return '#1e3a8a'
}

export function TerritoryMap() {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInitialized = useRef(false)
  const [selectedCounty, setSelectedCounty] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mapLoading, setMapLoading] = useState(true)

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  const initMap = useCallback(
    async (data: Map<string, CountyData>) => {
      if (!mapRef.current || !apiKey || mapInitialized.current) return

      // Mark as in-progress so concurrent calls are blocked.
      // Reset to false in the catch block so a retry is possible.
      mapInitialized.current = true

      try {
        setOptions({ key: apiKey, v: 'weekly' })
        const { Map: GMap } = await importLibrary('maps') as google.maps.MapsLibrary

        const map = new GMap(mapRef.current, {
          center: { lat: 32.75, lng: -83.5 },
          zoom: 7,
          scrollwheel: false,
          disableDefaultUI: true,
          styles: MAP_STYLES,
        })

        // Set style BEFORE adding GeoJSON so features get the function applied on load
        map.data.setStyle((feature) => {
          const name = feature.getProperty('NAME') as string
          const countyData = data.get(name.toLowerCase())
          const count = countyData?.uncontactedCount ?? 0
          const isPriority = PRIORITY_COUNTIES.has(name)
          return {
            fillColor: colorScale(count),
            fillOpacity: 0.75,
            strokeColor: '#9ca3af',
            strokeWeight: isPriority ? 2 : 0.8,
            cursor: 'pointer',
          }
        })

        // Load committed GeoJSON from /public/data/
        const res = await fetch('/data/georgia-counties.json')
        if (!res.ok) throw new Error(`GeoJSON fetch failed: ${res.status}`)
        const geoJson = await res.json() as object
        map.data.addGeoJson(geoJson)

        // Hover tooltip
        map.data.addListener('mouseover', (e: google.maps.Data.MouseEvent) => {
          const name = e.feature.getProperty('NAME') as string
          const countyData = data.get(name.toLowerCase())
          if (!countyData || !e.domEvent) return
          const evt = e.domEvent as MouseEvent
          setTooltip({ data: countyData, x: evt.clientX, y: evt.clientY })
          map.data.overrideStyle(e.feature, { fillOpacity: 0.95, strokeWeight: 2, strokeColor: '#374151' })
        })

        map.data.addListener('mousemove', (e: google.maps.Data.MouseEvent) => {
          if (!e.domEvent) return
          const evt = e.domEvent as MouseEvent
          setTooltip((prev) => (prev ? { ...prev, x: evt.clientX, y: evt.clientY } : null))
        })

        map.data.addListener('mouseout', () => {
          setTooltip(null)
          map.data.revertStyle()
        })

        // Click → open county panel (fixed-position, outside map z-index stack)
        map.data.addListener('click', (e: google.maps.Data.MouseEvent) => {
          const name = e.feature.getProperty('NAME') as string
          setSelectedCounty(name)
        })

        setMapLoading(false)
      } catch (err) {
        // Reset guard so callers can retry if needed
        mapInitialized.current = false
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[TerritoryMap] initMap failed:', msg)
        setError(`Map failed to load: ${msg}`)
      }
    },
    [apiKey],
  )

  useEffect(() => {
    if (!apiKey) return
    fetch('/api/dashboard/map-data')
      .then((r) => {
        if (!r.ok) throw new Error(`map-data ${r.status}`)
        return r.json()
      })
      .then(async (json) => {
        if (!Array.isArray(json.counties)) {
          throw new Error('Unexpected map-data response')
        }
        const m = new Map<string, CountyData>()
        for (const c of json.counties as CountyData[]) {
          m.set(c.county.toLowerCase(), c)
        }
        // await so errors from initMap reach the .catch() below
        await initMap(m)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[TerritoryMap] data fetch failed:', msg)
        setError(`Failed to load map data: ${msg}`)
        setMapLoading(false)
      })
  }, [apiKey, initMap])

  if (!apiKey) {
    return (
      <div className="card flex h-[500px] items-center justify-center">
        <p className="text-sm text-gray-400 text-center px-6">
          Add{' '}
          <code className="font-mono bg-gray-100 px-1 py-0.5 rounded text-xs">
            NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
          </code>{' '}
          to{' '}
          <code className="font-mono bg-gray-100 px-1 py-0.5 rounded text-xs">.env.local</code>{' '}
          to enable the territory map
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card flex h-[500px] items-center justify-center">
        <p className="text-sm text-red-400 text-center px-6">{error}</p>
      </div>
    )
  }

  return (
    <>
      {/* Map card */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
          <span className="text-xs font-medium text-gray-700">Georgia Territory Map</span>
          <div className="flex items-center gap-3 text-[10px] text-gray-500">
            {[
              { color: '#e5e7eb', border: true, label: '0' },
              { color: '#bfdbfe', label: '1–4' },
              { color: '#60a5fa', label: '5–9' },
              { color: '#2563eb', label: '10–19' },
              { color: '#1e3a8a', label: '20+' },
            ].map(({ color, border, label }) => (
              <span key={label} className="flex items-center gap-1">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-sm${border ? ' border border-gray-300' : ''}`}
                  style={{ backgroundColor: color }}
                />
                {label}
              </span>
            ))}
            <span className="text-gray-300">uncontacted 60+</span>
          </div>
        </div>

        {/* Loading shimmer overlaid on the map div */}
        <div className="relative" style={{ height: 460 }}>
          {mapLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
              <div className="flex flex-col items-center gap-2">
                <div className="h-6 w-6 rounded-full border-2 border-blue-200 border-t-blue-500 animate-spin" />
                <p className="text-xs text-gray-400">Loading territory map…</p>
              </div>
            </div>
          )}
          <div ref={mapRef} className="absolute inset-0" />
        </div>
      </div>

      {/* County panel — fixed position so it's outside the Maps z-index stack */}
      {selectedCounty && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: 340,
            zIndex: 1000,
          }}
          className="border-l border-gray-200 bg-white shadow-2xl"
        >
          <CountyPanel county={selectedCounty} onClose={() => setSelectedCounty(null)} />
        </div>
      )}

      {/* Hover tooltip — fixed position */}
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            top: tooltip.y + 12,
            left: Math.min(tooltip.x + 12, window.innerWidth - 220),
            zIndex: 9999,
            width: 200,
          }}
          className="pointer-events-none rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
        >
          <p className="text-xs font-semibold text-gray-900 mb-1.5">{tooltip.data.county} County</p>
          <div className="space-y-0.5 text-[11px] text-gray-600">
            <p>Total companies: <span className="font-medium text-gray-900">{tooltip.data.totalCompanies}</span></p>
            <p>Score 60+: <span className="font-medium text-gray-900">{tooltip.data.highScoreCount}</span></p>
            <p>Uncontacted: <span className="font-medium text-blue-700">{tooltip.data.uncontactedCount}</span></p>
            <p>Avg score: <span className="font-medium text-gray-900">{tooltip.data.avgScore}</span></p>
            {tooltip.data.topLead && (
              <p className="pt-1 mt-1 border-t border-gray-100">
                Top: <span className="font-medium text-gray-900">{tooltip.data.topLead.name}</span>{' '}
                <span className="text-green-700">({tooltip.data.topLead.score})</span>
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
