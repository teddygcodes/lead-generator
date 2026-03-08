import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BusinessRegistryAdapter } from '../lib/sources/business-registry'
import type { DetailResult } from '../lib/sources/base'

describe('BusinessRegistryAdapter', () => {
  // Ensure demo mode by removing any API key in the test environment.
  // Pure-unit tests only — no DB calls are made in these code paths.
  let savedApiKey: string | undefined

  beforeAll(() => {
    savedApiKey = process.env.OPENCORPORATES_API_KEY
    delete process.env.OPENCORPORATES_API_KEY
  })

  afterAll(() => {
    if (savedApiKey !== undefined) {
      process.env.OPENCORPORATES_API_KEY = savedApiKey
    }
  })

  // ---- isDemoMode ----

  describe('isDemoMode', () => {
    it('is true when OPENCORPORATES_API_KEY is absent', () => {
      const adapter = new BusinessRegistryAdapter()
      expect(adapter.isDemoMode).toBe(true)
    })
  })

  // ---- discover (demo mode) ----

  describe('discover in demo mode', () => {
    it('returns the 3 demo fixtures', async () => {
      const adapter = new BusinessRegistryAdapter()
      const results = await adapter.discover()
      expect(results).toHaveLength(3)
    })

    it('each demo record has a non-empty sourceId and name', async () => {
      const adapter = new BusinessRegistryAdapter()
      const results = await adapter.discover()
      for (const r of results) {
        expect(r.sourceId).toBeTruthy()
        expect(r.name).toBeTruthy()
      }
    })
  })

  // ---- fetchDetails (demo mode) ----

  describe('fetchDetails in demo mode', () => {
    it('returns demo data for DEMO-BR-001 with isDemoMode flag', async () => {
      const adapter = new BusinessRegistryAdapter()
      const result = await adapter.fetchDetails('DEMO-BR-001')
      expect(result).not.toBeNull()
      expect(result!.rawData.isDemoMode).toBe(true)
      expect(result!.rawData.name).toBe('Alpha Electric Group Inc')
    })

    it('returns null for an unknown sourceId', async () => {
      const adapter = new BusinessRegistryAdapter()
      expect(await adapter.fetchDetails('NOT-A-REAL-ID')).toBeNull()
    })
  })

  // ---- normalize ----

  describe('normalize', () => {
    const mockRaw: DetailResult = {
      sourceId: 'company-abc',
      rawData: {
        companyId: 'company-abc',
        companyName: 'Premier Power Solutions LLC',
        companyNumber: 'L890123',
        status: 'Active',
        incorporatedAt: '2015-07-22',
        city: 'Gainesville',
        state: 'GA',
        openCorporatesUrl: 'https://opencorporates.com/companies/us_ga/L890123',
      },
    }

    it('carries companyId to NormalizedRecord for exact persist() lookup', () => {
      const adapter = new BusinessRegistryAdapter()
      const record = adapter.normalize(mockRaw)
      expect(record.companyId).toBe('company-abc')
    })

    it('sets sourceType to "LICENSE" (internal adapter registry key)', () => {
      // "LICENSE" is the backward-compat ADAPTERS key. It must never appear in
      // product-facing UI or API responses — only here in the adapter layer.
      const adapter = new BusinessRegistryAdapter()
      const record = adapter.normalize(mockRaw)
      expect(record.sourceType).toBe('LICENSE')
    })

    it('sets sourceName to Business Registry product label', () => {
      const adapter = new BusinessRegistryAdapter()
      const record = adapter.normalize(mockRaw)
      expect(record.sourceName).toBe('Business Registry (OpenCorporates/GA SOS)')
    })

    it('normalizes company name by stripping legal suffix', () => {
      const adapter = new BusinessRegistryAdapter()
      const record = adapter.normalize(mockRaw)
      expect(record.normalizedName).toBe('premier power solutions')
    })

    it('maps city, state, and sourceUrl correctly', () => {
      const adapter = new BusinessRegistryAdapter()
      const record = adapter.normalize(mockRaw)
      expect(record.city).toBe('Gainesville')
      expect(record.state).toBe('GA')
      expect(record.sourceUrl).toBe('https://opencorporates.com/companies/us_ga/L890123')
    })

    it('defaults state to "GA" when rawData has no state field', () => {
      const adapter = new BusinessRegistryAdapter()
      const raw: DetailResult = {
        sourceId: 'x',
        rawData: { companyId: 'x', companyName: 'No State Co' },
      }
      const record = adapter.normalize(raw)
      expect(record.state).toBe('GA')
    })

    it('returns undefined companyId when rawData.companyId is absent', () => {
      // Fallback for any path that doesn't carry an ID (should be rare in live mode)
      const adapter = new BusinessRegistryAdapter()
      const raw: DetailResult = {
        sourceId: 'y',
        rawData: { companyName: 'No ID Co', city: 'Atlanta' },
      }
      const record = adapter.normalize(raw)
      expect(record.companyId).toBeUndefined()
    })

    it('name + city match → multiple plausible candidates → normalize still works (pure function)', () => {
      // Matching/skip logic lives in fetchDetails; normalize is always a pure transformation
      const adapter = new BusinessRegistryAdapter()
      const raw: DetailResult = {
        sourceId: 'z',
        rawData: {
          companyId: 'z',
          companyName: 'Northeast Georgia Industrial Services',
          city: 'Gainesville',
          state: 'GA',
          openCorporatesUrl: 'https://opencorporates.com/companies/us_ga/M345678',
        },
      }
      const record = adapter.normalize(raw)
      expect(record.name).toBe('Northeast Georgia Industrial Services')
      expect(record.normalizedName).toBe('northeast georgia industrial services')
    })
  })
})
