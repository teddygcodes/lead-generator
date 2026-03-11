import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { CompanyPatchSchema } from '@/lib/validation/schemas'
import { scoreCompany } from '@/lib/scoring'
import { extractDomain } from '@/lib/normalization'

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
    sourceConfidence: company.sourceConfidence,
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

  // When website is being set, also derive + update domain
  const { website, ...rest } = parsed.data
  const updateData = {
    ...rest,
    ...(website !== undefined
      ? { website, domain: website ? extractDomain(website) : null }
      : {}),
  }

  try {
    const updated = await db.company.update({
      where: { id },
      data: updateData,
      select: { id: true, status: true, doNotContact: true, notes: true, website: true, domain: true, updatedAt: true },
    })
    return NextResponse.json(updated)
  } catch (err) {
    // If domain unique constraint fires (e.g. two companies share a directory URL like thumbtack.com),
    // retry without setting domain — the website still saves, enrichment won't use a shared domain.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      (err.meta?.target as string[] | undefined)?.includes('domain')
    ) {
      const { domain: _domain, ...dataWithoutDomain } = updateData as typeof updateData & { domain?: string | null }
      const updated = await db.company.update({
        where: { id },
        data: { ...dataWithoutDomain, domain: null },
        select: { id: true, status: true, doNotContact: true, notes: true, website: true, domain: true, updatedAt: true },
      })
      return NextResponse.json(updated)
    }
    const message = err instanceof Error ? err.message : 'Failed to update company'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
