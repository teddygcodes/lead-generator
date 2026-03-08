'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { Upload, AlertCircle, CheckCircle2, ChevronRight } from 'lucide-react'

type Stage = 'upload' | 'preview' | 'mapping' | 'importing' | 'result'

interface PreviewRow {
  [key: string]: string
}

interface PreviewResponse {
  headers: string[]
  rows: PreviewRow[]
  rowCount: number
  suggestedMapping: Record<string, string>
}

interface ImportResult {
  created: number
  updated: number
  skipped: number
  invalid: number
  errors: Array<{ row: number; error: string }>
}

const KNOWN_FIELDS = [
  { value: 'name', label: 'Company Name' },
  { value: 'website', label: 'Website' },
  { value: 'domain', label: 'Domain' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'street', label: 'Street Address' },
  { value: 'city', label: 'City' },
  { value: 'state', label: 'State' },
  { value: 'zip', label: 'ZIP Code' },
  { value: 'county', label: 'County' },
  { value: 'description', label: 'Description' },
  { value: 'notes', label: 'Notes' },
  { value: '__skip', label: '— Skip this column —' },
]

export function ImportFlow() {
  const [stage, setStage] = useState<Stage>('upload')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFileSelect(selected: File) {
    if (!selected.name.endsWith('.csv')) {
      setError('Only .csv files are accepted.')
      return
    }
    setFile(selected)
    setError(null)
    setLoading(true)

    const formData = new FormData()
    formData.append('file', selected)

    try {
      const res = await fetch('/api/import/csv/preview', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to parse file.')
        setLoading(false)
        return
      }
      setPreview(data)
      setMapping(data.suggestedMapping ?? {})
      setStage('preview')
    } catch {
      setError('Network error during preview.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCommit() {
    if (!file) return
    setLoading(true)
    setError(null)
    setStage('importing')

    const formData = new FormData()
    formData.append('file', file)
    formData.append('fieldMapping', JSON.stringify(mapping))

    try {
      const res = await fetch('/api/import/csv/commit', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Import failed.')
        setStage('mapping')
      } else {
        setResult(data)
        setStage('result')
      }
    } catch {
      setError('Network error during import.')
      setStage('mapping')
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setStage('upload')
    setPreview(null)
    setMapping({})
    setResult(null)
    setError(null)
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        {(['upload', 'preview', 'mapping', 'importing', 'result'] as Stage[]).map((s, i) => (
          <span key={s} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={12} />}
            <span
              className={
                stage === s
                  ? 'text-blue-600 font-medium'
                  : (['upload', 'preview', 'mapping', 'importing', 'result'] as Stage[]).indexOf(stage) > i
                  ? 'text-gray-500'
                  : 'text-gray-300'
              }
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
          </span>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded px-3 py-2.5 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Stage: Upload */}
      {stage === 'upload' && (
        <div
          className="border-2 border-dashed border-gray-200 rounded-lg p-10 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const f = e.dataTransfer.files[0]
            if (f) handleFileSelect(f)
          }}
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFileSelect(f)
            }}
          />
          <Upload size={24} className="mx-auto text-gray-400 mb-3" />
          <p className="text-sm font-medium text-gray-700">Drop a CSV here or click to browse</p>
          <p className="text-xs text-gray-400 mt-1">Max 5 MB. CSV format only.</p>
          {loading && <p className="text-xs text-blue-600 mt-3">Parsing…</p>}
        </div>
      )}

      {/* Stage: Preview */}
      {stage === 'preview' && preview && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              <span className="font-medium">{preview.rowCount}</span> rows detected ·{' '}
              <span className="font-medium">{preview.headers.length}</span> columns
            </div>
            <button onClick={() => setStage('mapping')} className="btn-primary text-xs">
              Proceed to Field Mapping →
            </button>
          </div>
          <div className="overflow-auto border border-gray-200 rounded">
            <table className="text-xs w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {preview.headers.map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.rows.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    {preview.headers.map((h) => (
                      <td key={h} className="px-3 py-1.5 text-gray-700 whitespace-nowrap max-w-[200px] truncate">
                        {row[h] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stage: Mapping */}
      {stage === 'mapping' && preview && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Map each column in your file to a field in the database. Skip columns you do not need.
          </p>
          <div className="bg-white border border-gray-200 rounded divide-y divide-gray-100">
            {preview.headers.map((header) => (
              <div key={header} className="flex items-center gap-4 px-4 py-2.5">
                <span className="text-sm text-gray-700 flex-1 font-medium">{header}</span>
                <span className="text-gray-300 text-xs">→</span>
                <select
                  className="border border-gray-200 rounded px-2 py-1 text-sm bg-white text-gray-700 min-w-[200px]"
                  value={mapping[header] ?? '__skip'}
                  onChange={(e) =>
                    setMapping((prev) => ({ ...prev, [header]: e.target.value }))
                  }
                >
                  {KNOWN_FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-2">
            <button onClick={() => setStage('preview')} className="btn-secondary text-xs">
              ← Back to Preview
            </button>
            <button
              onClick={handleCommit}
              disabled={loading}
              className="btn-primary text-xs"
            >
              {loading ? 'Importing…' : 'Import →'}
            </button>
          </div>
        </div>
      )}

      {/* Stage: Importing */}
      {stage === 'importing' && (
        <div className="text-center py-12">
          <div className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-gray-600">Writing records to database…</p>
        </div>
      )}

      {/* Stage: Result */}
      {stage === 'result' && result && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 size={18} />
            <span className="text-sm font-medium">Import complete</span>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Created', value: result.created, color: 'text-green-700' },
              { label: 'Updated', value: result.updated, color: 'text-blue-700' },
              { label: 'Skipped', value: result.skipped, color: 'text-gray-500' },
              { label: 'Invalid', value: result.invalid, color: 'text-red-600' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white border border-gray-200 rounded p-3 text-center">
                <div className={`text-2xl font-semibold ${color}`}>{value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          {result.errors.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-600 mb-1">Row errors ({result.errors.length})</p>
              <div className="bg-red-50 border border-red-200 rounded divide-y divide-red-100 max-h-48 overflow-y-auto">
                {result.errors.map(({ row, error: err }, i) => (
                  <div key={i} className="px-3 py-1.5 text-xs">
                    <span className="text-gray-500 mr-2">Row {row}:</span>
                    <span className="text-red-700">{err}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button onClick={reset} className="btn-secondary text-xs">
              Import another file
            </button>
            <Link href="/companies" className="btn-primary text-xs">
              View companies →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
