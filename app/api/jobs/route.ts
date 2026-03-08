import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { JobFiltersSchema } from '@/lib/validation/schemas'
import { buildPaginatedResponse } from '@/lib/pagination'
import type { Prisma } from '@prisma/client'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = Object.fromEntries(req.nextUrl.searchParams)
  const parsed = JobFiltersSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query params', details: parsed.error.flatten() }, { status: 400 })
  }

  const { sourceType, status, page, limit } = parsed.data
  const where: Prisma.CrawlJobWhereInput = {}
  if (sourceType) where.sourceType = sourceType as never
  if (status) where.status = status as never

  const skip = (page - 1) * limit

  const [jobs, total] = await Promise.all([
    db.crawlJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    db.crawlJob.count({ where }),
  ])

  // Map internal adapter key to product-facing label before returning.
  // "LICENSE" is a backward-compat SourceType enum value used internally by the
  // Business Registry adapter; it must never appear in API responses or UI text.
  const mappedJobs = jobs.map((j) => ({
    ...j,
    sourceType: j.sourceType === 'LICENSE' ? 'BUSINESS_REGISTRY' : j.sourceType,
  }))

  return NextResponse.json(buildPaginatedResponse(mappedJobs, total, page, limit))
}
