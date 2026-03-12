import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { EnrichBatchSchema } from '@/lib/validation/schemas'
import { runFullEnrichment } from '@/lib/enrichment/pipeline'

// Each company can take 5–15 s to enrich; allow enough headroom for a full batch.
export const maxDuration = 300

// Returns all company IDs pending enrichment, ordered least-recently enriched first.
// Used by the client to drive the "Enrich All" progress loop.
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const companies = await db.company.findMany({
    where: { doNotContact: false, recordOrigin: { not: 'DEMO' }, lastEnrichedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 500, // safety cap — prevents absurdly large payloads
  })

  return NextResponse.json({ ids: companies.map((c) => c.id), total: companies.length })
}

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
    // Explicit selection — enrich all chosen companies, no cap
    companies = await db.company.findMany({
      where: { id: { in: companyIds }, doNotContact: false },
      select: { id: true, name: true },
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

  const BATCH_SIZE = 25
  const results = []

  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    const chunk = companies.slice(i, i + BATCH_SIZE)
    const chunkResults = await Promise.all(
      chunk.map(async (company) => {
        try {
          const result = await runFullEnrichment(company.id)
          return { id: company.id, name: company.name, ...result }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          console.error(`[enrich/batch] company ${company.id} (${company.name}) threw:`, error)
          return { id: company.id, name: company.name, success: false, error }
        }
      }),
    )
    results.push(...chunkResults)
    // Small pause between chunks to avoid hammering external APIs
    if (i + BATCH_SIZE < companies.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  const succeeded = results.filter((r) => r.success).length

  return NextResponse.json({
    processed: succeeded,
    total: results.length,
    results,
  })
}
