/**
 * POST /api/companies/merge
 *
 * Merges two company records into one.
 * The primary (survivor) keeps its own data and gains missing fields from the secondary.
 * All related records (permits, contacts, signals, notes, tags) are reassigned.
 * The secondary is deleted.
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { MergeCompaniesSchema } from '@/lib/validation/schemas'
import { buildMergedFields } from '@/lib/companies/merge'
import { updateCompanyPermitStats } from '@/lib/jobs/sync-permits'

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const parsed = MergeCompaniesSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { primaryId, secondaryId } = parsed.data

  // Load both companies with everything needed for merge
  const [primary, secondary] = await Promise.all([
    db.company.findUnique({
      where: { id: primaryId },
      include: { tags: { select: { tagId: true } } },
    }),
    db.company.findUnique({
      where: { id: secondaryId },
      include: { tags: { select: { tagId: true } } },
    }),
  ])

  if (!primary) return NextResponse.json({ error: 'Primary company not found' }, { status: 404 })
  if (!secondary) return NextResponse.json({ error: 'Secondary company not found' }, { status: 404 })

  // Compute scalar field updates
  const mergedFields = buildMergedFields(primary, secondary)

  // Tags from secondary that primary doesn't already have
  const primaryTagIds = new Set(primary.tags.map((t) => t.tagId))
  const newTagIds = secondary.tags
    .map((t) => t.tagId)
    .filter((id) => !primaryTagIds.has(id))

  // Run everything in a transaction
  await db.$transaction(async (tx) => {
    // 1. Apply merged scalar fields to primary
    if (Object.keys(mergedFields).length > 0) {
      await tx.company.update({ where: { id: primaryId }, data: mergedFields })
    }

    // 2. Reassign all related records
    await tx.signal.updateMany({
      where: { companyId: secondaryId },
      data: { companyId: primaryId },
    })
    await tx.contact.updateMany({
      where: { companyId: secondaryId },
      data: { companyId: primaryId },
    })
    await tx.userNote.updateMany({
      where: { companyId: secondaryId },
      data: { companyId: primaryId },
    })
    await tx.permit.updateMany({
      where: { companyId: secondaryId },
      data: { companyId: primaryId },
    })

    // 3. Tags: add secondary's unique tags to primary, then delete secondary's
    if (newTagIds.length > 0) {
      await tx.companyTag.createMany({
        data: newTagIds.map((tagId) => ({ companyId: primaryId, tagId })),
        skipDuplicates: true,
      })
    }
    await tx.companyTag.deleteMany({ where: { companyId: secondaryId } })

    // 4. Delete the secondary company (cascade deletes any remaining relations)
    await tx.company.delete({ where: { id: secondaryId } })
  })

  // Recalculate permit stats and rescore the surviving company
  await updateCompanyPermitStats(primaryId)

  return NextResponse.json({
    merged: true,
    survivorId: primaryId,
    deletedId: secondaryId,
  })
}
