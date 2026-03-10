import { TARGET_COUNTIES, SCORE_CONFIG } from './config'

export interface ScoringInput {
  county?: string | null
  state?: string | null
  segments?: string[]
  specialties?: string[]
  description?: string | null
  website?: string | null
  email?: string | null
  phone?: string | null
  street?: string | null
  sourceConfidence?: number | null // AI enrichment confidence (0-1), stored on Company.sourceConfidence
  permitSignalScore?: number | null // Pre-computed permit activity score, stored on Company.permitSignalScore
  permitCount30Days?: number | null // Number of permits filed in the last 30 days, for richer reason string
  signals?: Array<{
    signalDate?: Date | null
    signalType?: string
  }>
  contacts?: Array<{
    email?: string | null
    phone?: string | null
  }>
}

export interface ScoreOutput {
  leadScore: number
  activeScore: number
  reasons: string[]
  likelyProductDemandCategories: string[]
  likelySalesMotion: string
  likelyBuyerValue: string
  outreachAngle: string
}

function cap(val: number, max: number): number {
  return Math.min(Math.round(val), max)
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * Compute leadScore, activeScore, and enriched sales metadata.
 * All rules are traceable to specific SCORE_CONFIG weights.
 */
export function scoreCompany(input: ScoringInput): ScoreOutput {
  const reasons: string[] = []
  let lead = 0
  let active = 0

  // ---- Geography ----
  const county = input.county?.trim() ?? ''
  const isTargetCounty = TARGET_COUNTIES.some(
    (c) => c.toLowerCase() === county.toLowerCase(),
  )
  if (isTargetCounty) {
    lead += SCORE_CONFIG.geography.primaryCountyPoints
    reasons.push(`Operates in target county: ${county}`)
  } else if (input.state === 'GA' || input.state === 'Georgia') {
    lead += SCORE_CONFIG.geography.stateGAPoints
    reasons.push('Located in Georgia (outside primary territory)')
  }

  // ---- Segment ----
  // Industrial always receives full industrial points, even when mixed with other segments.
  // The "mixed" value only applies to non-industrial multi-segment combos.
  const segments = (input.segments ?? []).map((s) => s.toLowerCase())
  const hasIndustrial = segments.includes('industrial')
  const hasCommercial = segments.includes('commercial')
  const hasResidential = segments.includes('residential')
  const segmentCount = [hasIndustrial, hasCommercial, hasResidential].filter(Boolean).length

  if (hasIndustrial) {
    lead += SCORE_CONFIG.segment.industrial
    reasons.push(
      segmentCount === 1
        ? 'Primarily industrial — high-value segment for switchgear/panelboard demand'
        : `Industrial segment present (multi-segment: ${segments.join(', ')})`,
    )
  } else if (hasCommercial && segmentCount === 1) {
    lead += SCORE_CONFIG.segment.commercial
    reasons.push('Primarily commercial — strong panelboard and lighting demand')
  } else if (segmentCount > 1) {
    lead += SCORE_CONFIG.segment.mixed
    reasons.push(`Multi-segment contractor (non-industrial): ${segments.join(', ')}`)
  } else if (hasResidential) {
    lead += SCORE_CONFIG.segment.residential
    reasons.push('Residential segment — lower product complexity demand')
  }

  // ---- Specialties — per-match scoring, capped ----
  const specialties = (input.specialties ?? []).map((s) => s.toLowerCase())
  const matchedHighValue = SCORE_CONFIG.specialties.highValue.filter((kw) =>
    specialties.some((s) => s.includes(kw)),
  )
  const matchedStandard = SCORE_CONFIG.specialties.standard.filter((kw) =>
    specialties.some((s) => s.includes(kw)),
  )
  if (matchedHighValue.length > 0) {
    const pts = Math.min(
      matchedHighValue.length * SCORE_CONFIG.specialties.highValuePointsEach,
      SCORE_CONFIG.specialties.highValueMax,
    )
    lead += pts
    reasons.push(
      `${matchedHighValue.length} high-value specialty match(es): ${matchedHighValue.join(', ')} (+${pts})`,
    )
  }
  if (matchedStandard.length > 0) {
    const pts = Math.min(
      matchedStandard.length * SCORE_CONFIG.specialties.standardPointsEach,
      SCORE_CONFIG.specialties.standardMax,
    )
    lead += pts
    reasons.push(
      `${matchedStandard.length} standard specialty match(es): ${matchedStandard.join(', ')} (+${pts})`,
    )
  }

  // ---- Description language ----
  const desc = (input.description ?? '').toLowerCase()
  const industrialTermMatches = SCORE_CONFIG.language.industrialTerms.filter((t) =>
    desc.includes(t),
  )
  const commercialTermMatches = SCORE_CONFIG.language.commercialTerms.filter((t) =>
    desc.includes(t),
  )
  if (industrialTermMatches.length > 0) {
    lead += SCORE_CONFIG.language.industrialPoints
    reasons.push('Industrial language detected in description')
  }
  if (commercialTermMatches.length > 0) {
    lead += SCORE_CONFIG.language.commercialPoints
    reasons.push('Commercial language detected in description')
  }

  // ---- Completeness ----
  if (input.website) {
    lead += SCORE_CONFIG.completeness.hasWebsite
    reasons.push('Website on file — enrichable')
  }
  if (input.email) {
    lead += SCORE_CONFIG.completeness.hasEmail
    reasons.push('Direct email address available')
  }
  if (input.phone) {
    lead += SCORE_CONFIG.completeness.hasPhone
    reasons.push('Phone number on file')
  }
  if (input.street) {
    lead += SCORE_CONFIG.completeness.hasStreetAddress
  }

  // ---- Source confidence (AI enrichment quality) ----
  const conf = input.sourceConfidence ?? 0
  if (conf >= SCORE_CONFIG.confidence.highThreshold) {
    lead += SCORE_CONFIG.confidence.highPoints
    reasons.push(`High AI enrichment confidence (${conf.toFixed(2)}) — data quality verified`)
  } else if (conf >= SCORE_CONFIG.confidence.mediumThreshold) {
    lead += SCORE_CONFIG.confidence.mediumPoints
    reasons.push(`Moderate AI enrichment confidence (${conf.toFixed(2)})`)
  }

  // ---- Contacts ----
  const contacts = input.contacts ?? []
  if (contacts.length > 0) {
    lead += SCORE_CONFIG.contact.hasAnyContact
    reasons.push(`${contacts.length} contact(s) on file`)
    if (contacts.some((c) => c.email)) {
      lead += SCORE_CONFIG.contact.contactHasEmail
      reasons.push('Contact email available for outreach')
    }
    if (contacts.some((c) => c.phone)) {
      lead += SCORE_CONFIG.contact.contactHasPhone
    }
  }

  // ---- Signals (activeScore: volume + recency; leadScore: small presence bonus) ----
  const signals = input.signals ?? []
  const now = new Date()
  let signalBonus = 0
  let mostRecentSignalDays = Infinity

  for (const signal of signals) {
    signalBonus += SCORE_CONFIG.signals.basePerSignal
    if (signal.signalDate) {
      const days = daysBetween(now, new Date(signal.signalDate))
      mostRecentSignalDays = Math.min(mostRecentSignalDays, days)
    }
  }

  signalBonus = Math.min(signalBonus, SCORE_CONFIG.signals.maxSignalBonus)
  active += signalBonus

  // Small leadScore bonus for signal presence — signals indicate active, visible company
  const leadSignalBonus = Math.min(
    signals.length * SCORE_CONFIG.signals.leadScorePerSignal,
    SCORE_CONFIG.signals.leadScoreSignalMax,
  )
  if (leadSignalBonus > 0) {
    lead += leadSignalBonus
    reasons.push(`${signals.length} signal(s) on file (+${leadSignalBonus} to lead score)`)
  } else if (signals.length > 0) {
    reasons.push(`${signals.length} signal(s) on file`)
  }

  if (mostRecentSignalDays <= 30) {
    active += SCORE_CONFIG.signals.recency.within30Days
    reasons.push('Signal recorded within the last 30 days')
  } else if (mostRecentSignalDays <= 90) {
    active += SCORE_CONFIG.signals.recency.within90Days
    reasons.push('Signal recorded within the last 90 days')
  } else if (mostRecentSignalDays <= 180) {
    active += SCORE_CONFIG.signals.recency.within180Days
    reasons.push('Signal recorded in the last 6 months')
  }

  // Active score also benefits from lead indicators
  if (isTargetCounty) active += 10
  if (hasIndustrial) active += 8
  else if (hasCommercial) active += 5

  // ---- Permit signal score ----
  if (input.permitSignalScore && input.permitSignalScore > 0) {
    const pts = cap(input.permitSignalScore, SCORE_CONFIG.permit.maxScore)
    lead += pts
    const countNote = input.permitCount30Days ? ` (${input.permitCount30Days} permits in 30 days)` : ''
    reasons.push(`Active permit activity${countNote} → +${pts} pts`)
  }

  const finalLead = cap(lead, SCORE_CONFIG.maxScore)
  const finalActive = cap(active, SCORE_CONFIG.maxScore)

  // ---- Derived sales fields ----
  const likelyProductDemandCategories = deriveProductDemand(specialties, segments)
  const likelySalesMotion = deriveSalesMotion(segments, specialties)
  const likelyBuyerValue = deriveBuyerValue(finalLead, segments)
  const outreachAngle = deriveOutreachAngle(input)

  return {
    leadScore: finalLead,
    activeScore: finalActive,
    reasons,
    likelyProductDemandCategories,
    likelySalesMotion,
    likelyBuyerValue,
    outreachAngle,
  }
}

function deriveProductDemand(specialties: string[], segments: string[]): string[] {
  const demand: string[] = []
  if (specialties.some((s) => s.includes('switchgear'))) demand.push('Switchgear')
  if (specialties.some((s) => s.includes('panelboard'))) demand.push('Panelboards')
  if (specialties.some((s) => s.includes('generator'))) demand.push('Generators / Standby Power')
  if (specialties.some((s) => s.includes('lighting'))) demand.push('Lighting & Controls')
  if (specialties.some((s) => s.includes('control'))) demand.push('Motor Controls / VFDs')
  if (specialties.some((s) => s.includes('low voltage'))) demand.push('Low Voltage / Data / Security')
  if (specialties.some((s) => s.includes('fire alarm'))) demand.push('Fire Alarm Systems')
  if (specialties.some((s) => s.includes('ev charging'))) demand.push('EV Charging Infrastructure')
  if (segments.includes('industrial')) demand.push('Industrial MRO Distribution')
  if (demand.length === 0) demand.push('General Distribution Materials')
  return [...new Set(demand)]
}

function deriveSalesMotion(segments: string[], specialties: string[]): string {
  if (segments.includes('industrial')) {
    if (specialties.some((s) => s.includes('maintenance'))) return 'MRO Account — recurring service calls'
    return 'Project + MRO hybrid — industrial new construction and maintenance'
  }
  if (segments.includes('commercial')) return 'Project-based — commercial bid work'
  if (segments.includes('residential')) return 'Service + volume — residential service and multifamily'
  return 'Mixed — assess at first call'
}

function deriveBuyerValue(leadScore: number, segments: string[]): string {
  if (leadScore >= 70 && segments.includes('industrial')) return 'High — potential stocking account'
  if (leadScore >= 55) return 'Medium-High — qualified prospect'
  if (leadScore >= 35) return 'Medium — worth qualifying'
  return 'Low — qualify before pursuing'
}

function deriveOutreachAngle(input: ScoringInput): string {
  const specialties = (input.specialties ?? []).map((s) => s.toLowerCase())
  const segments = (input.segments ?? []).map((s) => s.toLowerCase())

  if (specialties.some((s) => s.includes('switchgear'))) {
    return 'Lead with switchgear stock availability and delivery capability'
  }
  if (specialties.some((s) => s.includes('generator'))) {
    return 'Lead with generator distribution and transfer switch availability'
  }
  if (segments.includes('industrial')) {
    return 'Lead with MRO stocking program and industrial maintenance support'
  }
  if (segments.includes('commercial')) {
    return 'Lead with commercial lighting and panelboard project pricing'
  }
  if (input.county && TARGET_COUNTIES.includes(input.county)) {
    return `Mention local territory coverage in ${input.county} County`
  }
  return 'Introduce distribution capabilities and request upcoming project list'
}
