import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { CompanyPatchSchema } from '@/lib/validation/schemas'
import { scoreCompany } from '@/lib/scoring'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const company = await db.company.findUnique({
    where: { id },
    include: {
      signals: {
        orderBy: { signalDate: 'desc' },
        take: 20,
      },
      contacts: {
        orderBy: { confidenceScore: 'desc' },
      },
      userNotes: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      tags: {
        include: { tag: true },
      },
    },
  })

  if (!company) {
    return NextResponse.json({ error: 'Company not found' }, { status: 404 })
  }

  // Compute live score
  const score = scoreCompany({
    county: company.county,
    state: company.state,
    segments: company.segments,
    specialties: company.specialties,
    description: company.description,
    website: company.website,
    email: company.email,
    phone: company.phone,
    street: company.street,
    signals: company.signals,
    contacts: company.contacts,
  })

  return NextResponse.json({ ...company, scoreDetails: score })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await db.company.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  await db.company.delete({ where: { id } })
  return NextResponse.json({ success: true })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const parsed = CompanyPatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const existing = await db.company.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const updated = await db.company.update({
    where: { id },
    data: parsed.data,
    select: { id: true, status: true, doNotContact: true, notes: true, updatedAt: true },
  })

  return NextResponse.json(updated)
}
