import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { normalizePhone, normalizeName } from '@/lib/normalization'

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const rawPhones = searchParams.get('phones') ?? ''
  const rawNames = searchParams.get('names') ?? ''
  const rawPlaceIds = searchParams.get('placeIds') ?? ''

  const phones = rawPhones
    .split(',')
    .map((p) => normalizePhone(p.trim()))
    .filter((p): p is string => Boolean(p))

  const names = rawNames
    .split(',')
    .map((n) => normalizeName(n.trim()))
    .filter(Boolean)

  const placeIds = rawPlaceIds.split(',').filter(Boolean)

  if (phones.length === 0 && names.length === 0 && placeIds.length === 0) {
    return NextResponse.json({ byPhone: {}, byName: {}, byPlaceId: {} })
  }

  try {
    const orClauses: Prisma.CompanyWhereInput[] = []
    if (phones.length > 0) orClauses.push({ phone: { in: phones } })
    if (names.length > 0) orClauses.push({ normalizedName: { in: names } })
    if (placeIds.length > 0) orClauses.push({ googlePlaceId: { in: placeIds } })

    const matches = await db.company.findMany({
      where: { OR: orClauses },
      select: { id: true, name: true, phone: true, normalizedName: true, recordOrigin: true, activeJobCount: true, lastPermitAt: true, googlePlaceId: true },
    })

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000)

    type MatchEntry = { companyId: string; companyName: string; recordOrigin: string; hasActivePermit: boolean }
    const byPhone: Record<string, MatchEntry> = {}
    const byName: Record<string, MatchEntry> = {}
    const byPlaceId: Record<string, MatchEntry> = {}

    for (const c of matches) {
      const hasActivePermit =
        c.activeJobCount > 0 ||
        (c.lastPermitAt != null && c.lastPermitAt > thirtyDaysAgo)
      const entry: MatchEntry = { companyId: c.id, companyName: c.name, recordOrigin: c.recordOrigin, hasActivePermit }
      if (c.phone && phones.includes(c.phone)) byPhone[c.phone] = entry
      if (c.normalizedName && names.includes(c.normalizedName)) byName[c.normalizedName] = entry
      if (c.googlePlaceId && placeIds.includes(c.googlePlaceId)) byPlaceId[c.googlePlaceId] = entry
    }

    return NextResponse.json({ byPhone, byName, byPlaceId })
  } catch (err) {
    console.error('[places/check] error:', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
