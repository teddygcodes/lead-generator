import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { normalizeDomain } from '@/lib/normalization'
import { findWebsiteForCompany, isGoogleCSEConfigured } from '@/lib/sources/website-finder'
import { z } from 'zod'

const BodySchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
})

const DELAY_MS = 250

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isGoogleCSEConfigured()) {
    return NextResponse.json(
      { error: 'Google CSE not configured — add GOOGLE_CSE_API_KEY and GOOGLE_CSE_ENGINE_ID to .env.local' },
      { status: 503 },
    )
  }

  const body = await req.json().catch(() => ({}))
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { limit } = parsed.data

  const companies = await db.company.findMany({
    where: {
      website: null,
      doNotContact: false,
      recordOrigin: { in: ['DISCOVERED', 'IMPORTED'] },
    },
    select: { id: true, name: true, city: true, state: true },
    orderBy: { leadScore: 'desc' },
    take: limit,
  })

  let found = 0
  let notFound = 0
  let domainConflicts = 0
  const skipped = 0
  const results: Array<{
    companyId: string
    name: string
    website: string | null
    domain: string | null
  }> = []

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i]
    const website = await findWebsiteForCompany(company.name, company.city, company.state)

    if (website) {
      const domain = normalizeDomain(website) ?? undefined
      const conflict = domain
        ? await db.company.findUnique({ where: { domain }, select: { id: true } })
        : null

      await db.company.update({
        where: { id: company.id },
        data: {
          website,
          domain: !conflict ? domain : undefined,
        },
      })

      if (conflict) domainConflicts++
      found++
      results.push({ companyId: company.id, name: company.name, website, domain: domain ?? null })
    } else {
      notFound++
      results.push({ companyId: company.id, name: company.name, website: null, domain: null })
    }

    if (i < companies.length - 1) await sleep(DELAY_MS)
  }

  return NextResponse.json({
    processed: companies.length,
    found,
    notFound,
    domainConflicts,
    skipped,
    results,
  })
}
