/**
 * Permit source adapter scaffold.
 *
 * STATUS: DEMO MODE — live source not connected.
 *
 * TODO (production):
 * - Source: Georgia Secretary of State or county permit portals
 *   (e.g., Gwinnett County Building & Safety, Hall County Permits)
 * - API: No public REST API available; would require web scraping or
 *   official data feed request from county offices
 * - Required credentials: None (public data) or county portal login
 * - Field mapping:
 *   - permitNumber → signal.metadata.permitNumber
 *   - contractor → company.name (normalize + dedupe)
 *   - address → company.street, city, zip
 *   - permitDate → signal.signalDate
 *   - permitType → signal.signalType (PERMIT)
 *   - value → signal.metadata.value
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
  isDemoMode = true

  async discover(): Promise<DiscoverResult[]> {
    return DEMO_PERMITS.map((p) => ({
      sourceId: p.id,
      name: p.contractor,
      metadata: { ...p },
    }))
  }

  async fetchDetails(sourceId: string): Promise<DetailResult | null> {
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
          // Add a signal for this permit
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
