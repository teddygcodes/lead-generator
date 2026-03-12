'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Building2,
  Radio,
  Upload,
  Target,
  AlertCircle,
  Search,
  Globe,
  ClipboardCheck,
  Briefcase,
  Loader2,
  CheckCircle,
  Play,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

export type LastRun = {
  finishedAt: string | null
  recordsFound: number | null
  recordsCreated: number | null
  recordsUpdated: number | null
} | null

export interface JobControlPanelProps {
  totalCompanies: number
  signalsThisWeek: number
  recentImports: number
  uncontactedHighScore: number
  needEnrichmentCount: number
  lastDiscovery: LastRun
  lastWebsite: LastRun
  lastRegistry: LastRun
}

type EnrichPhase = 'idle' | 'running' | 'done'
interface EnrichProgress {
  done: number
  total: number
  succeeded: number
  failed: number
}

type QuickJobPhase = 'idle' | 'running' | 'done' | 'error'
interface QuickJobResult {
  recordsFound: number | null
  recordsCreated: number | null
  recordsUpdated: number | null
  liveMode: boolean
  errorMessage?: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never run'
  const ms = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function metricLine(lastRun: LastRun): string | null {
  if (!lastRun) return null
  const parts: string[] = []
  if ((lastRun.recordsFound ?? 0) > 0) parts.push(`${lastRun.recordsFound} found`)
  if ((lastRun.recordsCreated ?? 0) > 0) parts.push(`${lastRun.recordsCreated} new`)
  if ((lastRun.recordsUpdated ?? 0) > 0) parts.push(`${lastRun.recordsUpdated} updated`)
  return parts.length > 0 ? parts.join(' · ') : null
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function JobControlPanel({
  totalCompanies,
  signalsThisWeek,
  recentImports,
  uncontactedHighScore,
  needEnrichmentCount,
  lastDiscovery,
  lastWebsite,
  lastRegistry,
}: JobControlPanelProps) {
  const router = useRouter()

  // ── Enrichment runner ─────────────────────────────────────────────────────
  const [enrichPhase, setEnrichPhase] = useState<EnrichPhase>('idle')
  const [enrichProgress, setEnrichProgress] = useState<EnrichProgress>({
    done: 0,
    total: 0,
    succeeded: 0,
    failed: 0,
  })
  const cancelledRef = useRef(false)

  const runEnrichment = useCallback(async () => {
    cancelledRef.current = false
    setEnrichPhase('running')
    setEnrichProgress({ done: 0, total: 0, succeeded: 0, failed: 0 })
    try {
      const { ids, total } = (await fetch('/api/enrich/batch').then((r) => r.json())) as {
        ids: string[]
        total: number
      }
      setEnrichProgress((p) => ({ ...p, total }))
      if (total === 0) {
        setEnrichPhase('done')
        return
      }
      const CHUNK = 10
      let succeeded = 0
      let failed = 0
      for (let i = 0; i < ids.length; i += CHUNK) {
        if (cancelledRef.current) break
        const chunk = ids.slice(i, i + CHUNK)
        const res = (await fetch('/api/enrich/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyIds: chunk }),
        }).then((r) => r.json())) as { processed: number }
        succeeded += res.processed ?? 0
        failed += chunk.length - (res.processed ?? 0)
        setEnrichProgress({ done: Math.min(i + CHUNK, total), total, succeeded, failed })
      }
      setEnrichPhase('done')
      router.refresh()
    } catch (err) {
      console.error('[enrichment] run failed:', err)
      setEnrichPhase('done')
    }
  }, [router])

  const cancelEnrichment = useCallback(() => {
    cancelledRef.current = true
  }, [])

  // ── Quick job runners ─────────────────────────────────────────────────────
  const [discoveryPhase, setDiscoveryPhase] = useState<QuickJobPhase>('idle')
  const [discoveryResult, setDiscoveryResult] = useState<QuickJobResult | null>(null)
  const [websitePhase, setWebsitePhase] = useState<QuickJobPhase>('idle')
  const [websiteResult, setWebsiteResult] = useState<QuickJobResult | null>(null)
  const [registryPhase, setRegistryPhase] = useState<QuickJobPhase>('idle')
  const [registryResult, setRegistryResult] = useState<QuickJobResult | null>(null)
  const [jobPostingsPhase, setJobPostingsPhase] = useState<QuickJobPhase>('idle')
  const [jobPostingsResult, setJobPostingsResult] = useState<QuickJobResult | null>(null)

  async function triggerJob(
    sourceType: string,
    setPhase: (p: QuickJobPhase) => void,
    setResult: (r: QuickJobResult | null) => void,
    endpoint = '/api/jobs/run',
  ) {
    setPhase('running')
    setResult(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceType }),
      })
      const data = (await res.json()) as {
        recordsFound?: number | null
        recordsCreated?: number | null
        recordsUpdated?: number | null
        liveMode?: boolean
        errorMessage?: string | null
        error?: string
      }
      if (!res.ok) {
        const msg =
          res.status === 429
            ? 'Please wait 60 seconds before running again.'
            : (data.error ?? 'Job failed')
        setResult({
          recordsFound: null,
          recordsCreated: null,
          recordsUpdated: null,
          liveMode: false,
          errorMessage: msg,
        })
        setPhase('error')
        return
      }
      setResult({
        recordsFound: data.recordsFound ?? null,
        recordsCreated: data.recordsCreated ?? null,
        recordsUpdated: data.recordsUpdated ?? null,
        liveMode: data.liveMode ?? false,
        errorMessage: data.errorMessage ?? null,
      })
      setPhase('done')
      router.refresh()
    } catch {
      setResult({
        recordsFound: null,
        recordsCreated: null,
        recordsUpdated: null,
        liveMode: false,
        errorMessage: 'Network error — please try again.',
      })
      setPhase('error')
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Stat cards row ── */}
      <div className="grid grid-cols-5 gap-3">
        {/* Link cards */}
        {(
          [
            {
              label: 'Companies',
              value: totalCompanies,
              icon: <Building2 size={14} />,
              href: '/companies',
              highlight: false,
            },
            {
              label: 'Signals this week',
              value: signalsThisWeek,
              icon: <Radio size={14} />,
              href: '/companies',
              highlight: false,
            },
            {
              label: 'Imports this week',
              value: recentImports,
              icon: <Upload size={14} />,
              href: '/import',
              highlight: false,
            },
            {
              label: 'Uncontacted 60+',
              value: uncontactedHighScore,
              icon: <Target size={14} />,
              href: '/companies?minScore=60&status=NEW',
              highlight: uncontactedHighScore > 0,
            },
          ] as const
        ).map(({ label, value, icon, href, highlight }) => (
          <Link
            key={label}
            href={href}
            className="card flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            <div className={highlight ? 'text-blue-500' : 'text-gray-400'}>{icon}</div>
            <div>
              <p className="text-xl font-semibold text-gray-900 leading-none">
                {value.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          </Link>
        ))}

        {/* Need Enrichment — action card */}
        <div className="card px-4 py-3">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 text-gray-400">
              <AlertCircle size={14} />
              <p className="text-xs text-gray-500">Need enrichment</p>
            </div>
            {enrichPhase === 'idle' && (
              <button
                onClick={runEnrichment}
                disabled={needEnrichmentCount === 0}
                className="flex items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Play size={9} />
                Run
              </button>
            )}
            {enrichPhase === 'running' && (
              <button
                onClick={cancelEnrichment}
                className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-500 hover:border-red-300 hover:text-red-500 transition-colors"
              >
                Cancel
              </button>
            )}
            {enrichPhase === 'done' && (
              <button
                onClick={() => setEnrichPhase('idle')}
                className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-400 hover:bg-gray-50 transition-colors"
              >
                Reset
              </button>
            )}
          </div>

          {enrichPhase === 'idle' && (
            <p className="text-xl font-semibold text-gray-900 leading-none">
              {needEnrichmentCount.toLocaleString()}
            </p>
          )}

          {enrichPhase === 'running' && (
            <div>
              <p className="text-sm font-semibold text-gray-900 leading-none">
                {enrichProgress.done.toLocaleString()}/{enrichProgress.total.toLocaleString()}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">Enriching…</p>
              <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-300"
                  style={{
                    width:
                      enrichProgress.total > 0
                        ? `${(enrichProgress.done / enrichProgress.total) * 100}%`
                        : '0%',
                  }}
                />
              </div>
            </div>
          )}

          {enrichPhase === 'done' && (
            <div>
              <p className="text-sm font-semibold text-gray-900 leading-none">Done</p>
              <p className="text-[11px] mt-0.5">
                <span className="text-green-600">{enrichProgress.succeeded} enriched</span>
                {enrichProgress.failed > 0 && (
                  <span className="text-red-500"> · {enrichProgress.failed} failed</span>
                )}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div>
        <h2 className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-3">
          Quick Actions
        </h2>
        <div className="grid grid-cols-4 gap-4">
          <QuickActionCard
            title="Discover New Contractors"
            description="Scrapes Accela permit portals (Atlanta, Gwinnett, Hall) to find new electrical contractors."
            icon={<Search size={15} />}
            phase={discoveryPhase}
            result={discoveryResult}
            lastRun={lastDiscovery}
            onRun={() =>
              triggerJob('COMPANY_DISCOVERY', setDiscoveryPhase, setDiscoveryResult)
            }
            onReset={() => {
              setDiscoveryPhase('idle')
              setDiscoveryResult(null)
            }}
          />
          <QuickActionCard
            title="Enrich Company Websites"
            description="Re-scrapes company websites and runs AI extraction on un-enriched companies."
            icon={<Globe size={15} />}
            phase={websitePhase}
            result={websiteResult}
            lastRun={lastWebsite}
            onRun={() => triggerJob('COMPANY_WEBSITE', setWebsitePhase, setWebsiteResult)}
            onReset={() => {
              setWebsitePhase('idle')
              setWebsiteResult(null)
            }}
          />
          <QuickActionCard
            title="Check Business Registry"
            description="Verifies GA business registrations via OpenCorporates API."
            icon={<ClipboardCheck size={15} />}
            phase={registryPhase}
            result={registryResult}
            lastRun={lastRegistry}
            onRun={() => triggerJob('LICENSE', setRegistryPhase, setRegistryResult)}
            onReset={() => {
              setRegistryPhase('idle')
              setRegistryResult(null)
            }}
          />
          <QuickActionCard
            title="Sync Job Postings"
            description="Searches Google for electrical contractors actively hiring — a growth buy signal."
            icon={<Briefcase size={15} />}
            phase={jobPostingsPhase}
            result={jobPostingsResult}
            lastRun={null}
            onRun={() =>
              triggerJob(
                'JOB_POSTINGS',
                setJobPostingsPhase,
                setJobPostingsResult,
                '/api/signals/job-postings/sync',
              )
            }
            onReset={() => {
              setJobPostingsPhase('idle')
              setJobPostingsResult(null)
            }}
          />
        </div>
      </div>
    </div>
  )
}

// ─── QuickActionCard ──────────────────────────────────────────────────────────

function QuickActionCard({
  title,
  description,
  icon,
  phase,
  result,
  lastRun,
  onRun,
  onReset,
}: {
  title: string
  description: string
  icon: React.ReactNode
  phase: QuickJobPhase
  result: QuickJobResult | null
  lastRun: LastRun
  onRun: () => void
  onReset: () => void
}) {
  const metrics = metricLine(lastRun)

  return (
    <div className="card px-4 py-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="text-gray-400 mt-0.5 flex-shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{title}</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{description}</p>
        </div>
      </div>

      {/* Status / last-run info */}
      {phase === 'idle' && (
        <p className="text-[11px] text-gray-400">
          {lastRun?.finishedAt ? (
            <>
              Last run: {timeAgo(lastRun.finishedAt)}
              {metrics && <span className="ml-1">· {metrics}</span>}
            </>
          ) : (
            <span className="italic">Never run</span>
          )}
        </p>
      )}

      {phase === 'done' && result && (
        <p className="text-[11px]">
          {result.liveMode ? (
            <span className="text-green-600 font-medium">✓ Live&nbsp;</span>
          ) : (
            <span className="text-amber-600 font-medium">⚠ Demo&nbsp;</span>
          )}
          <span className="text-gray-500">
            {[
              result.recordsFound != null && `${result.recordsFound} found`,
              result.recordsCreated != null && `${result.recordsCreated} new`,
              result.recordsUpdated != null && `${result.recordsUpdated} updated`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {result.errorMessage && (
            <span className="block text-amber-600 mt-0.5">{result.errorMessage}</span>
          )}
        </p>
      )}

      {phase === 'error' && result?.errorMessage && (
        <p className="text-[11px] text-red-500">{result.errorMessage}</p>
      )}

      {/* Action */}
      <div className="mt-auto pt-1">
        {(phase === 'idle' || phase === 'error') && (
          <button
            onClick={onRun}
            className="flex items-center gap-1.5 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 transition-colors"
          >
            <Play size={10} />
            {phase === 'error' ? 'Retry' : 'Run'}
          </button>
        )}
        {phase === 'running' && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Loader2 size={13} className="animate-spin" />
            Running… this may take a minute
          </div>
        )}
        {phase === 'done' && (
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            <CheckCircle size={12} className="text-green-500" />
            Done · Run again
          </button>
        )}
      </div>
    </div>
  )
}
