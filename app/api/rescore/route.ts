/**
 * POST /api/rescore
 * Recomputes leadScore and activeScore for all real companies using their
 * existing DB data (segments, specialties, signals, contacts, sourceConfidence).
 * No scraping or AI calls — fast pure-JS scoring pass.
 * Use after updating scoring weights to sync stored scores with the current model.
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { scoreCompany } from '@/lib/scoring'

export async function POST() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const companies = await db.company.findMany({
    where: { recordOrigin: { not: 'DEMO' } },
    select: {
      id: true,
      county: true,
      state: true,
      segments: true,
      specialties: true,
      description: true,
      website: true,
      email: true,
      phone: true,
      street: true,
      sourceConfidence: true,
      permitSignalScore: true,
      signals: { select: { signalDate: true, signalType: true } },
      contacts: { select: { email: true, phone: true } },
    },
  })

  const updates = companies.map((company) => {
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
      permitSignalScore: company.permitSignalScore ?? 0,
      signals: company.signals,
      contacts: company.contacts,
    })
    return db.company.update({
      where: { id: company.id },
      data: { leadScore: score.leadScore, activeScore: score.activeScore },
    })
  })

  await db.$transaction(updates)

  return NextResponse.json({ updated: companies.length })
}
