import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'

const BUCKET_WEIGHT = {
  '500K_PLUS': 4,
  '100K_TO_500K': 3,
  '20K_TO_100K': 2,
  UNDER_20K: 1,
  UNKNOWN: 0,
} as const

type BucketKey = keyof typeof BUCKET_WEIGHT

function sortKey(permit: {
  jobValue: number | null
  estimatedValueBucket: string | null
}): number {
  if (permit.jobValue !== null) return permit.jobValue
  if (permit.estimatedValueBucket) {
    return (BUCKET_WEIGHT[permit.estimatedValueBucket as BucketKey] ?? 0) * 100_000
  }
  return 0
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const fourteenDaysAgo = new Date()
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

  const permits = await db.permit.findMany({
    where: {
      status: { in: ['ISSUED', 'INSPECTED'] },
      isResidential: false,
      filedAt: { gte: fourteenDaysAgo },
      OR: [
        { jobValue: { gte: 20000 } },
        { estimatedValueBucket: { in: ['20K_TO_100K', '100K_TO_500K', '500K_PLUS'] } },
      ],
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          leadScore: true,
          lastContactedAt: true,
          recordOrigin: true,
          lastEnrichedAt: true,
        },
      },
    },
    orderBy: { filedAt: 'desc' },
    take: 100,
  })

  // Sort in TypeScript to avoid raw SQL for complex ordering.
  // Tier 1: confirmed jobValue comes before all estimated permits.
  // Tier 2: within confirmed → jobValue DESC; within estimated → bucket weight DESC.
  // Tier 3: filedAt DESC as tiebreaker.
  permits.sort((a, b) => {
    const aConfirmed = a.jobValue !== null
    const bConfirmed = b.jobValue !== null
    if (aConfirmed !== bConfirmed) return aConfirmed ? -1 : 1
    const diff = sortKey(b) - sortKey(a)
    return diff !== 0 ? diff : b.filedAt.getTime() - a.filedAt.getTime()
  })

  const top25 = permits.slice(0, 25)

  const latest = await db.permit.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  const lastSyncAt = latest?.createdAt ?? null

  return NextResponse.json({
    permits: top25.map((p) => ({
      id: p.id,
      permitNumber: p.permitNumber,
      permitType: p.permitType,
      description: p.description,
      status: p.status,
      county: p.county,
      jobAddress: p.jobAddress,
      jobValue: p.jobValue,
      valueIsEstimated: p.valueIsEstimated,
      estimatedValueBucket: p.estimatedValueBucket,
      filedAt: p.filedAt,
      issuedAt: p.issuedAt,
      inspectionAt: p.inspectionAt,
      contractorName: p.contractorName,
      company: p.company
        ? {
            id: p.company.id,
            name: p.company.name,
            leadScore: p.company.leadScore,
            lastContactedAt: p.company.lastContactedAt,
          }
        : null,
      isNewCompany:
        p.company
          ? p.company.recordOrigin === 'PERMIT_DISCOVERY' && !p.company.lastEnrichedAt
          : false,
    })),
    lastSyncAt,
  })
}
