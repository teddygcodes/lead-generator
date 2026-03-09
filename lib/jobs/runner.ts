/**
 * Job runner.
 * Executes source adapters by sourceType and records CrawlJob progress.
 */

import { db } from '@/lib/db'
import type { SourceAdapter } from '@/lib/sources/base'
import { companySiteAdapter } from '@/lib/sources/company-site'
import { permitAdapter } from '@/lib/sources/permits'
import { licenseAdapter } from '@/lib/sources/business-registry'
import { companyDiscoveryAdapter } from '@/lib/sources/company-discovery'

const ADAPTERS: Record<string, SourceAdapter> = {
  COMPANY_WEBSITE: companySiteAdapter,
  PERMIT: permitAdapter,
  LICENSE: licenseAdapter,
  COMPANY_DISCOVERY: companyDiscoveryAdapter,
}

export interface RunJobResult {
  jobId: string
  status: 'COMPLETED' | 'FAILED'
  recordsFound: number
  recordsCreated: number
  recordsUpdated: number
  errorMessage?: string
  liveMode: boolean
}

// Defensive fallback only — adapter.demoReason is authoritative; do not expand this table
const DEMO_REASONS: Record<string, string> = {
  LICENSE: 'OPENCORPORATES_API_KEY not set',
  PERMIT: 'Live ArcGIS schema not confirmed — see permits.ts step 0 comment',
}

/**
 * Run a job for the given source type.
 * Creates a CrawlJob record and updates it on completion.
 */
export async function runJob(
  sourceType: string,
  params?: Record<string, unknown>,
): Promise<RunJobResult> {
  const adapter = ADAPTERS[sourceType]
  if (!adapter) {
    throw new Error(`Unknown source type: ${sourceType}`)
  }

  const liveMode = !adapter.isDemoMode
  const liveModeReason = !liveMode
    ? (adapter.demoReason ?? DEMO_REASONS[sourceType] ?? 'isDemoMode = true')
    : undefined

  // Create job record — metadata set once here; never overwritten on update
  const job = await db.crawlJob.create({
    data: {
      sourceType: sourceType as never,
      status: 'RUNNING',
      startedAt: new Date(),
      metadata: {
        ...(params ?? {}),
        liveMode,
        ...(liveModeReason ? { liveModeReason } : {}),
      } as object,
    },
  })

  try {
    // Discover records
    const discovered = await adapter.discover(params)
    const recordsFound = discovered.length

    // Fetch details and normalize
    const normalized = []
    for (const item of discovered) {
      const detail = await adapter.fetchDetails(item.sourceId)
      if (detail) {
        normalized.push(adapter.normalize(detail))
      }
    }

    // Persist
    const result = await adapter.persist(normalized)

    // Update job record
    await db.crawlJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
        recordsFound,
        recordsCreated: result.created,
        recordsUpdated: result.updated,
        errorMessage: result.errors.length > 0 ? result.errors.join('; ') : null,
      },
    })

    return {
      jobId: job.id,
      status: 'COMPLETED',
      recordsFound,
      recordsCreated: result.created,
      recordsUpdated: result.updated,
      errorMessage: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      liveMode,
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    await db.crawlJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorMessage,
      },
    })

    return {
      jobId: job.id,
      status: 'FAILED',
      recordsFound: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      errorMessage,
      liveMode,
    }
  }
}

/**
 * Get available source types.
 */
export function getAvailableSourceTypes(): string[] {
  return Object.keys(ADAPTERS)
}
