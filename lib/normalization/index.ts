/**
 * Normalization utilities
 * Used for consistent comparison and deduplication of company records.
 */

const LEGAL_SUFFIXES = [
  /\b(llc|l\.l\.c\.?)\b/gi,
  /\b(inc|incorporated|inc\.)\b/gi,
  /\b(corp|corporation|corp\.)\b/gi,
  /\b(ltd|limited|ltd\.)\b/gi,
  /\b(co\.|company|co)\b/gi,
  /\b(lp|l\.p\.)\b/gi,
  /\b(llp|l\.l\.p\.)\b/gi,
  /\b(plc)\b/gi,
  /\b(gmbh)\b/gi,
]

/**
 * Normalize a company name for comparison / deduplication.
 * Strips legal suffixes, lowercases, trims, collapses whitespace.
 */
export function normalizeName(name: string | null | undefined): string {
  if (!name) return ''
  let result = name.trim().toLowerCase()
  // strip punctuation except hyphens and spaces
  result = result.replace(/[^\w\s-]/g, ' ')
  // strip legal suffixes
  for (const pattern of LEGAL_SUFFIXES) {
    result = result.replace(pattern, '')
  }
  // collapse whitespace
  result = result.replace(/\s+/g, ' ').trim()
  return result
}

/**
 * Normalize a domain: strip protocol, www., trailing slash and path.
 * Returns lowercase domain only (e.g. "example.com").
 */
export function normalizeDomain(raw: string | null | undefined): string {
  if (!raw) return ''
  let domain = raw.trim().toLowerCase()
  // strip protocol
  domain = domain.replace(/^https?:\/\//i, '')
  // strip www.
  domain = domain.replace(/^www\./i, '')
  // strip path and query
  domain = domain.split('/')[0].split('?')[0].split('#')[0]
  // strip trailing dot
  domain = domain.replace(/\.$/, '')
  return domain
}

/**
 * Normalize a phone number to 10-digit string (US).
 * Returns empty string if cannot be parsed to 10 digits.
 */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  let local = ''
  // handle +1 country code (11 digits)
  if (digits.length === 11 && digits.startsWith('1')) {
    local = digits.slice(1)
  } else if (digits.length === 10) {
    local = digits
  } else {
    return ''
  }
  // US area codes (NXX): N must be 2–9; exchange must also be 2–9
  if (local[0] < '2' || local[3] < '2') return ''
  return local
}

/**
 * Normalize address component: trim and title-case.
 */
export function normalizeAddress(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase())
}

/**
 * Extract domain from a URL (for use when storing company website).
 */
export function extractDomain(url: string | null | undefined): string {
  if (!url) return ''
  try {
    const withProtocol = url.startsWith('http') ? url : `https://${url}`
    const parsed = new URL(withProtocol)
    return normalizeDomain(parsed.hostname)
  } catch {
    return normalizeDomain(url)
  }
}

export { deriveCountyFromCity } from './georgia-cities'
export { geocodeCountyFromAddress } from './geocode-county'
