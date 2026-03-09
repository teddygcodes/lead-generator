'use client'

import { useState } from 'react'
import { Globe } from 'lucide-react'
import { useRouter } from 'next/navigation'

export function FindWebsitesButton() {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const router = useRouter()

  async function handleFindWebsites() {
    setLoading(true)
    setStatus(null)
    try {
      const res = await fetch('/api/companies/find-websites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20 }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 503) {
          setStatus('CSE not configured')
        } else {
          setStatus(data.error ?? 'Failed')
        }
      } else {
        setStatus(`Found ${data.found} of ${data.processed} websites`)
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
        onClick={handleFindWebsites}
        disabled={loading}
        className="btn-secondary text-xs"
      >
        <Globe size={12} className={loading ? 'animate-pulse' : ''} />
        {loading ? 'Searching…' : 'Find Websites'}
      </button>
      {status && (
        <p className={`text-xs ${status.startsWith('Found') ? 'text-green-600' : 'text-red-500'}`}>
          {status}
        </p>
      )}
    </div>
  )
}
