'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { geoPath, geoAlbers } from 'd3-geo'
import type { GeoPermissibleObjects } from 'd3-geo'
import type { FeatureCollection, Feature, Geometry } from 'geojson'

// ---------------------------------------------------------------------------
// Territory counties — North Georgia / Metro Atlanta rep territory
// ---------------------------------------------------------------------------

const TERRITORY_COUNTIES = new Set([
  'Gwinnett', 'Cobb', 'Fulton', 'DeKalb', 'Hall', 'Forsyth', 'Cherokee',
  'Jackson', 'Barrow', 'Walton', 'Newton', 'Rockdale', 'Henry', 'Clayton',
  'Douglas', 'Paulding', 'Bartow', 'Pickens', 'Dawson', 'Lumpkin',
  'White', 'Habersham', 'Banks', 'Franklin', 'Madison', 'Elbert',
])

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ZOOM_MIN = 1
const ZOOM_MAX = 6
const SVG_W = 320
const SVG_H = 380

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CountyMapProps {
  onCountySelect: (countyName: string) => void
  selectedCounty?: string | null
}

interface Transform {
  x: number
  y: number
  k: number
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CountyMap({ onCountySelect, selectedCounty }: CountyMapProps) {
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null)
  const [hoveredCounty, setHoveredCounty] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string } | null>(null)
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 })

  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 })
  const svgRef = useRef<SVGSVGElement>(null)

  // Load GeoJSON once
  useEffect(() => {
    fetch('/data/georgia-counties.json')
      .then((r) => r.json())
      .then((data: FeatureCollection) => setGeojson(data))
      .catch((err) => console.error('[CountyMap] failed to load GeoJSON:', err))
  }, [])

  // Projection + path generator — only computed after GeoJSON is loaded
  const pathGen = useMemo(() => {
    if (!geojson) return null
    const projection = geoAlbers()
      .center([0, 32.5])
      .rotate([83.5, 0])
      .parallels([30, 34])
      .fitSize([SVG_W, SVG_H], geojson as GeoPermissibleObjects)
    return geoPath().projection(projection)
  }, [geojson])

  // ---- Zoom helpers ----

  const zoomBy = useCallback((factor: number) => {
    setTransform((prev) => {
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.k * factor))
      // zoom toward center of SVG
      const cx = SVG_W / 2
      const cy = SVG_H / 2
      const x = cx - (cx - prev.x) * (k / prev.k)
      const y = cy - (cy - prev.y) * (k / prev.k)
      return { x, y, k }
    })
  }, [])

  const resetZoom = useCallback(() => {
    setTransform({ x: 0, y: 0, k: 1 })
  }, [])

  // ---- Wheel zoom ----

  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault()
    const svgEl = svgRef.current
    if (!svgEl) return
    const rect = svgEl.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    setTransform((prev) => {
      const factor = e.deltaY < 0 ? 1.15 : 0.87
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.k * factor))
      const x = mx - (mx - prev.x) * (k / prev.k)
      const y = my - (my - prev.y) * (k / prev.k)
      return { x, y, k }
    })
  }, [])

  // ---- Drag pan ----

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      isDragging.current = true
      dragStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y }
    },
    [transform.x, transform.y],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (isDragging.current) {
        setTransform((prev) => ({
          ...prev,
          x: dragStart.current.tx + (e.clientX - dragStart.current.x),
          y: dragStart.current.ty + (e.clientY - dragStart.current.y),
        }))
      }
    },
    [],
  )

  const stopDrag = useCallback(() => {
    isDragging.current = false
  }, [])

  // ---- County mouse handlers ----

  const handleCountyEnter = useCallback(
    (e: React.MouseEvent<SVGPathElement>, name: string) => {
      if (isDragging.current) return
      setHoveredCounty(name)
      const svgEl = svgRef.current
      if (!svgEl) return
      const rect = svgEl.getBoundingClientRect()
      setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, name })
    },
    [],
  )

  const handleCountyMove = useCallback(
    (e: React.MouseEvent<SVGPathElement>) => {
      if (isDragging.current) {
        setTooltip(null)
        return
      }
      const svgEl = svgRef.current
      if (!svgEl) return
      const rect = svgEl.getBoundingClientRect()
      setTooltip((t) =>
        t ? { ...t, x: e.clientX - rect.left, y: e.clientY - rect.top } : null,
      )
    },
    [],
  )

  const handleCountyLeave = useCallback(() => {
    setHoveredCounty(null)
    setTooltip(null)
  }, [])

  const handleCountyClick = useCallback(
    (name: string) => {
      if (!isDragging.current) onCountySelect(name)
    },
    [onCountySelect],
  )

  // ---- Render ----

  return (
    <div className="flex flex-col h-full select-none">
      {/* Header */}
      <div className="px-3 pt-3 pb-1 flex-shrink-0">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
          Scout Territory
        </p>
      </div>

      {/* Map area */}
      <div className="relative flex-1 overflow-hidden">
        {/* Loading state */}
        {!geojson && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
            Loading map…
          </div>
        )}

        {geojson && pathGen && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="w-full h-full cursor-grab active:cursor-grabbing"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={stopDrag}
            onMouseLeave={() => {
              stopDrag()
              setTooltip(null)
              setHoveredCounty(null)
            }}
          >
            <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
              {geojson.features.map((feature: Feature<Geometry>) => {
                const name = (feature.properties?.NAME ?? '') as string
                const isSelected = selectedCounty === name
                const isHovered = hoveredCounty === name
                const isTerr = TERRITORY_COUNTIES.has(name)

                const fill = isSelected
                  ? '#3b82f6'
                  : isHovered
                  ? '#bfdbfe'
                  : isTerr
                  ? '#dbeafe'
                  : '#f1f5f9'

                const d = pathGen(feature as GeoPermissibleObjects)
                if (!d) return null

                return (
                  <path
                    key={name || feature.id}
                    d={d}
                    fill={fill}
                    stroke="#94a3b8"
                    strokeWidth={0.5 / transform.k}
                    className="cursor-pointer transition-colors duration-75"
                    onClick={() => handleCountyClick(name)}
                    onMouseEnter={(e) => handleCountyEnter(e, name)}
                    onMouseMove={handleCountyMove}
                    onMouseLeave={handleCountyLeave}
                  />
                )
              })}

              {/* Selected county centroid label */}
              {selectedCounty && (() => {
                const f = geojson.features.find(
                  (ft) => ft.properties?.NAME === selectedCounty,
                )
                if (!f) return null
                const centroid = pathGen.centroid(f as GeoPermissibleObjects)
                if (!centroid || isNaN(centroid[0])) return null
                return (
                  <text
                    x={centroid[0]}
                    y={centroid[1]}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={8 / transform.k}
                    fill="white"
                    pointerEvents="none"
                    style={{ userSelect: 'none' }}
                  >
                    {selectedCounty}
                  </text>
                )
              })()}
            </g>
          </svg>
        )}

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute pointer-events-none z-10 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap"
            style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
          >
            {tooltip.name} County
          </div>
        )}

        {/* Zoom controls */}
        <div className="absolute top-2 right-2 flex flex-col gap-0.5">
          <button
            onClick={() => zoomBy(1.3)}
            className="w-6 h-6 rounded bg-white border border-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-50 shadow-sm leading-none"
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={() => zoomBy(0.77)}
            className="w-6 h-6 rounded bg-white border border-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-50 shadow-sm leading-none"
            title="Zoom out"
          >
            −
          </button>
          <button
            onClick={resetZoom}
            className="w-6 h-6 rounded bg-white border border-gray-200 text-gray-400 text-[9px] hover:bg-gray-50 shadow-sm leading-none mt-0.5"
            title="Reset zoom"
          >
            ↺
          </button>
        </div>
      </div>

      {/* Footer status */}
      <div className="flex-shrink-0 px-3 py-2 text-center text-[10px] text-gray-400 border-t border-gray-100">
        {selectedCounty ? (
          <span className="text-blue-600 font-medium">{selectedCounty} County selected</span>
        ) : (
          'Click a county to search'
        )}
      </div>
    </div>
  )
}
