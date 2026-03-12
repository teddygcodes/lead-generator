import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { syncJobPostingSignals } from '@/lib/signals/sync-job-postings'
import { isJobPostingsConfigured } from '@/lib/signals/job-postings'

// CSE calls + DB writes; 60 s is plenty for ~10 queries + matching
export const maxDuration = 60

export async function POST() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isJobPostingsConfigured()) {
    return NextResponse.json(
      { error: 'GOOGLE_CSE_API_KEY or GOOGLE_CSE_ENGINE_ID not set' },
      { status: 503 },
    )
  }

  const job = await db.crawlJob.create({
    data: { sourceType: 'COMPANY_DISCOVERY', status: 'RUNNING', startedAt: new Date() },
  })

  try {
    const result = await syncJobPostingSignals()

    await db.crawlJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
        recordsFound: result.matched + result.created,
        recordsCreated: result.created + result.newCompanies,
        recordsUpdated: result.matched,
      },
    })

    return NextResponse.json({ ...result, liveMode: true })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db.crawlJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', finishedAt: new Date(), errorMessage },
    })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
