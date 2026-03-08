/**
 * Permit source adapter.
 *
 * STATUS: DEMO MODE — live source not connected. isDemoMode = true is the active default.
 *
 * STEP 0 OUTCOME (2026-03-08):
 *   Live schema inspection was performed. Results:
 *   - Planned URL: https://gis.atlantaga.gov/arcgis/rest/services/ExternalApps/OpenData_Permits/FeatureServer/0
 *     → Returns HTTP 404. Service does not exist at this path.
 *   - Actual Atlanta DPCD ArcGIS server (gis.atlantaga.gov/dpcd/rest/services) has no permits FeatureServer.
 *   - Available permit data: static 2019-2024 CSV export on Atlanta Open Data Hub
 *     (dpcd-coaplangis.opendata.arcgis.com/datasets/655f985f43cc40b4bf2ab7bc73d2169b) — NOT a live API.
 *   - Building Permit Tracker (gis.atlantaga.gov/buildingpermittracker/) exists but exposes no public API.
 *
 *   Per plan: "Live schema could not be confirmed — demo mode default."
 *   All live code paths remain behind isDemoMode guard. Demo stubs remain active.
 *
 * TO CONNECT LIVE PERMITS (options):
 *   A. Atlanta/Fulton: If the city restores or publishes a FeatureServer endpoint, confirm the schema
 *      via step 0 (GET .../FeatureServer/0/query?where=1=1&outFields=*&f=json&resultRecordCount=1),
 *      map real field names, and set isDemoMode = false in live path. Coverage: City of Atlanta only.
 *   B. Static CSV: Periodically download the Open Data Hub CSV and process offline. No live API needed.
 *   C. County permit portals: Gwinnett, Hall, Cobb, Forsyth, Cherokee each have separate portals.
 *      No public REST APIs — would require scraping or official data feed requests.
 *   D. Third-party aggregators: BuildingConnected, ConstructConnect, Dodge Data offer permit feeds
 *      covering multiple counties via paid API access.
 *
 * County stubs for Gwinnett and Hall remain in DEMO_PERMITS, labeled clearly as demo data.
 * Do NOT remove these stubs unless replaced with a confirmed live integration.
 */

import type {
  SourceAdapter,
  DiscoverResult,
  DetailResult,
  NormalizedRecord,
  PersistResult,
} from './base'
import { normalizeName } from '@/lib/normalization'
import { db } from '@/lib/db'

// Demo data — live source not connected.
// Gwinnett and Hall county fixtures; Atlanta/Fulton stub absent (no live API confirmed — see above).
const DEMO_PERMITS: Array<{
  id: string
  contractor: string
  address: string
  city: string
  county: string
  permitType: string
  permitDate: string
  value: number
}> = [
  {
    id: 'DEMO-P-001',
    contractor: 'Gwinnett Industrial Electric LLC',
    address: '1200 Industrial Blvd',
    city: 'Duluth',
    county: 'Gwinnett',
    permitType: 'Electrical - Commercial New Construction',
    permitDate: '2025-11-15',
    value: 45000,
  },
  {
    id: 'DEMO-P-002',
    contractor: 'Alpha Electric Group Inc',
    address: '800 Commerce Dr',
    city: 'Lawrenceville',
    county: 'Gwinnett',
    permitType: 'Electrical - Industrial Renovation',
    permitDate: '2025-12-01',
    value: 120000,
  },
  {
    id: 'DEMO-P-003',
    contractor: 'Northeast Georgia Industrial Services',
    address: '3400 Browns Bridge Rd',
    city: 'Gainesville',
    county: 'Hall',
    permitType: 'Electrical - Industrial Maintenance',
    permitDate: '2025-10-20',
    value: 35000,
  },
]

export class PermitAdapter implements SourceAdapter {
  sourceType = 'PERMIT'
  // isDemoMode = true is non-negotiable until live schema is confirmed via step 0.
  // See top-of-file comment for step 0 outcome and live connection options.
  isDemoMode = true
  demoReason = 'Live ArcGIS schema not confirmed — see permits.ts step 0 comment'

  async discover(): Promise<DiscoverResult[]> {
    // Demo data — live source not connected
    return DEMO_PERMITS.map((p) => ({
      sourceId: p.id,
      name: p.contractor,
      metadata: { ...p },
    }))
  }

  async fetchDetails(sourceId: string): Promise<DetailResult | null> {
    // Demo data — live source not connected
    const permit = DEMO_PERMITS.find((p) => p.id === sourceId)
    if (!permit) return null
    return { sourceId, rawData: permit }
  }

  normalize(raw: DetailResult): NormalizedRecord {
    const data = raw.rawData as (typeof DEMO_PERMITS)[0]
    return {
      name: data.contractor,
      normalizedName: normalizeName(data.contractor),
      city: data.city,
      county: data.county,
      state: 'GA',
      sourceType: this.sourceType,
      sourceName: 'Permit Records (Demo)',
      sourceUrl: undefined,
    }
  }

  async persist(records: NormalizedRecord[]): Promise<PersistResult> {
    const counters = { created: 0, updated: 0, skipped: 0 }
    const errors: string[] = []

    for (const record of records) {
      try {
        const existing = await db.company.findFirst({
          where: { normalizedName: record.normalizedName },
        })
        if (existing) {
          await db.signal.create({
            data: {
              companyId: existing.id,
              sourceType: 'PERMIT',
              sourceName: 'Permit Records (Demo)',
              signalType: 'PERMIT',
              signalDate: new Date(),
              county: record.county,
              city: record.city,
              title: `Permit activity in ${record.city}, ${record.county} County`,
              snippet: `Demo permit signal for ${record.name}`,
              relevanceScore: 0.7,
              metadata: {
                // liveMode = false: step 0 failed, no live API confirmed — see top-of-file comment
                liveMode: false,
                demoData: true,
              },
            },
          })
          counters.updated++
        } else {
          counters.skipped++
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }

    return { created: counters.created, updated: counters.updated, skipped: counters.skipped, errors }
  }
}

export const permitAdapter = new PermitAdapter()
