import { describe, it, expect } from 'vitest'
import { PermitAdapter } from '../lib/sources/permits'

describe('PermitAdapter', () => {
  // ---- isDemoMode ----

  describe('isDemoMode', () => {
    it('is always true — live schema not confirmed (see step 0 comment in permits.ts)', () => {
      const adapter = new PermitAdapter()
      expect(adapter.isDemoMode).toBe(true)
    })
  })

  // ---- discover ----

  describe('discover', () => {
    it('returns 3 demo fixtures', async () => {
      const adapter = new PermitAdapter()
      const results = await adapter.discover()
      expect(results).toHaveLength(3)
    })

    it('each demo record has a non-empty sourceId and name', async () => {
      const adapter = new PermitAdapter()
      const results = await adapter.discover()
      for (const r of results) {
        expect(r.sourceId).toBeTruthy()
        expect(r.name).toBeTruthy()
      }
    })
  })

  // ---- fetchDetails ----

  describe('fetchDetails', () => {
    it('returns demo fixture for DEMO-P-001', async () => {
      const adapter = new PermitAdapter()
      const result = await adapter.fetchDetails('DEMO-P-001')
      expect(result).not.toBeNull()
      const data = result!.rawData as Record<string, unknown>
      expect(data.contractor).toBe('Gwinnett Industrial Electric LLC')
    })

    it('returns null for an unknown sourceId', async () => {
      const adapter = new PermitAdapter()
      expect(await adapter.fetchDetails('NOT-REAL')).toBeNull()
    })
  })

  // ---- normalize ----

  describe('normalize', () => {
    it('maps Gwinnett fixture to correct NormalizedRecord', async () => {
      const adapter = new PermitAdapter()
      const details = await adapter.fetchDetails('DEMO-P-001')
      expect(details).not.toBeNull()
      const record = adapter.normalize(details!)

      expect(record.name).toBe('Gwinnett Industrial Electric LLC')
      expect(record.normalizedName).toBe('gwinnett industrial electric')
      expect(record.city).toBe('Duluth')
      expect(record.county).toBe('Gwinnett')
      expect(record.state).toBe('GA')
      expect(record.sourceType).toBe('PERMIT')
      expect(record.sourceName).toBe('Permit Records (Demo)')
    })

    it('maps Hall county fixture correctly', async () => {
      const adapter = new PermitAdapter()
      const details = await adapter.fetchDetails('DEMO-P-003')
      expect(details).not.toBeNull()
      const record = adapter.normalize(details!)

      expect(record.county).toBe('Hall')
      expect(record.city).toBe('Gainesville')
    })

    it('normalizes company name by stripping Inc suffix', async () => {
      const adapter = new PermitAdapter()
      const details = await adapter.fetchDetails('DEMO-P-002')
      expect(details).not.toBeNull()
      const record = adapter.normalize(details!)
      // "Alpha Electric Group Inc" → "alpha electric group"
      expect(record.normalizedName).toBe('alpha electric group')
    })

    it('sourceUrl is undefined for demo permits (no live source)', async () => {
      const adapter = new PermitAdapter()
      const details = await adapter.fetchDetails('DEMO-P-001')
      const record = adapter.normalize(details!)
      expect(record.sourceUrl).toBeUndefined()
    })
  })
})
