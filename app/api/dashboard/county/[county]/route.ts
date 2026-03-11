import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { formatPhone } from '@/lib/format'

/**
 * City names that may be stored in company.county instead of the real county name.
 * Must stay in sync with the same constant in app/api/dashboard/map-data/route.ts.
 * Follow-up: extract both to lib/normalization/georgia-cities.ts for a single source of truth.
 */
const CITY_TO_COUNTY: Record<string, string> = {
  atlanta: 'Fulton',
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ county: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { county } = await params
  const countyName = decodeURIComponent(county)

  // Also match any city aliases that map to this county
  // (e.g., clicking "Fulton" returns companies where county = "Atlanta" too)
  const countyLower = countyName.toLowerCase()
  const cityAliases = Object.entries(CITY_TO_COUNTY)
    .filter(([, v]) => v.toLowerCase() === countyLower)
    .map(([k]) => k)

  const countyConditions: { county: { equals: string; mode: 'insensitive' } }[] = [
    { county: { equals: countyName, mode: 'insensitive' } },
    ...cityAliases.map((alias) => ({ county: { equals: alias, mode: 'insensitive' as const } })),
  ]

  const companies = await db.company.findMany({
    where: {
      OR: countyConditions,
      recordOrigin: { not: 'DEMO' },
    },
    orderBy: { leadScore: 'desc' },
    take: 50,
    select: {
      id: true,
      name: true,
      leadScore: true,
      segments: true,
      description: true,
      phone: true,
      city: true,
    },
  })

  return NextResponse.json({
    companies: companies.map((c) => ({
      ...c,
      leadScore: Math.round(c.leadScore ?? 0),
      phone: formatPhone(c.phone) || null,
    })),
  })
}
