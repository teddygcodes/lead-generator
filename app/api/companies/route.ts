import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { CompanyFiltersSchema, CompanyCreateSchema } from '@/lib/validation/schemas'
import { normalizeName, extractDomain } from '@/lib/normalization'
import { buildPaginatedResponse } from '@/lib/pagination'
import { Prisma } from '@prisma/client'

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

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = CompanyCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { name, county, phone, website, status, recordOrigin } = parsed.data

  const baseData = {
    name,
    normalizedName: normalizeName(name),
    county: county ?? null,
    phone: phone ?? null,
    website: website ?? null,
    domain: website ? extractDomain(website) : null,
    state: 'GA',
    status,
    recordOrigin,
    leadScore: 0,
  }

  try {
    const company = await db.company.create({
      data: baseData,
      select: { id: true, name: true, status: true, county: true },
    })
    return NextResponse.json(company, { status: 201 })
  } catch (err) {
    // If domain unique constraint fires (e.g. directory URL like nextdoor.com),
    // retry without setting domain — website still saves.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      (err.meta?.target as string[] | undefined)?.includes('domain')
    ) {
      const company = await db.company.create({
        data: { ...baseData, domain: null },
        select: { id: true, name: true, status: true, county: true },
      })
      return NextResponse.json(company, { status: 201 })
    }
    const message = err instanceof Error ? err.message : 'Failed to create company'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
