import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { enrichCompany } from '@/lib/enrichment'
import { enrichWithAI } from '@/lib/ai'
import { scoreCompany } from '@/lib/scoring'

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const company = await db.company.findUnique({
    where: { id },
    select: { id: true, name: true, website: true },
  })

  if (!company) {
    return NextResponse.json({ error: 'Company not found' }, { status: 404 })
  }

  if (!company.website) {
    return NextResponse.json({ error: 'Company has no website URL to enrich from' }, { status: 422 })
  }

  // Run website enrichment
  const enrichResult = await enrichCompany(id, company.website)
  if (!enrichResult.success) {
    return NextResponse.json({ error: enrichResult.error ?? 'Enrichment failed' }, { status: 422 })
  }

  // Fetch the latest signal to get extracted text for AI enrichment
  const latestSignal = await db.signal.findFirst({
    where: { companyId: id, signalType: 'WEBSITE_CONTENT' },
    orderBy: { createdAt: 'desc' },
    select: { rawText: true, snippet: true },
  })

  const textForAI = latestSignal?.rawText ?? latestSignal?.snippet ?? ''

  // AI enrichment (falls back to keyword classifier if AI unavailable)
  if (textForAI) {
    const { output, usedFallback } = await enrichWithAI(company.name, textForAI)

    // Update company with AI-derived fields
    await db.company.update({
      where: { id },
      data: {
        segments: output.secondarySegments.length > 0 ? output.secondarySegments : [output.primarySegment],
        specialties: output.specialties.length > 0 ? output.specialties : undefined,
        description: output.summary || undefined,
        sourceConfidence: output.confidence,
      },
    })

    // Recompute score
    const updated = await db.company.findUnique({
      where: { id },
      include: { signals: true, contacts: true },
    })
    if (updated) {
      const score = scoreCompany({
        county: updated.county,
        state: updated.state,
        segments: updated.segments,
        specialties: updated.specialties,
        description: updated.description,
        website: updated.website,
        email: updated.email,
        phone: updated.phone,
        street: updated.street,
        signals: updated.signals,
        contacts: updated.contacts,
      })
      await db.company.update({
        where: { id },
        data: { leadScore: score.leadScore, activeScore: score.activeScore },
      })
    }

    return NextResponse.json({
      success: true,
      aiUsed: !usedFallback,
      enrichment: output,
    })
  }

  return NextResponse.json({ success: true, aiUsed: false, enrichment: null })
}
