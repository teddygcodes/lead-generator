import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { runFullEnrichment } from '@/lib/enrichment/pipeline'

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const exists = await db.company.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const result = await runFullEnrichment(id)

  if (!result.success) {
    return NextResponse.json({ error: result.error ?? 'Enrichment failed' }, { status: 422 })
  }

  return NextResponse.json(result)
}
