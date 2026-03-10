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
    stateGAPoints: 5,        // in Georgia but not target county
  },

  /** Segment scoring for leadScore.
   *  industrial is awarded whenever the industrial segment is present (pure or mixed).
   *  mixed only applies to non-industrial multi-segment combos (e.g. commercial+residential). */
  segment: {
    industrial: 20,   // awarded whenever industrial is present, regardless of other segments
    commercial: 15,   // commercial-only
    mixed: 10,        // non-industrial multi-segment — was 12
    residential: 5,
  },

  /** Website/contact completeness */
  completeness: {
    hasWebsite: 5,
    hasEmail: 5,
    hasPhone: 3,
    hasStreetAddress: 2,
  },

  /** Specialty keywords — scored per match, not as a flat bonus.
   *  highValue: 6 pts each, capped at 15 (3 matches).
   *  standard:  2 pts each, capped at 6  (3 matches). */
  specialties: {
    highValue: [
      'switchgear',
      'panelboard',             // matches both "panelboard" and "panelboards"
      'controls',
      'generators',
      'ev charging',
      'industrial maintenance',  // moved from standard — high product-demand indicator
    ],
    highValuePointsEach: 6,   // per matched keyword (was flat 8 for any match)
    highValueMax: 15,          // cap at 3 matches
    standard: [
      'lighting',
      'fire alarm',
      'low voltage',
      'distribution center',
      'warehouse',
      'tenant improvement',
      'service',               // added — common in AI output
    ],
    standardPointsEach: 2,    // per matched keyword (was flat 4 for any match)
    standardMax: 6,            // cap at 3 matches
  },

  /** Signal scoring.
   *  basePerSignal/maxSignalBonus/recency apply to activeScore.
   *  leadScorePerSignal/leadScoreSignalMax give a small leadScore bonus for signal volume. */
  signals: {
    basePerSignal: 4,
    maxSignalBonus: 20,
    recency: {
      within30Days: 12,
      within90Days: 7,
      within180Days: 3,
    },
    leadScorePerSignal: 1,   // NEW: each signal adds 1 pt to leadScore
    leadScoreSignalMax: 5,   // NEW: cap
  },

  /** Contact availability */
  contact: {
    hasAnyContact: 5,        // was 8; reduced — email/phone on contact carry more weight
    contactHasEmail: 5,      // was 4; increased — direct outreach path is high value
    contactHasPhone: 3,      // was 4
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
      'data center',        // added
      'food processing',    // added
    ],
    commercialTerms: [
      'commercial',
      'retail',
      'office',
      'tenant improvement',
      'build-out',
      'renovation',         // added
      'multifamily',        // added
      'hospitality',        // added
    ],
    industrialPoints: 4,    // was 6
    commercialPoints: 4,    // was 5
  },

  /** Permit signal score — pre-computed by the permit adapter (Task 1).
   *  Capped at 25 pts contribution to leadScore. */
  permit: {
    maxScore: 25,
  },

  /** AI enrichment confidence bonus.
   *  sourceConfidence is set by enrichWithAI() and reflects how clearly website content
   *  described the company's segment and specialties. */
  confidence: {
    highThreshold: 0.75,   // >= 0.75 → rich, unambiguous AI classification
    highPoints: 3,
    mediumThreshold: 0.50,  // >= 0.50 → reasonable classification
    mediumPoints: 1,
  },
} as const

export type ScoreConfig = typeof SCORE_CONFIG
