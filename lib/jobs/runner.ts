/**
 * Job runner.
 * Executes source adapters by sourceType and records CrawlJob progress.
 */

import { db } from '@/lib/db'
import type { SourceAdapter } from '@/lib/sources/base'
import { companySiteAdapter } from '@/lib/sources/company-site'
import { permitAdapter } from '@/lib/sources/permits'
import { licenseAdapter } from '@/lib/sources/licenses'

const ADAPTERS: Record<string, SourceAdapter> = {
  COMPANY_WEBSITE: companySiteAdapter,
  PERMIT: permitAdapter,
  LICENSE: licenseAdapter,
}

export interface RunJobResult {
  jobId: string
  status: 'COMPLETED' | 'FAILED'
  recordsFound: number
  recordsCreated: number
  recordsUpdated: number
  errorMessage?: string
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

  // Create job record
  const job = await db.crawlJob.create({
    data: {
      sourceType: sourceType as never,
      status: 'RUNNING',
      startedAt: new Date(),
      metadata: (params ?? {}) as object,
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
    }
  }
}

/**
 * Get available source types.
 */
export function getAvailableSourceTypes(): string[] {
  return Object.keys(ADAPTERS)
}
