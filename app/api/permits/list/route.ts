import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const county = searchParams.get('county') ?? ''
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit  = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))
  const search = searchParams.get('search')?.trim() ?? ''

  if (!county) return NextResponse.json({ error: 'county required' }, { status: 400 })

  const where = {
    county: { equals: county, mode: 'insensitive' as const },
    ...(search ? {
      OR: [
        { contractorName: { contains: search, mode: 'insensitive' as const } },
        { jobAddress:     { contains: search, mode: 'insensitive' as const } },
        { permitNumber:   { contains: search, mode: 'insensitive' as const } },
      ],
    } : {}),
  }

  const [total, permits] = await Promise.all([
    db.permit.count({ where }),
    db.permit.findMany({
      where,
      orderBy: { filedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        permitNumber: true,
        permitType: true,
        description: true,
        status: true,
        jobAddress: true,
        county: true,
        jobValue: true,
        isResidential: true,
        filedAt: true,
        issuedAt: true,
        contractorName: true,
        contractorPhone: true,
        companyId: true,
        source: true,
      },
    }),
  ])

  return NextResponse.json({ permits, total, page, pages: Math.ceil(total / limit) })
}
