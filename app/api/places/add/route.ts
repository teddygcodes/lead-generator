import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PlacesAddSchema } from '@/lib/validation/schemas'
import { findExistingCompany } from '@/lib/dedupe'
import { normalizeName, normalizeDomain, normalizePhone } from '@/lib/normalization'
import { scoreCompany } from '@/lib/scoring'

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = PlacesAddSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 })
  }

  const { places } = parsed.data
  let created = 0
  let updated = 0
  let skipped = 0
  const newCompanyIds: string[] = []

  for (const place of places) {
    try {
      const phone = normalizePhone(place.phone ?? null)
      const domain = normalizeDomain(place.website ?? null)
      const normalizedNameVal = normalizeName(place.name)

      const { found, companyId } = await findExistingCompany({
        domain,
        name: place.name,
        phone,
      })

      if (found && companyId) {
        // Update existing company with any new Google Places data (non-destructive)
        const existingCompany = await db.company.findUnique({
          where: { id: companyId },
          select: { website: true, phone: true, googlePlaceId: true, googleRating: true },
        })

        const updateData: Record<string, unknown> = {}
        if (!existingCompany?.website && place.website) updateData.website = place.website
        if (!existingCompany?.phone && phone) updateData.phone = phone
        if (!existingCompany?.googlePlaceId) updateData.googlePlaceId = place.placeId
        if (!existingCompany?.googleRating && place.rating != null) updateData.googleRating = place.rating

        if (Object.keys(updateData).length > 0) {
          await db.company.update({ where: { id: companyId }, data: updateData })
          updated++
        } else {
          skipped++
        }
        continue
      }

      // Check by googlePlaceId before creating — prevents P2002 when dedup missed it
      const byPlaceId = await db.company.findUnique({
        where: { googlePlaceId: place.placeId },
        select: { id: true, website: true, phone: true, googleRating: true },
      })
      if (byPlaceId) {
        const updateData: Record<string, unknown> = {}
        if (!byPlaceId.website && place.website) updateData.website = place.website
        if (!byPlaceId.phone && phone) updateData.phone = phone
        if (byPlaceId.googleRating == null && place.rating != null) updateData.googleRating = place.rating
        if (Object.keys(updateData).length > 0) {
          await db.company.update({ where: { id: byPlaceId.id }, data: updateData })
          updated++
        } else {
          skipped++
        }
        continue
      }

      // Create new company from Places data
      const score = scoreCompany({
        county: null,
        state: 'GA',
        segments: [],
        specialties: [],
        description: null,
        website: place.website ?? null,
        email: null,
        phone,
        street: null,
        sourceConfidence: 0.5,
        permitSignalScore: 0,
        permitCount30Days: 0,
        signals: [],
        contacts: [],
      })

      try {
        const newCo = await db.company.create({
          data: {
            name: place.name,
            normalizedName: normalizedNameVal,
            phone: phone ?? undefined,
            website: place.website ?? undefined,
            domain: domain ?? undefined,
            street: place.address ?? undefined,
            state: 'GA',
            googlePlaceId: place.placeId,
            googleRating: place.rating ?? undefined,
            recordOrigin: 'DISCOVERED',
            status: 'NEW',
            leadScore: score.leadScore,
            activeScore: score.activeScore,
          },
        })
        newCompanyIds.push(newCo.id)
        created++
      } catch (createErr: unknown) {
        // Domain unique constraint conflict — retry without domain
        const isUniqueViolation =
          typeof createErr === 'object' &&
          createErr !== null &&
          'code' in createErr &&
          (createErr as { code: string }).code === 'P2002'

        if (isUniqueViolation) {
          // Retry without domain AND without googlePlaceId to avoid hitting either unique constraint
          const newCo = await db.company.create({
            data: {
              name: place.name,
              normalizedName: normalizedNameVal,
              phone: phone ?? undefined,
              website: place.website ?? undefined,
              street: place.address ?? undefined,
              state: 'GA',
              googleRating: place.rating ?? undefined,
              recordOrigin: 'DISCOVERED',
              status: 'NEW',
              leadScore: score.leadScore,
              activeScore: score.activeScore,
            },
          })
          newCompanyIds.push(newCo.id)
          created++
        } else {
          throw createErr
        }
      }
    } catch (err) {
      console.error('[places/add] failed to add place:', place.name, err)
      skipped++
    }
  }

  // Fire-and-forget enrichment for newly created companies
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  for (const id of newCompanyIds) {
    fetch(`${baseUrl}/api/enrich/company/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => { /* ignore enrichment errors */ })
  }

  return NextResponse.json({ created, updated, skipped, enrichmentQueued: newCompanyIds.length })
}
