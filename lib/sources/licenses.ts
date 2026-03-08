/**
 * License source adapter scaffold.
 *
 * STATUS: DEMO MODE — live source not connected.
 *
 * TODO (production):
 * - Source: Georgia Secretary of State Licensing Division
 *   URL: https://www.sos.ga.gov/PLB/ProfessionalLicensing
 *   Division: Electrical Contractors (EC license)
 * - API: Georgia SOS provides a license lookup portal but no public API.
 *   Options:
 *   1. Purchase bulk license data from SOS ($200-500 one-time fee)
 *   2. Scrape the public lookup at https://sos.ga.gov/PLB/ProfessionalLicensing/Search
 *   3. Use a third-party data aggregator (e.g., LicenseSuite, Bloombergs BLPAPI)
 * - Required credentials: None for scraping; license key for APIs
 * - Field mapping:
 *   - licenseNumber → signal.metadata.licenseNumber
 *   - licenseeNameDBA → company.name
 *   - licenseType → company.specialties (e.g. "EC" = electrical contractor)
 *   - expirationDate → signal.metadata.expirationDate
 *   - status → signal.metadata.licenseStatus
 *   - principalAddress → company.street, city, zip
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

const DEMO_LICENSES = [
  {
    id: 'DEMO-L-001',
    licenseNumber: 'EC-123456',
    contractor: 'Alpha Electric Group Inc',
    licenseType: 'Electrical Contractor',
    status: 'ACTIVE',
    expirationDate: '2026-12-31',
    city: 'Duluth',
    county: 'Gwinnett',
    state: 'GA',
  },
  {
    id: 'DEMO-L-002',
    licenseNumber: 'EC-789012',
    contractor: 'Premier Power Solutions LLC',
    licenseType: 'Electrical Contractor',
    status: 'ACTIVE',
    expirationDate: '2026-06-30',
    city: 'Gainesville',
    county: 'Hall',
    state: 'GA',
  },
  {
    id: 'DEMO-L-003',
    licenseNumber: 'EC-345678',
    contractor: 'Northeast Georgia Industrial Services',
    licenseType: 'Low Voltage Contractor',
    status: 'ACTIVE',
    expirationDate: '2026-09-30',
    city: 'Gainesville',
    county: 'Hall',
    state: 'GA',
  },
]

export class LicenseAdapter implements SourceAdapter {
  sourceType = 'LICENSE'
  isDemoMode = true

  async discover(): Promise<DiscoverResult[]> {
    return DEMO_LICENSES.map((l) => ({
      sourceId: l.id,
      name: l.contractor,
      metadata: { ...l },
    }))
  }

  async fetchDetails(sourceId: string): Promise<DetailResult | null> {
    const license = DEMO_LICENSES.find((l) => l.id === sourceId)
    if (!license) return null
    return { sourceId, rawData: license }
  }

  normalize(raw: DetailResult): NormalizedRecord {
    const data = raw.rawData as (typeof DEMO_LICENSES)[0]
    return {
      name: data.contractor,
      normalizedName: normalizeName(data.contractor),
      city: data.city,
      county: data.county,
      state: data.state,
      sourceType: this.sourceType,
      sourceName: 'License Records (Demo)',
    }
  }

  async persist(records: NormalizedRecord[]): Promise<PersistResult> {
    let updated = 0
    let skipped = 0
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
              sourceType: 'LICENSE',
              sourceName: 'License Records (Demo)',
              signalType: 'LICENSE',
              signalDate: new Date(),
              county: record.county,
              city: record.city,
              title: `Active license on file — ${record.county} County`,
              snippet: `Demo license signal for ${record.name}`,
              relevanceScore: 0.6,
            },
          })
          updated++
        } else {
          skipped++
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }

    return { created: 0, updated, skipped, errors }
  }
}

export const licenseAdapter = new LicenseAdapter()
