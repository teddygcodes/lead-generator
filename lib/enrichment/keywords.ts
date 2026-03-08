/**
 * Non-AI keyword classifier.
 * Classifies extracted text into segments and detects specialty keywords.
 * Works independently — no AI API required.
 */

export type Segment = 'industrial' | 'commercial' | 'residential' | 'mixed'

export interface KeywordClassification {
  segment: Segment
  segments: string[]
  matchedSpecialties: string[]
  confidence: number
}

const SEGMENT_KEYWORDS = {
  industrial: [
    'industrial',
    'manufacturing',
    'plant',
    'factory',
    'warehouse',
    'distribution center',
    'distribution facility',
    'industrial maintenance',
    'production facility',
    'processing plant',
    'chemical plant',
    'food processing',
    'pharmaceutical',
    'water treatment',
    'wastewater',
  ],
  commercial: [
    'commercial',
    'retail',
    'office',
    'tenant improvement',
    'tenant fit-out',
    'build-out',
    'shopping center',
    'strip mall',
    'hotel',
    'restaurant',
    'hospitality',
    'healthcare facility',
    'medical office',
    'school',
    'university',
    'church',
    'municipal',
    'government',
  ],
  residential: [
    'residential',
    'home',
    'house',
    'single family',
    'townhome',
    'townhouse',
    'apartment',
    'multifamily',
    'multi-family',
    'condo',
    'subdivision',
    'new construction homes',
    'home builder',
  ],
}

const SPECIALTY_KEYWORDS: Record<string, string[]> = {
  switchgear: ['switchgear', 'switch gear', 'medium voltage', 'mv switchgear'],
  panelboards: ['panelboard', 'panel board', 'distribution panel', 'load center', 'service panel'],
  lighting: [
    'lighting',
    'led',
    'fluorescent',
    'fixture',
    'luminaire',
    'lighting controls',
    'daylighting',
  ],
  controls: [
    'controls',
    'plc',
    'vfd',
    'variable frequency',
    'motor control',
    'mcc',
    'automation',
    'scada',
    'bms',
    'building automation',
  ],
  generators: [
    'generator',
    'standby power',
    'backup power',
    'transfer switch',
    'ats',
    'genset',
    'emergency power',
  ],
  service: ['service', 'maintenance', 'repair', 'troubleshoot', 'emergency service', '24/7'],
  multifamily: [
    'multifamily',
    'multi-family',
    'apartment complex',
    'condo',
    'townhome',
    'hoa',
    'mixed-use',
  ],
  'low voltage': [
    'low voltage',
    'data',
    'network',
    'structured cabling',
    'cat5',
    'cat6',
    'fiber',
    'security system',
    'access control',
    'cctv',
    'surveillance',
  ],
  'fire alarm': [
    'fire alarm',
    'fire detection',
    'sprinkler',
    'suppression',
    'ansul',
    'nfpa 72',
    'life safety',
  ],
  'tenant improvement': [
    'tenant improvement',
    'tenant fit',
    'build-out',
    'ti work',
    'interior remodel',
    'renovations',
  ],
  'industrial maintenance': [
    'industrial maintenance',
    'preventive maintenance',
    'predictive maintenance',
    'mro',
    'plant maintenance',
    'equipment maintenance',
  ],
  'distribution center': [
    'distribution center',
    'fulfillment center',
    'warehouse',
    'logistics facility',
    'storage facility',
    'cold storage',
  ],
  healthcare: ['hospital', 'clinic', 'healthcare', 'medical', 'dental', 'urgent care', 'er'],
  schools: ['school', 'k-12', 'elementary', 'middle school', 'high school', 'campus', 'classroom'],
  churches: ['church', 'worship', 'sanctuary', 'religious', 'faith', 'chapel', 'mosque', 'synagogue'],
  'municipal/public': ['municipal', 'government', 'county', 'city hall', 'public works', 'utility'],
  'EV charging': [
    'ev charging',
    'electric vehicle',
    'ev station',
    'level 2',
    'dc fast charge',
    'chargepoint',
    'tesla',
    'ev infrastructure',
  ],
}

/**
 * Classify text into segments and detect specialties.
 */
export function classifyText(text: string | null | undefined): KeywordClassification {
  if (!text || text.trim().length === 0) {
    return {
      segment: 'mixed',
      segments: [],
      matchedSpecialties: [],
      confidence: 0,
    }
  }

  const lower = text.toLowerCase()

  // Count matches per segment
  const segmentCounts: Record<string, number> = {
    industrial: 0,
    commercial: 0,
    residential: 0,
  }

  for (const [seg, keywords] of Object.entries(SEGMENT_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        segmentCounts[seg]++
      }
    }
  }

  // Determine primary segments
  const matchedSegments: string[] = []
  if (segmentCounts.industrial > 0) matchedSegments.push('industrial')
  if (segmentCounts.commercial > 0) matchedSegments.push('commercial')
  if (segmentCounts.residential > 0) matchedSegments.push('residential')

  // Determine primary segment
  let segment: Segment = 'mixed'
  if (matchedSegments.length === 1) {
    segment = matchedSegments[0] as Segment
  } else if (matchedSegments.length === 0) {
    segment = 'mixed'
  } else {
    segment = 'mixed'
  }

  // Detect specialties
  const matchedSpecialties: string[] = []
  for (const [specialty, keywords] of Object.entries(SPECIALTY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      matchedSpecialties.push(specialty)
    }
  }

  // Confidence based on total keyword matches
  const totalMatches = Object.values(segmentCounts).reduce((a, b) => a + b, 0)
  const confidence = Math.min(1, totalMatches / 5) // rough 0-1 confidence

  return {
    segment,
    segments: matchedSegments.length > 0 ? matchedSegments : [],
    matchedSpecialties,
    confidence,
  }
}
