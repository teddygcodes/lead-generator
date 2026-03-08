'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'

export function EnrichButton({ companyId }: { companyId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleEnrich() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/enrich/company/${companyId}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Enrichment failed')
      } else {
        router.refresh()
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleEnrich}
        disabled={loading}
        className="btn-secondary text-xs"
      >
        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        {loading ? 'Enriching…' : 'Enrich'}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
