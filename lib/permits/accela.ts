/**
 * Accela REST API adapter — fetches permit records from Accela agencies via apis.accela.com.
 *
 * Supported agencies: Gwinnett County, Hall County, Atlanta (Fulton)
 * NOTE: Cobb County does not appear to be registered on the Accela developer platform
 *       (auth server returns 500 for all known agency name variations).
 *
 * Auth: OAuth2 client_credentials via https://auth.accela.com/oauth2/token
 * Tokens are cached module-level until 60 seconds before expiry.
 *
 * IMPORTANT — Agency authorization required:
 *   The Accela developer API requires two levels of access:
 *   1. A registered developer app (ACCELA_APP_ID / ACCELA_APP_SECRET) — we have this.
 *   2. Each county must grant that app access in their Accela admin portal — NOT YET DONE.
 *
 *   Auth server agency name verification (via test as of 2026-03-10):
 *     'GWINNETT'    → data_validation_error (agency recognized, app not yet authorized)
 *     'HALLCO'      → data_validation_error (agency recognized, app not yet authorized)
 *     'ATLANTA_GA'  → data_validation_error (agency recognized, app not yet authorized)
 *     'COBB_COUNTY' → 500 invalid_request   (agency NOT found in Accela developer system)
 *
 *   Until authorization is granted by each county, this adapter will return [] silently.
 *   Raw record logging is included for first-record field mapping once auth works.
 */

import { type NormalizedPermit, isResidential, normalizeStatus } from '@/lib/permits/base'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ACCELA_APP_ID = process.env.ACCELA_APP_ID ?? ''
const ACCELA_APP_SECRET = process.env.ACCELA_APP_SECRET ?? ''

const AGENCY_CONFIG = {
  // authAgencyName: exact agency_name as registered on auth.accela.com
  // (differs from the ACA citizen portal URL code)
  GWINNETT_COUNTY: { authAgencyName: 'GWINNETT',   source: 'ACCELA_GWINNETT', county: 'Gwinnett' },
  HALL_COUNTY:     { authAgencyName: 'HALLCO',      source: 'ACCELA_HALLCO',   county: 'Hall' },
  ATLANTA_GA:      { authAgencyName: 'ATLANTA_GA',  source: 'ACCELA_ATLANTA',  county: 'Fulton' },
  // Cobb County excluded: not found in Accela developer system (500 for all name variations)
} as const

type AgencyName = keyof typeof AGENCY_CONFIG

// ---------------------------------------------------------------------------
// Module-level token cache: one entry per agency
// ---------------------------------------------------------------------------

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function getAccelaToken(agencyName: string): Promise<string> {
  if (!ACCELA_APP_ID || !ACCELA_APP_SECRET) {
    throw new Error('[accela] ACCELA_APP_ID and ACCELA_APP_SECRET must be set')
  }

  const cached = tokenCache.get(agencyName)
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: ACCELA_APP_ID,
    client_secret: ACCELA_APP_SECRET,
    agency_name: agencyName,
    environment: 'PROD',
    scope: 'records',
  })

  const res = await fetch('https://auth.accela.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[accela] Token request failed for ${agencyName}: ${res.status} ${text}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  const token = data.access_token
  const expiresAt = Date.now() + data.expires_in * 1_000

  tokenCache.set(agencyName, { token, expiresAt })
  return token
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a Date as YYYY-MM-DD for Accela query params.
 */
function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Derive a normalized permit type from Accela record type fields.
 */
function derivePermitType(
  raw: string | undefined | null,
): NormalizedPermit['permitType'] {
  if (!raw) return 'OTHER'
  const upper = raw.toUpperCase()
  if (upper.includes('ELECTRICAL')) return 'ELECTRICAL'
  if (upper.includes('BUILDING')) return 'BUILDING'
  if (upper.includes('MECHANICAL')) return 'MECHANICAL'
  return 'OTHER'
}

/**
 * Pick the best available job value field from an Accela record.
 * Field names are best-guess until raw log confirms actual names.
 */
function pickJobValue(record: Record<string, unknown>): number | null {
  const candidates = [
    record['estimatedTotalJobCost'],
    record['totalFee'],
    record['jobValue'],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (record['valuations'] as any)?.[0]?.value,
  ]
  for (const v of candidates) {
    const n = Number(v)
    if (v !== undefined && v !== null && v !== '' && !Number.isNaN(n)) {
      return n
    }
  }
  return null
}

/**
 * Build a formatted street address string from Accela address fields.
 */
function buildAddress(addr: Record<string, unknown>): string {
  const parts: string[] = []

  const streetAddress = addr['streetAddress'] as string | undefined
  if (streetAddress) return streetAddress

  const num = addr['streetStart'] ?? addr['houseNumberStart'] ?? addr['streetNumber'] ?? ''
  const dir = addr['streetDirection'] ?? ''
  const name = addr['streetName'] ?? ''
  const suffix = addr['streetSuffix'] ?? ''
  const unit = addr['unitNumber'] ?? addr['unit'] ?? ''
  const city = addr['city'] ?? ''
  const state = addr['state'] ?? ''
  const zip = addr['zip'] ?? addr['postalCode'] ?? ''

  if (num) parts.push(String(num))
  if (dir) parts.push(String(dir))
  if (name) parts.push(String(name))
  if (suffix) parts.push(String(suffix))
  if (unit) parts.push(`#${String(unit)}`)

  const street = parts.join(' ').trim()
  const cityState = [city, state].filter(Boolean).join(', ')
  const full = [street, cityState, zip].filter(Boolean).join(' ')
  return full || ''
}

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------

/**
 * Fetch all pages for a single record type query.
 * Paginates until the results array is empty.
 */
async function fetchAllPages(
  token: string,
  agencyName: string,
  recordType: string,
  openedDateFrom: string,
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  let offset = 0
  const limit = 100

  while (true) {
    const url = new URL('https://apis.accela.com/v4/records')
    url.searchParams.set('type', recordType)
    url.searchParams.set('openedDateFrom', openedDateFrom)
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('offset', String(offset))

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-accela-agencyappid': ACCELA_APP_ID,
      },
      signal: AbortSignal.timeout(20_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(
        `[accela] Records fetch failed for ${agencyName} type=${recordType} offset=${offset}: ${res.status} ${text}`,
      )
    }

    const data = (await res.json()) as { result?: unknown[] }
    const results = data.result ?? []
    if (!Array.isArray(results) || results.length === 0) break

    all.push(...(results as Record<string, unknown>[]))
    if (results.length < limit) break
    offset += limit
  }

  return all
}

// ---------------------------------------------------------------------------
// Contact fetch
// ---------------------------------------------------------------------------

interface ContractorInfo {
  contractorName: string
  contractorPhone: string | null
  contractorLicense: string | null
}

async function fetchContractor(
  token: string,
  recordId: string,
): Promise<ContractorInfo> {
  const url = `https://apis.accela.com/v4/records/${encodeURIComponent(recordId)}/contacts`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-accela-agencyappid': ACCELA_APP_ID,
    },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    return { contractorName: '', contractorPhone: null, contractorLicense: null }
  }

  const data = (await res.json()) as { result?: unknown[] }
  const contacts = Array.isArray(data.result) ? (data.result as Record<string, unknown>[]) : []

  const contractor = contacts.find(
    (c) => c['type'] === 'Contractor' || c['type'] === 'License Holder',
  )

  if (!contractor) {
    return { contractorName: '', contractorPhone: null, contractorLicense: null }
  }

  // Prefer businessName, fall back to first + last name
  const businessName = contractor['businessName'] as string | undefined
  const firstName = contractor['firstName'] as string | undefined
  const lastName = contractor['lastName'] as string | undefined
  const contractorName =
    businessName?.trim() ||
    [firstName, lastName].filter(Boolean).join(' ').trim() ||
    ''

  const phone =
    (contractor['phone'] as string | undefined) ??
    (contractor['phoneNumber'] as string | undefined) ??
    null

  const license =
    (contractor['licenseNumber'] as string | undefined) ??
    (contractor['licenseNbr'] as string | undefined) ??
    null

  return {
    contractorName,
    contractorPhone: phone || null,
    contractorLicense: license || null,
  }
}

// ---------------------------------------------------------------------------
// Main adapter
// ---------------------------------------------------------------------------

async function accelaAdapter(agencyName: AgencyName): Promise<NormalizedPermit[]> {
  if (!ACCELA_APP_ID || !ACCELA_APP_SECRET) {
    console.warn('[accela] ACCELA_APP_ID or ACCELA_APP_SECRET not set — skipping')
    return []
  }

  const config = AGENCY_CONFIG[agencyName]
  let token: string

  try {
    token = await getAccelaToken(config.authAgencyName)
  } catch (err) {
    console.warn(`[accela] Could not obtain token for ${agencyName} (authAgencyName=${config.authAgencyName}):`, err)
    return []
  }

  // 30 days ago
  const openedDateFrom = formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000))

  // Fetch BUILDING/ELECTRICAL and BUILDING/ALL in parallel
  let rawElectrical: Record<string, unknown>[] = []
  let rawAll: Record<string, unknown>[] = []

  try {
    ;[rawElectrical, rawAll] = await Promise.all([
      fetchAllPages(token, agencyName, 'BUILDING/ELECTRICAL', openedDateFrom),
      fetchAllPages(token, agencyName, 'BUILDING/ALL', openedDateFrom),
    ])
  } catch (err) {
    console.warn(`[accela] Failed to fetch records for ${agencyName}:`, err)
    return []
  }

  // Dedupe by record.id (prefer) or record.customId
  const seen = new Set<string>()
  const combined: Record<string, unknown>[] = []
  for (const record of [...rawElectrical, ...rawAll]) {
    const key =
      (record['id'] as string | undefined) ??
      (record['customId'] as string | undefined) ??
      ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    combined.push(record)
  }

  // Raw log — once per adapter invocation, first successful record
  let hasLoggedRaw = false

  const results: NormalizedPermit[] = []

  for (const rawRecord of combined) {
    // TEMP: Log raw record sample to confirm field mapping — remove after verification
    if (!hasLoggedRaw) {
      console.log(
        `[accela] ${agencyName} raw record sample:`,
        JSON.stringify(rawRecord, null, 2),
      )
      hasLoggedRaw = true
    }

    try {
      const recordId =
        (rawRecord['id'] as string | undefined) ??
        (rawRecord['customId'] as string | undefined) ??
        ''
      const permitNumber =
        (rawRecord['customId'] as string | undefined) ??
        (rawRecord['id'] as string | undefined) ??
        ''

      if (!recordId || !permitNumber) {
        console.warn(`[accela] ${agencyName}: skipping record with no id/customId`)
        continue
      }

      // Derive permit type from record.type subType or category
      const typeObj = rawRecord['type'] as Record<string, unknown> | undefined
      const typeString =
        (typeObj?.['subType'] as string | undefined) ??
        (typeObj?.['category'] as string | undefined) ??
        (typeObj?.['text'] as string | undefined) ??
        ''
      const permitType = derivePermitType(typeString)

      // Description
      const description =
        (rawRecord['shortNotes'] as string | undefined) ??
        (rawRecord['description'] as string | undefined) ??
        null

      // Status
      const statusObj = rawRecord['status'] as Record<string, unknown> | string | undefined
      const statusRaw =
        typeof statusObj === 'string'
          ? statusObj
          : (statusObj?.['text'] as string | undefined) ?? ''
      const status = normalizeStatus(statusRaw)

      // Address
      const addresses = rawRecord['addresses'] as Record<string, unknown>[] | undefined
      const firstAddr = addresses?.[0] as Record<string, unknown> | undefined
      const jobAddress = firstAddr ? buildAddress(firstAddr) : null

      // Dates
      const openedDate =
        (rawRecord['openedDate'] as string | undefined) ??
        (rawRecord['filedDate'] as string | undefined)
      if (!openedDate) {
        console.warn(`[accela] ${agencyName}: skipping ${recordId} — no openedDate/filedDate`)
        continue
      }
      const filedAt = new Date(openedDate)

      const issuedDateRaw = rawRecord['issuedDate'] as string | undefined
      const issuedAt = issuedDateRaw ? new Date(issuedDateRaw) : null

      const closedDateRaw = rawRecord['closedDate'] as string | undefined
      const closedAt = closedDateRaw ? new Date(closedDateRaw) : null

      // Job value
      const jobValue = pickJobValue(rawRecord)

      // Contractor — fetch from contacts endpoint
      const contactInfo = await fetchContractor(token, recordId)

      if (!contactInfo.contractorName) {
        console.warn(
          `[accela] ${agencyName}: skipping ${recordId} — no contractor name found`,
        )
        continue
      }

      results.push({
        source: config.source,
        externalId: recordId,
        permitNumber,
        permitType,
        description,
        status,
        jobAddress: jobAddress || null,
        county: config.county,
        jobValue,
        isResidential: isResidential(description),
        filedAt,
        issuedAt,
        inspectionAt: null,
        closedAt,
        contractorName: contactInfo.contractorName,
        contractorPhone: contactInfo.contractorPhone,
        contractorLicense: contactInfo.contractorLicense,
      })
    } catch (err) {
      const id =
        (rawRecord['id'] as string | undefined) ??
        (rawRecord['customId'] as string | undefined) ??
        'unknown'
      console.warn(`[accela] ${agencyName}: failed to map record ${id}:`, err)
      // Never throw — skip and continue
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { accelaAdapter }
export type { AgencyName }
