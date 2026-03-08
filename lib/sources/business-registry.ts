// BusinessRegistryAdapter — GA business entity verification via OpenCorporates
//
// IMPORTANT NAMING:
//   - Internal adapter registry key: "LICENSE" (backward-compat only — never expose to users)
//   - Signal signalType: BUSINESS_REGISTRY
//   - All product-facing labels: "Business Registry", "GA Business Registration"
//   - The raw key "LICENSE" must never appear in route responses, job output, or UI text
//
// WHAT THIS ADAPTER IS:
//   Business entity / incorporation verification via OpenCorporates for Georgia-registered
//   companies. OpenCorporates is an independent aggregation layer — not a direct GA SOS API
//   mirror, but sources from GA Secretary of State entity data.
//
// WHAT THIS ADAPTER IS NOT:
//   GA PLB electrical contractor licensing (EC license). The GA State Licensing Board for
//   Residential and General Contractors has no public API — accessing that data requires
//   purchasing a bulk data file from the SOS Licensing Division.
//
// OpenCorporates API:
//   - Requires OPENCORPORATES_API_KEY env var
//   - Rate limits depend on account plan — check GET /account_status for current quota
//   - Docs: https://api.opencorporates.com/documentation/API-Reference

import type {
  SourceAdapter,
  DiscoverResult,
  DetailResult,
  NormalizedRecord,
  PersistResult,
} from './base'
import { normalizeName } from '@/lib/normalization'
import { db } from '@/lib/db'

const OPENCORPORATES_BASE = 'https://api.opencorporates.com/v0.4'
const BATCH_LIMIT_MAX = 50
const LOOKBACK_DAYS = 90

// Demo fixture — used when OPENCORPORATES_API_KEY is absent
const DEMO_RECORDS = [
  {
    id: 'DEMO-BR-001',
    name: 'Alpha Electric Group Inc',
    companyNumber: 'K234567',
    status: 'Active',
    city: 'Duluth',
    county: 'Gwinnett',
    state: 'GA',
    incorporatedAt: '2010-03-15',
    openCorporatesUrl: 'https://opencorporates.com/companies/us_ga/K234567',
  },
  {
    id: 'DEMO-BR-002',
    name: 'Premier Power Solutions LLC',
    companyNumber: 'L890123',
    status: 'Active',
    city: 'Gainesville',
    county: 'Hall',
    state: 'GA',
    incorporatedAt: '2015-07-22',
    openCorporatesUrl: 'https://opencorporates.com/companies/us_ga/L890123',
  },
  {
    id: 'DEMO-BR-003',
    name: 'Northeast Georgia Industrial Services',
    companyNumber: 'M345678',
    status: 'Active',
    city: 'Gainesville',
    county: 'Hall',
    state: 'GA',
    incorporatedAt: '2012-11-08',
    openCorporatesUrl: 'https://opencorporates.com/companies/us_ga/M345678',
  },
]

interface OpenCorporatesCompany {
  company: {
    company_number: string
    name: string
    jurisdiction_code: string
    current_status: string
    incorporation_date?: string
    registered_address?: {
      city?: string
      state?: string
    }
    opencorporates_url: string
  }
}

export class BusinessRegistryAdapter implements SourceAdapter {
  // Internal adapter key — backward-compat with ADAPTERS registry in runner.ts
  sourceType = 'LICENSE'
  isDemoMode: boolean
  demoReason: string | undefined

  private apiKey: string | undefined

  constructor() {
    this.apiKey = process.env.OPENCORPORATES_API_KEY || undefined
    this.isDemoMode = !this.apiKey
    // derived from current adapter initialization state
    this.demoReason = !this.apiKey ? 'OPENCORPORATES_API_KEY not set' : undefined
  }

  /**
   * Discover companies in the DB that lack a recent BUSINESS_REGISTRY signal.
   * This adapter selects internal candidates, not external records.
   */
  async discover(params?: { batchLimit?: number }): Promise<DiscoverResult[]> {
    if (this.isDemoMode) {
      return DEMO_RECORDS.map((r) => ({
        sourceId: r.id,
        name: r.name,
        metadata: { ...r },
      }))
    }

    const batchLimit = Math.min(params?.batchLimit ?? BATCH_LIMIT_MAX, BATCH_LIMIT_MAX)
    const lookbackDate = new Date()
    lookbackDate.setDate(lookbackDate.getDate() - LOOKBACK_DAYS)

    const companies = await db.company.findMany({
      where: {
        NOT: {
          signals: {
            some: {
              signalType: 'BUSINESS_REGISTRY',
              createdAt: { gte: lookbackDate },
            },
          },
        },
      },
      select: { id: true, name: true, normalizedName: true, city: true, state: true },
      take: batchLimit,
      orderBy: { leadScore: 'desc' },
    })

    return companies.map((c) => ({
      sourceId: c.id,
      name: c.name,
      metadata: { normalizedName: c.normalizedName, city: c.city, state: c.state },
    }))
  }

  /**
   * Fetch OpenCorporates details for a company.
   *
   * Confident attach requires: active status + strong name match + city match.
   * City absent or weakly formatted → skip (return null).
   * Multiple similarly plausible candidates → skip (return null).
   * API error / timeout → null (skipped, not a job failure).
   */
  async fetchDetails(companyId: string): Promise<DetailResult | null> {
    if (this.isDemoMode) {
      const demo = DEMO_RECORDS.find((r) => r.id === companyId)
      if (!demo) return null
      return { sourceId: companyId, rawData: { ...demo, isDemoMode: true } }
    }

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, normalizedName: true, city: true, state: true },
    })
    if (!company) return null

    const encodedName = encodeURIComponent(company.name)
    const url = `${OPENCORPORATES_BASE}/companies/search?q=${encodedName}&jurisdiction_code=us_ga&api_token=${this.apiKey}`

    const timeout = parseInt(process.env.ENRICHMENT_TIMEOUT_MS ?? '10000', 10)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    try {
      const resp = await fetch(url, { signal: controller.signal })
      clearTimeout(timer)

      if (resp.status === 429) {
        const msg =
          'OpenCorporates rate limit hit (429) — reduce BATCH_LIMIT or add request delay'
        console.error('[business-registry]', msg)
        throw new Error(msg)
      }
      if (!resp.ok) return null

      const json = await resp.json()
      const companies: OpenCorporatesCompany[] = json?.results?.companies ?? []

      // Find candidates: active status + strong name match
      const companyNorm = normalizeName(company.name)
      const strongCandidates = companies.filter((c) => {
        if (c.company.current_status?.toLowerCase() !== 'active') return false
        const ocNorm = normalizeName(c.company.name)
        return ocNorm === companyNorm || ocNorm.startsWith(companyNorm) || companyNorm.startsWith(ocNorm)
      })

      if (strongCandidates.length === 0) return null

      // Require city match as corroborator — city absent → skip
      const companyCity = company.city?.toLowerCase().trim()
      if (!companyCity) return null // can't corroborate without city on our side

      const cityMatched = strongCandidates.filter((c) => {
        const ocCity = c.company.registered_address?.city?.toLowerCase().trim()
        return ocCity && ocCity === companyCity
      })

      if (cityMatched.length === 0) return null // no city corroboration → skip

      // Multiple plausible matches with same city → ambiguous, skip
      if (cityMatched.length > 1) return null

      const matched = cityMatched[0].company
      return {
        sourceId: companyId,
        rawData: {
          companyId,
          companyName: company.name,
          companyNumber: matched.company_number,
          status: matched.current_status,
          incorporatedAt: matched.incorporation_date,
          city: matched.registered_address?.city,
          state: matched.registered_address?.state,
          openCorporatesUrl: matched.opencorporates_url,
        },
      }
    } catch {
      clearTimeout(timer)
      return null
    }
  }

  normalize(raw: DetailResult): NormalizedRecord {
    const data = raw.rawData as Record<string, unknown>
    return {
      // companyId carries the DB company ID through to persist() for exact lookup
      companyId: (data.companyId as string) ?? undefined,
      name: (data.companyName as string) ?? '',
      normalizedName: normalizeName((data.companyName as string) ?? ''),
      city: (data.city as string) ?? undefined,
      state: (data.state as string) ?? 'GA',
      // sourceType matches the internal adapter registry key — not exposed to users
      sourceType: this.sourceType,
      sourceName: 'Business Registry (OpenCorporates/GA SOS)',
      sourceUrl: (data.openCorporatesUrl as string) ?? undefined,
    }
  }

  async persist(records: NormalizedRecord[]): Promise<PersistResult> {
    let updated = 0
    let skipped = 0
    const errors: string[] = []

    for (const record of records) {
      try {
        // Prefer exact company ID lookup (set by fetchDetails for confirmed matches)
        const existing = record.companyId
          ? await db.company.findUnique({ where: { id: record.companyId } })
          : await db.company.findFirst({
              where: {
                normalizedName: record.normalizedName,
                ...(record.city ? { city: { equals: record.city, mode: 'insensitive' } } : {}),
              },
            })

        if (!existing) {
          skipped++
          continue
        }

        await db.signal.create({
          data: {
            companyId: existing.id,
            sourceType: 'LICENSE', // internal SourceType enum value — adapter registry key
            sourceName: 'Business Registry (OpenCorporates/GA SOS)',
            sourceUrl: record.sourceUrl ?? undefined,
            signalType: 'BUSINESS_REGISTRY',
            signalDate: new Date(),
            county: existing.county ?? undefined,
            city: record.city ?? existing.city ?? undefined,
            title: 'Active GA business registration found',
            snippet: `${record.name} registered in GA, status: Active`,
            relevanceScore: 0.6,
            metadata: {
              source: 'opencorporates',
              liveMode: !this.isDemoMode,
            },
          },
        })

        // Update sourceConfidence to 0.5 (medium — name + city corroborated)
        // Adapter-level convention: 0.2 = low confidence, 0.5 = medium, 0.8 = high
        if ((existing.sourceConfidence ?? 0) < 0.5) {
          await db.company.update({
            where: { id: existing.id },
            data: { sourceConfidence: 0.5 },
          })
        }

        updated++
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }

    return { created: 0, updated, skipped, errors }
  }
}

export const licenseAdapter = new BusinessRegistryAdapter()
