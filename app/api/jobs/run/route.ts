/**
 * POST /api/jobs/run
 *
 * Trigger a source adapter job run.
 * Requires a valid Clerk session.
 *
 * Body: { sourceType: "COMPANY_WEBSITE" | "PERMIT" | "LICENSE" | "COMPANY_DISCOVERY", params?: object }
 *
 * Note on sourceType values:
 *   - "COMPANY_WEBSITE"    → website enrichment adapter
 *   - "PERMIT"             → permit adapter (demo mode; see permits.ts step 0 comment)
 *   - "LICENSE"            → Business Registry adapter (internal adapter key — never expose
 *                            this string in UI labels; product surfaces use "Business Registry")
 *   - "COMPANY_DISCOVERY"  → GA electrical contractor discovery (Atlanta Accela permit search + future sources)
 *
 * Server-side param caps applied before passing to adapter (body values cannot override):
 *   - LICENSE:           batchLimit capped at 50
 *   - PERMIT:            resultRecordCount capped at 1000
 *   - COMPANY_DISCOVERY: maxPages capped at 5
 *
 * Response: RunJobResult
 *   liveMode: true  → adapter ran against a live external source
 *   liveMode: false → adapter ran in demo mode (no external calls)
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { runJob } from '@/lib/jobs/runner'
import { RunJobSchema } from '@/lib/validation/schemas'

// Best-effort v1 rate limiting — per-instance, resets on restart/deploy, not distributed.
// Applies after auth so the key is always a real userId. Replace with Upstash or similar
// if multi-instance deployments or stronger guarantees are needed.
const rateLimitMap = new Map<string, number>()
const RATE_LIMIT_MS = 60_000

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const parsed = RunJobSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { sourceType, params: rawParams } = parsed.data

  // Rate limit: one job per userId + sourceType per 60s
  const rateLimitKey = `${userId}:${sourceType}`
  if (Date.now() - (rateLimitMap.get(rateLimitKey) ?? 0) < RATE_LIMIT_MS) {
    return NextResponse.json(
      { error: 'Rate limit: wait 60s before re-running this source' },
      { status: 429 },
    )
  }
  rateLimitMap.set(rateLimitKey, Date.now())

  // Apply server-side param caps — caller-supplied values cannot exceed these limits
  const params: Record<string, unknown> = { ...(rawParams ?? {}) }
  if (sourceType === 'LICENSE') {
    if (typeof params.batchLimit === 'number' && params.batchLimit > 50) {
      params.batchLimit = 50
    }
  }
  if (sourceType === 'PERMIT') {
    if (typeof params.resultRecordCount === 'number' && params.resultRecordCount > 1000) {
      params.resultRecordCount = 1000
    }
  }
  if (sourceType === 'COMPANY_DISCOVERY') {
    if (typeof params.maxPages === 'number' && params.maxPages > 5) {
      params.maxPages = 5
    }
  }

  const result = await runJob(sourceType, params)
  return NextResponse.json(result)
}
