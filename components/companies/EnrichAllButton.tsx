'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'

export function EnrichAllButton() {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const router = useRouter()

  async function handleEnrichAll() {
    setLoading(true)
    setStatus(null)
    try {
      const res = await fetch('/api/enrich/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 10 }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus(data.error ?? 'Enrichment failed')
      } else {
        setStatus(`Enriched ${data.processed} ${data.processed === 1 ? 'company' : 'companies'}`)
        router.refresh()
      }
    } catch {
      setStatus('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleEnrichAll}
        disabled={loading}
        className="btn-secondary text-xs"
      >
        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        {loading ? 'Enriching…' : 'Enrich All'}
      </button>
      {status && (
        <p className={`text-xs ${status.startsWith('Enriched') ? 'text-green-600' : 'text-red-500'}`}>
          {status}
        </p>
      )}
    </div>
  )
}
