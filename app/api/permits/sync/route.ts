import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { syncPermits } from '@/lib/jobs/sync-permits'
import { estimatePermitValues } from '@/lib/jobs/estimate-permit-value'

export async function POST() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Step 1: Run the permit sync job
    const syncSummary = await syncPermits()

    // Step 2: Run AI value estimation on any newly created permits with no value
    const estimateResult = await estimatePermitValues()

    return NextResponse.json({
      ...syncSummary,
      estimation: estimateResult,
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('[permits/sync] failed:', error)
    return NextResponse.json({ error }, { status: 500 })
  }
}
