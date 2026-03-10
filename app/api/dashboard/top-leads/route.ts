import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { formatPhone } from '@/lib/format'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leads = await db.company.findMany({
    where: {
      leadScore: { gte: 60 },
      status: 'NEW',
      lastEnrichedAt: { not: null },
      recordOrigin: { not: 'DEMO' },
      OR: [{ phone: { not: null } }, { email: { not: null } }],
    },
    orderBy: { leadScore: 'desc' },
    take: 10,
    select: {
      id: true,
      name: true,
      leadScore: true,
      county: true,
      city: true,
      segments: true,
      description: true,
      phone: true,
      email: true,
    },
  })

  return NextResponse.json({
    leads: leads.map((l) => ({
      ...l,
      leadScore: Math.round(l.leadScore ?? 0),
      phone: formatPhone(l.phone) || null,
    })),
  })
}
