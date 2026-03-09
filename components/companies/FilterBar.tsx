'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'

const SEGMENTS = ['industrial', 'commercial', 'residential', 'mixed']
const STATUSES = [
  { value: 'NEW', label: 'New' },
  { value: 'QUALIFYING', label: 'Qualifying' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
]
// Combined sort+order options — value encodes both as "field:direction"
const SORT_OPTIONS = [
  { value: 'leadScore:desc', label: 'Score: High → Low' },
  { value: 'leadScore:asc',  label: 'Score: Low → High' },
  { value: 'name:asc',       label: 'Name: A → Z' },
  { value: 'name:desc',      label: 'Name: Z → A' },
  { value: 'lastEnrichedAt:desc', label: 'Recently Enriched' },
  { value: 'createdAt:desc', label: 'Date Added: Newest' },
  { value: 'createdAt:asc',  label: 'Date Added: Oldest' },
]

interface FilterBarProps {
  counties: string[]
}

export function FilterBar({ counties }: FilterBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      params.delete('page') // reset to page 1 on filter change
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams],
  )

  const get = (key: string) => searchParams.get(key) ?? ''

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2">
      <div className="relative flex-none w-52">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search name or domain…"
          defaultValue={get('search')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setParam('search', (e.target as HTMLInputElement).value)
          }}
          onBlur={(e) => setParam('search', e.target.value)}
          className="input-field pl-7 h-7 text-xs"
        />
      </div>

      <select
        value={get('county')}
        onChange={(e) => setParam('county', e.target.value)}
        className="input-field h-7 text-xs w-36"
      >
        <option value="">All Counties</option>
        {counties.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        value={get('segment')}
        onChange={(e) => setParam('segment', e.target.value)}
        className="input-field h-7 text-xs w-32"
      >
        <option value="">All Segments</option>
        {SEGMENTS.map((s) => (
          <option key={s} value={s}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </option>
        ))}
      </select>

      <select
        value={get('status')}
        onChange={(e) => setParam('status', e.target.value)}
        className="input-field h-7 text-xs w-32"
      >
        <option value="">All Statuses</option>
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      <select
        value={get('hasWebsite')}
        onChange={(e) => setParam('hasWebsite', e.target.value)}
        className="input-field h-7 text-xs w-28"
      >
        <option value="">Website: Any</option>
        <option value="true">Has Website</option>
        <option value="false">No Website</option>
      </select>

      <input
        type="number"
        placeholder="Min score"
        defaultValue={get('minScore')}
        min={0}
        max={100}
        onBlur={(e) => setParam('minScore', e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setParam('minScore', (e.target as HTMLInputElement).value)
        }}
        className="input-field h-7 text-xs w-20"
      />

      <div className="ml-auto flex items-center gap-2">
        <SlidersHorizontal size={13} className="text-gray-400" />
        <select
          value={`${get('sort') || 'leadScore'}:${get('order') || 'desc'}`}
          onChange={(e) => {
            const [field, dir] = e.target.value.split(':')
            const params = new URLSearchParams(searchParams.toString())
            params.set('sort', field)
            params.set('order', dir)
            params.delete('page')
            router.push(`${pathname}?${params.toString()}`)
          }}
          className="input-field h-7 text-xs w-44"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
