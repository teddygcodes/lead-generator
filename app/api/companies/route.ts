import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { CompanyFiltersSchema } from '@/lib/validation/schemas'
import { buildPaginatedResponse } from '@/lib/pagination'
import type { Prisma } from '@prisma/client'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = Object.fromEntries(req.nextUrl.searchParams)
  const parsed = CompanyFiltersSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query params', details: parsed.error.flatten() }, { status: 400 })
  }

  const {
    search,
    county,
    segment,
    status,
    minScore,
    hasWebsite,
    hasEmail,
    sort,
    order,
    page,
    limit,
    showDemo,
  } = parsed.data

  const where: Prisma.CompanyWhereInput = {}

  if (showDemo !== 'true') {
    where.recordOrigin = { not: 'DEMO' as const }
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { domain: { contains: search, mode: 'insensitive' } },
      { normalizedName: { contains: search, mode: 'insensitive' } },
    ]
  }
  if (county) where.county = { equals: county, mode: 'insensitive' }
  if (segment) where.segments = { has: segment.toLowerCase() }
  if (status) where.status = status as never
  if (minScore !== undefined) where.leadScore = { gte: minScore }
  if (hasWebsite === 'true') where.website = { not: null }
  if (hasWebsite === 'false') where.website = null
  if (hasEmail === 'true') where.email = { not: null }
  if (hasEmail === 'false') where.email = null

  const orderBy: Prisma.CompanyOrderByWithRelationInput = {
    [sort]: order,
  }

  const skip = (page - 1) * limit

  const [companies, total] = await Promise.all([
    db.company.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        city: true,
        county: true,
        territory: true,
        website: true,
        domain: true,
        phone: true,
        email: true,
        segments: true,
        specialties: true,
        leadScore: true,
        activeScore: true,
        status: true,
        lastEnrichedAt: true,
        createdAt: true,
        doNotContact: true,
        employeeSizeEstimate: true,
        description: true,
        serviceAreas: true,
        _count: { select: { signals: true, contacts: true } },
      },
    }),
    db.company.count({ where }),
  ])

  return NextResponse.json(buildPaginatedResponse(companies, total, page, limit))
}
