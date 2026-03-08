/**
 * Stale job cleanup utility.
 * Marks CrawlJobs that have been stuck in RUNNING beyond a threshold as FAILED.
 *
 * Call from a trusted startup path. If no startup hook exists in this project,
 * calling from the GET /api/jobs handler (or the jobs page server component) is
 * an acceptable v1 fallback — it is idempotent and only mutates genuinely stale jobs,
 * but should be replaced with a proper startup hook (e.g. Next.js instrumentation)
 * when one is added to the project.
 *
 * Does NOT overwrite metadata — liveMode, liveModeReason, and any job context written
 * at creation remain intact; only status, finishedAt, and errorMessage are updated.
 */

import { db } from '@/lib/db'

const parsed = parseInt(process.env.JOB_STALE_MINUTES ?? '30', 10)
const STALE_MINUTES = Number.isFinite(parsed) && parsed > 0 ? parsed : 30

export async function cleanupStaleJobs(): Promise<void> {
  await db.crawlJob.updateMany({
    where: {
      status: 'RUNNING',
      startedAt: { lt: new Date(Date.now() - STALE_MINUTES * 60 * 1000) },
    },
    data: {
      status: 'FAILED',
      finishedAt: new Date(),
      errorMessage: 'Server restart — job interrupted',
      // metadata intentionally absent — preserve liveMode and job context set at creation
    },
  })
}
