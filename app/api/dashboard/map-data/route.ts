import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'

function toTitleCase(str: string): string {
  return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase())
}

/**
 * Normalize city names stored in company.county to their actual Georgia county.
 * "Atlanta" is a city — its county is Fulton. Keys are lower-cased.
 */
const CITY_TO_COUNTY: Record<string, string> = {
  atlanta: 'Fulton',
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const companies = await db.company.findMany({
    where: { recordOrigin: { not: 'DEMO' }, county: { not: null } },
    select: { county: true, leadScore: true, status: true, name: true },
  })

  // Group by county (case-insensitive), normalizing city names to their county
  const grouped = new Map<string, { key: string; displayName: string; rows: typeof companies }>()
  for (const c of companies) {
    const raw = c.county!.trim().toLowerCase()
    const resolved = CITY_TO_COUNTY[raw] ?? c.county!.trim()
    const key = resolved.toLowerCase()
    if (!grouped.has(key)) {
      grouped.set(key, { key, displayName: toTitleCase(resolved), rows: [] })
    }
    grouped.get(key)!.rows.push(c)
  }

  const result = Array.from(grouped.values()).map(({ displayName, rows }) => {
    const highScore = rows.filter((r) => (r.leadScore ?? 0) >= 60)
    const uncontacted = highScore.filter((r) => r.status === 'NEW')
    const avgScore =
      rows.length > 0
        ? Math.round(rows.reduce((sum, r) => sum + (r.leadScore ?? 0), 0) / rows.length)
        : 0
    const topLead = rows.reduce<{ name: string; score: number } | null>((best, r) => {
      const s = r.leadScore ?? 0
      return !best || s > best.score ? { name: r.name, score: Math.round(s) } : best
    }, null)

    return {
      county: displayName,
      totalCompanies: rows.length,
      highScoreCount: highScore.length,
      uncontactedCount: uncontacted.length,
      avgScore,
      topLead,
    }
  })

  return NextResponse.json({ counties: result })
}
