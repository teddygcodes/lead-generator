import { db } from '@/lib/db'
import { CompanyFiltersSchema } from '@/lib/validation/schemas'
import { buildPaginatedResponse } from '@/lib/pagination'
import { CompaniesTable } from '@/components/companies/CompaniesTable'
import { FilterBar } from '@/components/companies/FilterBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { Building2 } from 'lucide-react'
import type { Prisma } from '@prisma/client'

export const metadata = { title: 'Companies — Electrical Leads Engine' }

async function getCompanies(searchParams: Record<string, string>) {
  const parsed = CompanyFiltersSchema.safeParse(searchParams)
  if (!parsed.success) {
    return buildPaginatedResponse([], 0, 1, 25)
  }

  const { search, county, segment, status, minScore, hasWebsite, hasEmail, sort, order, page, limit, showDemo } =
    parsed.data

  const where: Prisma.CompanyWhereInput = {}

  if (showDemo !== 'true') {
    where.recordOrigin = { not: 'DEMO' as const }
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { domain: { contains: search, mode: 'insensitive' } },
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

  const orderBy: Prisma.CompanyOrderByWithRelationInput = { [sort]: order }
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
        doNotContact: true,
        employeeSizeEstimate: true,
        description: true,
        serviceAreas: true,
        _count: { select: { signals: true } },
      },
    }),
    db.company.count({ where }),
  ])

  return buildPaginatedResponse(companies, total, page, limit)
}

// Get distinct counties for filter — excludes demo-only counties by default
async function getCounties(showDemo: string): Promise<string[]> {
  const where: Prisma.CompanyWhereInput = { county: { not: null } }
  if (showDemo !== 'true') {
    where.recordOrigin = { not: 'DEMO' as const }
  }
  const result = await db.company.findMany({
    where,
    select: { county: true },
    distinct: ['county'],
    orderBy: { county: 'asc' },
  })
  return result.map((r) => r.county!).filter(Boolean)
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const params = await searchParams
  const showDemo = params.showDemo ?? 'false'
  const [result, counties] = await Promise.all([getCompanies(params), getCounties(showDemo)])

  const hasActiveFilters = Object.keys(params).some((k) =>
    ['search', 'county', 'segment', 'status'].includes(k),
  )

  const emptyDescription =
    hasActiveFilters
      ? 'Try adjusting your filters or search term.'
      : showDemo === 'true'
        ? 'No companies found. Import companies via CSV or add them manually to get started.'
        : 'No real leads yet — run a Company Discovery job or import via CSV.'

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-base font-semibold text-gray-900">Companies</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          {result.total.toLocaleString()} {result.total === 1 ? 'company' : 'companies'}
          {showDemo === 'true' ? ' (including demo data)' : ''}
        </p>
      </div>

      <FilterBar counties={counties} />

      {result.data.length === 0 ? (
        <EmptyState
          icon={<Building2 size={32} />}
          title="No companies found"
          description={emptyDescription}
        />
      ) : (
        <CompaniesTable
          companies={result.data}
          pagination={{
            page: result.page,
            limit: result.limit,
            total: result.total,
            totalPages: result.totalPages,
          }}
        />
      )}
    </div>
  )
}
