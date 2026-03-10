/**
 * Base types and utilities for permit normalization across all data sources.
 */

/**
 * Normalized permit data structure, agnostic to source system.
 * Used as intermediate representation before persisting to database.
 */
export interface NormalizedPermit {
  source: string
  externalId: string
  permitNumber: string
  permitType: 'ELECTRICAL' | 'BUILDING' | 'MECHANICAL' | 'OTHER'
  description: string | null
  status: 'APPLIED' | 'ISSUED' | 'INSPECTED' | 'CLOSED'
  jobAddress: string | null
  county: string
  jobValue: number | null
  isResidential: boolean
  filedAt: Date
  issuedAt: Date | null
  inspectionAt: Date | null
  closedAt: Date | null
  contractorName: string
  contractorPhone: string | null
  contractorLicense: string | null
}

/**
 * Keywords used to identify residential job types.
 * Matching is case-insensitive.
 */
export const RESIDENTIAL_KEYWORDS = [
  'SFR',
  'single family',
  'residence',
  'residential',
  'house',
  'townhome',
  'townhouse',
  'duplex',
  'apartment unit',
]

/**
 * Classify permit as residential or commercial based on description keywords.
 * @param description - The permit description or null
 * @returns true if any RESIDENTIAL_KEYWORDS match (case-insensitive), false if null
 */
export function isResidential(description: string | null): boolean {
  if (!description) {
    return false
  }

  const lowerDescription = description.toLowerCase()
  return RESIDENTIAL_KEYWORDS.some((keyword) =>
    lowerDescription.includes(keyword.toLowerCase())
  )
}

/**
 * Normalize permit status from raw source value to standard status enum.
 * Matching is case-insensitive and uses partial string matching.
 * @param raw - Raw status string from data source
 * @returns Normalized status: APPLIED | ISSUED | INSPECTED | CLOSED
 */
export function normalizeStatus(
  raw: string
): 'APPLIED' | 'ISSUED' | 'INSPECTED' | 'CLOSED' {
  const normalized = raw.toLowerCase()

  if (
    normalized.includes('applied') ||
    normalized.includes('submitted') ||
    normalized.includes('pending')
  ) {
    return 'APPLIED'
  }

  if (
    normalized.includes('issued') ||
    normalized.includes('in review') ||
    normalized.includes('under review')
  ) {
    return 'ISSUED'
  }

  if (
    normalized.includes('inspection') ||
    normalized.includes('inspected')
  ) {
    return 'INSPECTED'
  }

  if (
    normalized.includes('final') ||
    normalized.includes('closed') ||
    normalized.includes('void') ||
    normalized.includes('expired')
  ) {
    return 'CLOSED'
  }

  // Default fallback
  return 'APPLIED'
}
