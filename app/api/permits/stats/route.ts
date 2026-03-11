import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { VALID_COUNTIES } from '@/lib/jobs/sync-permits'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const groups = await db.permit.groupBy({
    by: ['county'],
    _count: { id: true },
    _max: { filedAt: true },
    _min: { filedAt: true },
  })

  const crawlJobs = await Promise.all(
    VALID_COUNTIES.map(county =>
      db.crawlJob.findFirst({
        where: { sourceType: 'PERMIT', status: 'COMPLETED', metadata: { path: ['county'], equals: county } },
        orderBy: { finishedAt: 'desc' },
        select: { finishedAt: true },
      })
    )
  )

  const stats: Record<string, { count: number; lastSynced: string | null; newest: string | null; oldest: string | null }> = {}

  for (let i = 0; i < VALID_COUNTIES.length; i++) {
    const county = VALID_COUNTIES[i]
    const group = groups.find(g => g.county === county)
    stats[county] = {
      count: group?._count.id ?? 0,
      lastSynced: crawlJobs[i]?.finishedAt?.toISOString() ?? null,
      newest: group?._max.filedAt?.toISOString() ?? null,
      oldest: group?._min.filedAt?.toISOString() ?? null,
    }
  }

  return NextResponse.json(stats)
}
