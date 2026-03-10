/**
 * EnerGov REST API adapter — fetches permit records from EnerGov-powered county portals.
 *
 * Supported instances: Forsyth County, Jackson County
 *
 * Auth: None required — public REST API.
 *
 * IMPORTANT: Raw API response logging is enabled for the first successful fetch
 * per adapter invocation to confirm actual field names before mapping is finalized.
 * Remove the raw log block once field mapping is verified.
 */

import { type NormalizedPermit, isResidential, normalizeStatus } from '@/lib/permits/base'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const INSTANCE_CONFIG = {
  FORSYTH: {
    base: 'https://css.forsythco.com/EnerGov_Prod/SelfService',
    county: 'Forsyth',
    source: 'ENERGOV_FORSYTH',
  },
  JACKSON: {
    base: 'https://jacksoncountyga-energovweb.tylerhost.net/apps/selfservice',
    county: 'Jackson',
    source: 'ENERGOV_JACKSON',
  },
} as const

type InstanceName = keyof typeof INSTANCE_CONFIG

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a Date as YYYY-MM-DD for EnerGov query params.
 */
function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Derive a normalized permit type from raw EnerGov type fields.
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
 * Pick the first non-null contractor name from a raw EnerGov result record.
 */
function pickContractorName(result: Record<string, unknown>): string {
  const candidates = [
    result['contractorName'],
    result['applicantName'],
    result['ownerName'],
  ]
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return 'Unknown'
}

// ---------------------------------------------------------------------------
// Pagination — single keyword pass
// ---------------------------------------------------------------------------

/**
 * Fetch all pages for a single keyword search against the EnerGov permits endpoint.
 * Paginates via pageNumber until an empty results array is returned.
 */
async function fetchKeywordPages(
  base: string,
  instance: InstanceName,
  keyword: string,
  startDate: string,
  endDate: string,
  hasLoggedRawRef: { value: boolean },
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  let pageNumber = 1

  while (true) {
    const res = await fetch(`${base}/api/energov/search/permits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword,
        permitTypeId: null,
        statusId: null,
        startDate,
        endDate,
        pageNumber,
        pageSize: 50,
      }),
      signal: AbortSignal.timeout(20_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(
        `[energov] ${instance} keyword="${keyword}" page=${pageNumber}: HTTP ${res.status} ${text}`,
      )
    }

    const data = (await res.json()) as { results?: unknown[]; Result?: unknown[] }
    const results: Record<string, unknown>[] = Array.isArray(data.results)
      ? (data.results as Record<string, unknown>[])
      : Array.isArray(data.Result)
        ? (data.Result as Record<string, unknown>[])
        : []

    console.log(
      `[energov] ${instance} keyword="${keyword}" page=${pageNumber} results=${results.length}`,
    )

    // TEMP: Log raw record sample on first successful page — remove after field mapping verified
    if (!hasLoggedRawRef.value && results.length > 0) {
      console.log(
        `[energov] ${instance} raw result sample:`,
        JSON.stringify(results[0], null, 2),
      )
      hasLoggedRawRef.value = true
    }

    if (results.length === 0) break

    all.push(...results)
    pageNumber++
  }

  return all
}

// ---------------------------------------------------------------------------
// Main adapter
// ---------------------------------------------------------------------------

async function energovAdapter(instance: InstanceName): Promise<NormalizedPermit[]> {
  const config = INSTANCE_CONFIG[instance]
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000)
  const startDate = formatDate(thirtyDaysAgo)
  const endDate = formatDate(now)

  // Shared raw-log gate across both passes
  const hasLoggedRawRef = { value: false }

  // Run two keyword passes sequentially to avoid rate limiting
  let rawElectrical: Record<string, unknown>[] = []
  let rawCommercial: Record<string, unknown>[] = []

  try {
    rawElectrical = await fetchKeywordPages(
      config.base,
      instance,
      'electrical',
      startDate,
      endDate,
      hasLoggedRawRef,
    )
  } catch (err) {
    console.warn(`[energov] ${instance} keyword="electrical" fetch failed:`, err)
  }

  try {
    rawCommercial = await fetchKeywordPages(
      config.base,
      instance,
      'commercial',
      startDate,
      endDate,
      hasLoggedRawRef,
    )
  } catch (err) {
    console.warn(`[energov] ${instance} keyword="commercial" fetch failed:`, err)
  }

  // Dedupe by externalId (same permit may appear in both keyword passes)
  const seen = new Set<string>()
  const combined: Record<string, unknown>[] = []
  for (const record of [...rawElectrical, ...rawCommercial]) {
    const externalId =
      (record['caseNumber'] as string | undefined) ??
      (record['permitNumber'] as string | undefined) ??
      (record['id'] as string | undefined) ??
      ''
    if (!externalId || seen.has(externalId)) continue
    seen.add(externalId)
    combined.push(record)
  }

  const permits: NormalizedPermit[] = []

  for (const result of combined) {
    try {
      // External ID / permit number
      const externalId =
        (result['caseNumber'] as string | undefined) ??
        (result['permitNumber'] as string | undefined) ??
        (result['id'] as string | undefined) ??
        ''

      if (!externalId) {
        console.warn(`[energov] ${instance}: skipping record with no caseNumber/permitNumber/id`)
        continue
      }

      // Permit type
      const rawType =
        (result['permitType'] as string | undefined) ??
        (result['caseType'] as string | undefined) ??
        null
      const permitType = derivePermitType(rawType)

      // Description
      const description =
        (result['description'] as string | undefined) ??
        (result['workDescription'] as string | undefined) ??
        null

      // Status
      const rawStatus =
        (result['status'] as string | undefined) ??
        (result['caseStatus'] as string | undefined) ??
        ''
      const status = normalizeStatus(rawStatus)

      // Address
      const jobAddress =
        (result['address'] as string | undefined) ??
        (result['locationAddress'] as string | undefined) ??
        null

      // Job value
      const rawValue =
        (result['estimatedValue'] as number | null | undefined) ??
        (result['jobValue'] as number | null | undefined) ??
        (result['valuation'] as number | null | undefined) ??
        null
      const jobValue =
        rawValue !== null && rawValue !== undefined && !Number.isNaN(Number(rawValue))
          ? Number(rawValue)
          : null

      // Dates — skip records with no valid filedAt
      const rawFiledDate =
        (result['filedDate'] as string | undefined) ??
        (result['applicationDate'] as string | undefined) ??
        (result['createdDate'] as string | undefined) ??
        null

      if (!rawFiledDate) {
        console.warn(`[energov] ${instance}: skipping ${externalId} — no filedDate/applicationDate/createdDate`)
        continue
      }

      const filedAt = new Date(rawFiledDate)
      if (Number.isNaN(filedAt.getTime())) {
        console.warn(`[energov] ${instance}: skipping ${externalId} — invalid filedAt date "${rawFiledDate}"`)
        continue
      }

      const rawIssuedDate = result['issuedDate'] as string | undefined
      const issuedAt = rawIssuedDate ? new Date(rawIssuedDate) : null

      const rawInspectionDate = result['inspectionDate'] as string | undefined
      const inspectionAt = rawInspectionDate ? new Date(rawInspectionDate) : null

      const rawClosedDate = result['closedDate'] as string | undefined
      const closedAt = rawClosedDate ? new Date(rawClosedDate) : null

      // Contractor
      const contractorName = pickContractorName(result)
      const contractorPhone =
        (result['contractorPhone'] as string | undefined) ??
        (result['applicantPhone'] as string | undefined) ??
        null
      const contractorLicense =
        (result['licenseNumber'] as string | undefined) ??
        (result['contractorLicense'] as string | undefined) ??
        null

      permits.push({
        source: config.source,
        externalId,
        permitNumber: externalId,
        permitType,
        description,
        status,
        jobAddress,
        county: config.county,
        jobValue,
        isResidential: isResidential(description),
        filedAt,
        issuedAt,
        inspectionAt,
        closedAt,
        contractorName,
        contractorPhone,
        contractorLicense,
      })
    } catch (err) {
      const id =
        (result['caseNumber'] as string | undefined) ??
        (result['permitNumber'] as string | undefined) ??
        (result['id'] as string | undefined) ??
        'unknown'
      console.warn(`[energov] ${instance}: failed to map record ${id}:`, err)
      // Never throw — skip and continue
    }
  }

  return permits
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { energovAdapter }
export type { InstanceName }
