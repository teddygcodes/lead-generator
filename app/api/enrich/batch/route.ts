import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { enrichCompany } from '@/lib/enrichment'
import { EnrichBatchSchema } from '@/lib/validation/schemas'

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const parsed = EnrichBatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { companyIds, limit } = parsed.data

  // Find companies to enrich
  let companies: Array<{ id: string; name: string; website: string | null }>
  if (companyIds && companyIds.length > 0) {
    companies = await db.company.findMany({
      where: { id: { in: companyIds }, website: { not: null } },
      select: { id: true, name: true, website: true },
      take: limit,
    })
  } else {
    // Find least-recently enriched companies with websites
    companies = await db.company.findMany({
      where: { website: { not: null } },
      select: { id: true, name: true, website: true },
      orderBy: { lastEnrichedAt: 'asc' },
      take: limit,
    })
  }

  const results = []
  for (const company of companies) {
    if (!company.website) continue
    const result = await enrichCompany(company.id, company.website)
    results.push({ id: company.id, name: company.name, ...result })
  }

  return NextResponse.json({
    processed: results.length,
    results,
  })
}
