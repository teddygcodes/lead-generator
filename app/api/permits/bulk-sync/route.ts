import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { PermitBulkSyncSchema } from '@/lib/validation/schemas'

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const parsed = PermitBulkSyncSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { county } = parsed.data
  const countyFilter = county ? { county } : {}

  try {
    // Find one companyId per contractorName that already has a link (within county)
    const linkedByName = await db.permit.findMany({
      where: { companyId: { not: null }, ...countyFilter },
      select: { contractorName: true, companyId: true },
      distinct: ['contractorName'],
    })

    if (linkedByName.length === 0) return NextResponse.json({ syncedCount: 0 })

    // Build contractorName → companyId map
    const nameToCompany = Object.fromEntries(
      linkedByName.map(p => [p.contractorName, p.companyId!])
    )

    // Bulk-link all unlinked permits whose contractorName is in the map
    const results = await Promise.all(
      Object.entries(nameToCompany).map(([name, companyId]) =>
        db.permit.updateMany({
          where: { contractorName: name, companyId: null, ...countyFilter },
          data: { companyId, matchConfidence: 1.0, matchedAt: new Date() },
        })
      )
    )

    const syncedCount = results.reduce((sum, r) => sum + r.count, 0)
    return NextResponse.json({ syncedCount })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('[permits/bulk-sync] failed:', error)
    return NextResponse.json({ error }, { status: 500 })
  }
}
