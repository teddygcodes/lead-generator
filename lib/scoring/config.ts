/**
 * Centralized scoring configuration.
 * All weights and thresholds live here — do not inline these in scoring logic.
 */

export const TARGET_COUNTIES = ['Gwinnett', 'Hall', 'Forsyth', 'Cobb', 'Fulton', 'Cherokee']

export const SCORE_CONFIG = {
  /** Max possible leadScore and activeScore */
  maxScore: 100,

  /** Geography scoring */
  geography: {
    primaryCountyPoints: 15, // in a target county
    stateGAPoints: 5, // in Georgia but not target county
  },

  /** Segment scoring for leadScore */
  segment: {
    industrial: 20,
    commercial: 15,
    mixed: 12, // multiple segments
    residential: 5,
  },

  /** Website/contact completeness */
  completeness: {
    hasWebsite: 5,
    hasEmail: 5,
    hasPhone: 3,
    hasStreetAddress: 2,
  },

  /** High-value specialty keywords (switchgear, panelboards, etc.) */
  specialties: {
    highValue: ['switchgear', 'panelboards', 'controls', 'generators', 'ev charging'],
    highValuePoints: 8,
    standard: [
      'lighting',
      'fire alarm',
      'low voltage',
      'industrial maintenance',
      'distribution center',
      'warehouse',
    ],
    standardPoints: 4,
  },

  /** Signal recency and count for activeScore */
  signals: {
    basePerSignal: 4,
    maxSignalBonus: 20,
    recency: {
      within30Days: 12,
      within90Days: 7,
      within180Days: 3,
    },
  },

  /** Contact availability */
  contact: {
    hasAnyContact: 8,
    contactHasEmail: 4,
    contactHasPhone: 4,
  },

  /** Description language indicators */
  language: {
    industrialTerms: [
      'industrial',
      'manufacturing',
      'plant',
      'facility',
      'warehouse',
      'distribution',
    ],
    commercialTerms: ['commercial', 'retail', 'office', 'tenant improvement', 'build-out'],
    industrialPoints: 6,
    commercialPoints: 5,
  },
} as const

export type ScoreConfig = typeof SCORE_CONFIG
