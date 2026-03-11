'use client'

import { useState, useRef } from 'react'
import { Globe, Pencil, X, Check, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface WebsiteEditorProps {
  companyId: string
  initialWebsite: string | null
  initialDomain: string | null
}

export function WebsiteEditor({ companyId, initialWebsite, initialDomain }: WebsiteEditorProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initialWebsite ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  function startEdit() {
    setValue(initialWebsite ?? '')
    setError(null)
    setEditing(true)
    // Focus after the input mounts
    setTimeout(() => inputRef.current?.focus(), 30)
  }

  function cancel() {
    setEditing(false)
    setError(null)
  }

  async function save() {
    let url = value.trim()

    // Normalize: add https:// if the user typed a bare domain
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`
    }

    // Client-side URL check before hitting the API
    if (url) {
      try {
        new URL(url)
      } catch {
        setError('Please enter a valid URL (e.g. https://example.com)')
        return
      }
    }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/companies/${companyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website: url || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'Failed to save')
      } else {
        setEditing(false)
        router.refresh()
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  // ── Edit mode ──────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <span className="flex items-center gap-1 flex-wrap">
        <Globe size={12} className="text-gray-400 flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') cancel()
          }}
          placeholder="https://example.com"
          disabled={saving}
          className="text-xs border border-blue-300 rounded px-1.5 py-0.5 w-52 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        />
        {saving ? (
          <Loader2 size={12} className="text-gray-400 animate-spin" />
        ) : (
          <>
            <button
              onClick={() => void save()}
              className="text-green-600 hover:text-green-800 transition-colors"
              title="Save"
            >
              <Check size={13} />
            </button>
            <button
              onClick={cancel}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              title="Cancel"
            >
              <X size={13} />
            </button>
          </>
        )}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </span>
    )
  }

  // ── Website set — show link + hover pencil ─────────────────────────────────
  if (initialWebsite) {
    return (
      <span className="flex items-center gap-1 group">
        <a
          href={initialWebsite.startsWith('http') ? initialWebsite : `https://${initialWebsite}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
        >
          <Globe size={12} />
          {initialDomain ?? initialWebsite}
        </a>
        <button
          onClick={startEdit}
          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-opacity"
          title="Edit website"
        >
          <Pencil size={11} />
        </button>
      </span>
    )
  }

  // ── No website — show prompt ───────────────────────────────────────────────
  return (
    <button
      onClick={startEdit}
      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
    >
      <Globe size={12} />
      Add website
    </button>
  )
}
