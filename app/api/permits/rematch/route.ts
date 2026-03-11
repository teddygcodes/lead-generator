import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rematchPermits, VALID_COUNTIES } from '@/lib/jobs/sync-permits'

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const county = typeof body.county === 'string' ? body.county : undefined

  if (!county || !VALID_COUNTIES.includes(county)) {
    return NextResponse.json({ error: 'Invalid or missing county' }, { status: 400 })
  }

  try {
    const summary = await rematchPermits(county)
    return NextResponse.json(summary)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('[permits/rematch] failed:', error)
    return NextResponse.json({ error }, { status: 500 })
  }
}
