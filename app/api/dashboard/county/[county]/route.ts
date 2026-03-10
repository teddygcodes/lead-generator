import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { formatPhone } from '@/lib/format'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ county: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { county } = await params
  const countyName = decodeURIComponent(county)

  const companies = await db.company.findMany({
    where: {
      county: { equals: countyName, mode: 'insensitive' },
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
