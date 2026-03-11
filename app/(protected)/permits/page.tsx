import { db } from '@/lib/db'
import { VALID_COUNTIES } from '@/lib/jobs/sync-permits'
import { PermitsBrowser } from '@/components/permits/PermitsBrowser'
import type { CountyStat } from '@/components/permits/PermitsBrowser'

export const metadata = { title: 'Permits — Electrical Leads Engine' }

async function getInitialStats(): Promise<Record<string, CountyStat>> {
  const [groups, ...crawlJobs] = await Promise.all([
    db.permit.groupBy({
      by: ['county'],
      _count: { id: true },
      _max: { filedAt: true },
      _min: { filedAt: true },
    }),
    ...VALID_COUNTIES.map(county =>
      db.crawlJob.findFirst({
        where: {
          sourceType: 'PERMIT',
          status: 'COMPLETED',
          metadata: { path: ['county'], equals: county },
        },
        orderBy: { finishedAt: 'desc' },
        select: { finishedAt: true },
      })
    ),
  ])

  const stats: Record<string, CountyStat> = {}
  for (let i = 0; i < VALID_COUNTIES.length; i++) {
    const county = VALID_COUNTIES[i]
    const group = groups.find(g => g.county === county)
    stats[county] = {
      count: group?._count.id ?? 0,
      lastSynced: crawlJobs[i]?.finishedAt?.toISOString() ?? null,
      newest: group?._max.filedAt?.toISOString() ?? null,
    }
  }
  return stats
}

export default async function PermitsPage() {
  const initialStats = await getInitialStats()

  return (
    <div className="flex h-full overflow-hidden">
      <PermitsBrowser counties={VALID_COUNTIES} initialStats={initialStats} />
    </div>
  )
}
