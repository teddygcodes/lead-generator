/**
 * Full enrichment pipeline for a single company.
 * Handles website scraping, Google Places fallback, AI classification, and rescoring.
 * Called by both the single-company and batch enrich routes.
 */

import { db } from '@/lib/db'
import { enrichCompany } from '@/lib/enrichment'
import { enrichWithAI } from '@/lib/ai'
import { scoreCompany } from '@/lib/scoring'
import { findPlaceForCompany, isGooglePlacesConfigured, buildPlaceText } from '@/lib/sources/google-places'

export interface PipelineResult {
  success: boolean
  aiUsed?: boolean
  dataSource?: string
  error?: string
}

export async function runFullEnrichment(companyId: string): Promise<PipelineResult> {
  try {
    return await _runFullEnrichment(companyId)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[pipeline] runFullEnrichment(${companyId}) uncaught:`, error)
    return { success: false, error }
  }
}

async function _runFullEnrichment(companyId: string): Promise<PipelineResult> {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, website: true, notes: true, phone: true, city: true, state: true },
  })

  if (!company) return { success: false, error: 'Company not found' }

  let textForAI = ''
  let dataSource = 'Website content'

  // --- No website: try Google Places ---
  if (!company.website) {
    if (!isGooglePlacesConfigured()) {
      return { success: false, error: 'No website and Google Places API not configured' }
    }

    const place = await findPlaceForCompany(company.name, company.city, company.state)
    if (!place) {
      return { success: false, error: 'Company not found in Google Places' }
    }

    const placeText = buildPlaceText(place, company.name)

    await db.company.update({
      where: { id: companyId },
      data: {
        phone: company.phone || place.phone || undefined,
        website: place.website || undefined,
        lastEnrichedAt: new Date(),
        lastSeenAt: new Date(),
      },
    })

    await db.signal.create({
      data: {
        companyId,
        sourceType: 'COMPANY_DISCOVERY',
        sourceName: 'Google Places',
        sourceUrl: place.googleMapsUri || undefined,
        title: `${place.name} — Google Business Profile`,
        snippet: place.formattedAddress || undefined,
        rawText: placeText,
        signalType: 'DISCOVERY',
        signalDate: new Date(),
        relevanceScore: 0.7,
      },
    })

    textForAI = placeText
    dataSource = 'Google Business Profile'

    // If Places returned a website, also scrape it
    if (place.website) {
      const enrichResult = await enrichCompany(companyId, place.website)
      if (enrichResult.success) {
        const latestSignal = await db.signal.findFirst({
          where: { companyId, signalType: 'WEBSITE_CONTENT' },
          orderBy: { createdAt: 'desc' },
          select: { rawText: true, snippet: true },
        })
        const websiteText = latestSignal?.rawText ?? latestSignal?.snippet ?? ''
        if (websiteText) {
          textForAI = websiteText
          dataSource = 'Website content'
        }
      }
    }
  } else {
    // --- Has website: scrape it ---
    const enrichResult = await enrichCompany(companyId, company.website)
    if (!enrichResult.success) {
      return { success: false, error: enrichResult.error ?? 'Website enrichment failed' }
    }

    const latestSignal = await db.signal.findFirst({
      where: { companyId, signalType: 'WEBSITE_CONTENT' },
      orderBy: { createdAt: 'desc' },
      select: { rawText: true, snippet: true },
    })
    textForAI = latestSignal?.rawText ?? latestSignal?.snippet ?? ''
  }

  if (!textForAI) {
    return { success: true, aiUsed: false, dataSource }
  }

  // --- AI enrichment ---
  const { output, usedFallback } = await enrichWithAI(company.name, textForAI, dataSource)

  const existingNotes = company.notes?.trim()
  const buyerProfile = output.likelyBuyerProfile?.trim()
  const followUpAngle = output.recommendedFollowUpAngle?.trim()
  const aiNotes =
    buyerProfile && followUpAngle
      ? `Buyer profile: ${buyerProfile}\n\nOutreach angle: ${followUpAngle}`
      : undefined

  await db.company.update({
    where: { id: companyId },
    data: {
      segments: output.secondarySegments.length > 0 ? output.secondarySegments : [output.primarySegment],
      specialties: output.specialties.length > 0 ? output.specialties : undefined,
      description: output.summary || undefined,
      sourceConfidence: output.confidence,
      serviceAreas: output.serviceAreas.length > 0 ? output.serviceAreas : undefined,
      employeeSizeEstimate: output.employeeSizeEstimate ?? undefined,
      notes: !existingNotes && aiNotes ? aiNotes : undefined,
    },
  })

  // Recompute score
  const updated = await db.company.findUnique({
    where: { id: companyId },
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
      sourceConfidence: updated.sourceConfidence,
      signals: updated.signals,
      contacts: updated.contacts,
    })
    await db.company.update({
      where: { id: companyId },
      data: { leadScore: score.leadScore, activeScore: score.activeScore },
    })
  }

  return { success: true, aiUsed: !usedFallback, dataSource }
}
