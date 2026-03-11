import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { PermitPatchSchema } from '@/lib/validation/schemas'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const permit = await db.permit.findUnique({
    where: { id },
    include: { company: { select: { id: true, name: true, status: true } } },
  })
  if (!permit) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(permit)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const parsed = PermitPatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const permit = await db.permit.update({
    where: { id },
    data: {
      companyId: parsed.data.companyId,
      matchConfidence: parsed.data.companyId != null ? 1.0 : null,
      matchedAt: parsed.data.companyId != null ? new Date() : null,
    },
    select: {
      id: true,
      permitNumber: true,
      companyId: true,
      contractorName: true,
      contractorPhone: true,
      matchConfidence: true,
      matchedAt: true,
      updatedAt: true,
    },
  })

  // Auto-cascade: link all other unlinked permits for the same contractor (name + phone)
  let cascadeCount = 0
  if (parsed.data.companyId != null && permit.contractorName) {
    const cascade = await db.permit.updateMany({
      where: {
        contractorName: permit.contractorName,
        // When phone is available, require it to match for precision; otherwise name alone
        ...(permit.contractorPhone ? { contractorPhone: permit.contractorPhone } : {}),
        companyId: null,
        id: { not: id },
      },
      data: {
        companyId: parsed.data.companyId,
        matchConfidence: 1.0,
        matchedAt: new Date(),
      },
    })
    cascadeCount = cascade.count
  }

  return NextResponse.json({ ...permit, cascadeCount })
}
