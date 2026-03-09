import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { EnrichBatchSchema } from '@/lib/validation/schemas'
import { runFullEnrichment } from '@/lib/enrichment/pipeline'

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

  // Find companies to enrich — includes companies without websites (Places fallback)
  let companies: Array<{ id: string; name: string }>
  if (companyIds && companyIds.length > 0) {
    companies = await db.company.findMany({
      where: { id: { in: companyIds }, doNotContact: false },
      select: { id: true, name: true },
      take: limit,
    })
  } else {
    // Least-recently enriched real companies — with or without websites
    companies = await db.company.findMany({
      where: {
        doNotContact: false,
        recordOrigin: { not: 'DEMO' },
      },
      select: { id: true, name: true },
      orderBy: { lastEnrichedAt: 'asc' },
      take: limit,
    })
  }

  const results = []
  for (const company of companies) {
    const result = await runFullEnrichment(company.id)
    results.push({ id: company.id, name: company.name, ...result })
  }

  const succeeded = results.filter((r) => r.success).length

  return NextResponse.json({
    processed: succeeded,
    total: results.length,
    results,
  })
}
