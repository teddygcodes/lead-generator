/**
 * DeKalb County ArcGIS permit adapter.
 *
 * Fetches building permit applications from DeKalb County's public ArcGIS
 * FeatureServer REST API — no authentication required.
 *
 * Endpoint:
 *   https://dcgis.dekalbcountyga.gov/mapping/rest/services/
 *   Building_Permit_Applications/FeatureServer/0/query
 *
 * Run the diagnostic script to verify:
 *   pnpm tsx scripts/test-dekalb.ts
 */

import { normalizeStatus, isResidential, type NormalizedPermit } from './base'
import { normalizePhone } from '@/lib/normalization'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL =
  'https://dcgis.dekalbcountyga.gov/mapping/rest/services/Building_Permit_Applications/FeatureServer/0/query'

const OUT_FIELDS = [
  'applicationNumber',
  'applicationDateTime',
  'issuedDateTime',
  'locationLine1',
  'primaryContactName',
  'primaryContactPhone',
  'primaryContactEMailAddress',
  'declaredValuation',
  'calculatedValuation',
  'status',
  'occupancyType',
  'OccupancyTypeDescription',
  'workType',
  'WorkTypeDescription',
  'applicationType_description',
  'processState',
].join(',')

const RESULT_RECORD_COUNT = 2000
const MAX_PAGES = 10

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Parse a job value from declaredValuation or calculatedValuation.
 * Returns null for missing, non-numeric, or zero values.
 */
function parseJobValue(declared: unknown, calculated: unknown): number | null {
  const raw = declared ?? calculated
  if (raw === null || raw === undefined || raw === '') return null
  const n = parseFloat(String(raw))
  return isNaN(n) || n === 0 ? null : n
}

// ---------------------------------------------------------------------------
// Raw API types
// ---------------------------------------------------------------------------

interface ArcGisResponse {
  features?: Array<{
    attributes: Record<string, unknown>
  }>
  exceededTransferLimit?: boolean
  error?: { message: string }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Format a Date as 'YYYY-MM-DD' for ArcGIS SQL DATE literals.
 * The ArcGIS FeatureServer rejects Unix-ms integer filters for date fields;
 * DATE 'YYYY-MM-DD' is the accepted format.
 */
function toArcGisDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Fetch DeKalb County building permits from the last 90 days.
 * Paginates automatically (up to MAX_PAGES pages × RESULT_RECORD_COUNT records).
 */
export async function fetchDekalbPermits(): Promise<NormalizedPermit[]> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  // ArcGIS requires DATE 'YYYY-MM-DD' syntax — Unix ms integers are rejected.
  // primaryContactType = '2' → actual contractors/license holders (not agents or owners).
  // workType LIKE 'R-%' → electrical permits only (R-COMB, R-REWI, R-LOVO, R-TPOW, etc.)
  //   All electrical codes share the R- prefix; plumbing=W-*, HVAC=M-*, building=D-*.
  const where = `applicationDateTime >= DATE '${toArcGisDate(since)}' AND primaryContactType = '2' AND workType LIKE 'R-%'`

  const allFeatures: Record<string, unknown>[] = []

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      where,
      outFields: OUT_FIELDS,
      resultRecordCount: String(RESULT_RECORD_COUNT),
      resultOffset: String(page * RESULT_RECORD_COUNT),
      f: 'json',
    })

    const url = `${BASE_URL}?${params.toString()}`
    let data: ArcGisResponse

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'LeadGeneratorBot/1.0' },
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`)
      }
      data = (await res.json()) as ArcGisResponse
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`[dekalb] fetch failed on page ${page + 1}: ${message}`)
    }

    if (data.error) {
      throw new Error(`[dekalb] ArcGIS error: ${data.error.message}`)
    }

    const features = data.features ?? []
    for (const f of features) {
      allFeatures.push(f.attributes)
    }

    console.log(`[dekalb] page ${page + 1}: fetched ${features.length} records (total so far: ${allFeatures.length})`)

    // Stop if the server indicates no more pages
    if (!data.exceededTransferLimit) break
  }

  // Map raw attributes → NormalizedPermit
  const permits: NormalizedPermit[] = []

  for (const attrs of allFeatures) {
    const applicationNumber = attrs.applicationNumber as string | null
    if (!applicationNumber) continue   // skip records without a permit number

    const contractorName = (attrs.primaryContactName as string | null) ?? ''
    const rawPhone = attrs.primaryContactPhone as string | null | undefined
    const phone = normalizePhone(rawPhone) || null

    const occupancyDesc = attrs.OccupancyTypeDescription as string | null
    const occupancyType = attrs.occupancyType as string | null
    const workTypeDesc = attrs.WorkTypeDescription as string | null

    const rawStatus = (attrs.processState as string | null) ?? (attrs.status as string | null) ?? ''
    const rawFiled = attrs.applicationDateTime as number | null
    const rawIssued = attrs.issuedDateTime as number | null

    permits.push({
      source: 'ARCGIS_DEKALB',
      externalId: applicationNumber,
      permitNumber: applicationNumber,
      // WHERE clause filters to workType LIKE 'R-%' — all R-* codes are electrical.
      // Hardcoding avoids misclassifying R-TPOW ("Temporary Power") as BUILDING.
      permitType: 'ELECTRICAL',
      description: workTypeDesc ?? occupancyDesc ?? null,
      status: normalizeStatus(rawStatus),
      jobAddress: (attrs.locationLine1 as string | null) ?? null,
      county: 'DeKalb',
      jobValue: parseJobValue(attrs.declaredValuation, attrs.calculatedValuation),
      isResidential: isResidential(occupancyDesc ?? occupancyType ?? null),
      filedAt: rawFiled ? new Date(rawFiled) : new Date(),
      issuedAt: rawIssued ? new Date(rawIssued) : null,
      inspectionAt: null,
      closedAt: null,
      contractorName,
      contractorPhone: phone,
      contractorLicense: null,
    })
  }

  console.log(`[dekalb] normalized ${permits.length} permits from ${allFeatures.length} raw records`)
  return permits
}
