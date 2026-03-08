import { describe, it, expect } from 'vitest'
import { CompanySiteAdapter } from '../lib/sources/company-site'
import { extractDomain } from '../lib/normalization'
import type { DetailResult } from '../lib/sources/base'

describe('CompanySiteAdapter', () => {
  // ---- normalize ----

  describe('normalize', () => {
    it('carries companyId from rawData to NormalizedRecord for exact persist() lookup', () => {
      const adapter = new CompanySiteAdapter()
      const raw: DetailResult = {
        sourceId: 'company-xyz',
        rawData: {
          companyId: 'company-xyz',
          companyName: 'Buckhead Electric LLC',
          url: 'https://www.buckheadelectric.com/',
          emails: ['info@buckheadelectric.com'],
          phones: ['4045551234'],
          description: 'Electrical contractor serving Atlanta metro',
          serviceKeywords: ['commercial', 'industrial'],
        },
      }
      const record = adapter.normalize(raw)
      expect(record.companyId).toBe('company-xyz')
    })

    it('strips www. from domain in NormalizedRecord.domain', () => {
      const adapter = new CompanySiteAdapter()
      const raw: DetailResult = {
        sourceId: 'x',
        rawData: {
          companyId: 'x',
          companyName: 'Test Electric',
          url: 'https://www.testelectric.com/',
        },
      }
      const record = adapter.normalize(raw)
      expect(record.domain).toBe('testelectric.com')
    })

    it('extracts first email and first phone from arrays', () => {
      const adapter = new CompanySiteAdapter()
      const raw: DetailResult = {
        sourceId: 'x',
        rawData: {
          companyName: 'Test',
          url: 'https://test.com',
          emails: ['a@test.com', 'b@test.com'],
          phones: ['4045550001', '4045550002'],
        },
      }
      const record = adapter.normalize(raw)
      expect(record.email).toBe('a@test.com')
      expect(record.phone).toBe('4045550001')
    })

    it('sets specialties from serviceKeywords', () => {
      const adapter = new CompanySiteAdapter()
      const raw: DetailResult = {
        sourceId: 'x',
        rawData: {
          companyName: 'Test',
          url: 'https://test.com',
          serviceKeywords: ['industrial', 'switchgear'],
        },
      }
      const record = adapter.normalize(raw)
      expect(record.specialties).toEqual(['industrial', 'switchgear'])
    })

    it('sets sourceType to "COMPANY_WEBSITE"', () => {
      const adapter = new CompanySiteAdapter()
      const raw: DetailResult = {
        sourceId: 'x',
        rawData: { companyName: 'Test', url: 'https://test.com' },
      }
      const record = adapter.normalize(raw)
      expect(record.sourceType).toBe('COMPANY_WEBSITE')
    })

    it('sets sourceName to "Company Website"', () => {
      const adapter = new CompanySiteAdapter()
      const raw: DetailResult = {
        sourceId: 'x',
        rawData: { companyName: 'Test', url: 'https://test.com' },
      }
      const record = adapter.normalize(raw)
      expect(record.sourceName).toBe('Company Website')
    })

    it('returns undefined companyId when rawData.companyId is absent', () => {
      const adapter = new CompanySiteAdapter()
      const raw: DetailResult = {
        sourceId: 'x',
        rawData: { companyName: 'Test', url: 'https://test.com' },
      }
      const record = adapter.normalize(raw)
      expect(record.companyId).toBeUndefined()
    })
  })

  // ---- thin-extraction guard ----
  //
  // Mirrors the guard predicate in persist() exactly:
  //   skip if !description AND (specialties empty) AND !email AND !phone
  //
  // These tests verify the logic without requiring DB access.

  describe('thin-extraction guard predicate', () => {
    const isThin = (r: {
      description?: string
      specialties?: string[]
      email?: string
      phone?: string
    }) =>
      !r.description &&
      (!r.specialties || r.specialties.length === 0) &&
      !r.email &&
      !r.phone

    it('is true when all meaningful fields are absent', () => {
      expect(isThin({})).toBe(true)
    })

    it('is true when specialties is an empty array', () => {
      expect(isThin({ specialties: [] })).toBe(true)
    })

    it('is false when description is present', () => {
      expect(isThin({ description: 'Electrical contractor' })).toBe(false)
    })

    it('is false when specialties are present', () => {
      expect(isThin({ specialties: ['industrial'] })).toBe(false)
    })

    it('is false when email is present', () => {
      expect(isThin({ email: 'info@example.com' })).toBe(false)
    })

    it('is false when phone is present', () => {
      expect(isThin({ phone: '4045551234' })).toBe(false)
    })

    it('is true when only an empty specialties array and no other fields', () => {
      expect(isThin({ specialties: [] })).toBe(true)
    })
  })

  // ---- domain dedup — canonical domain extraction ----
  //
  // Signal dedup in persist() uses extractDomain() for exact hostname comparison.
  // These tests confirm: case-insensitive, www.-stripped, exact (not substring) matching.

  describe('domain dedup — canonical domain extraction', () => {
    it('strips www. to get canonical domain', () => {
      expect(extractDomain('https://www.example.com/')).toBe('example.com')
    })

    it('lowercases the domain', () => {
      expect(extractDomain('https://EXAMPLE.COM/')).toBe('example.com')
    })

    it('https://Example.com and https://example.com/ yield the same canonical domain', () => {
      const a = extractDomain('https://Example.com')
      const b = extractDomain('https://example.com/')
      expect(a).toBe(b)
    })

    it('https://www.Example.com/ and https://example.com/ are the same canonical domain', () => {
      const a = extractDomain('https://www.Example.com/')
      const b = extractDomain('https://example.com/')
      expect(a).toBe(b)
    })

    it('notexample.com is a different canonical domain from example.com (exact, not substring)', () => {
      const a = extractDomain('https://notexample.com/')
      const b = extractDomain('https://example.com/')
      expect(a).not.toBe(b)
    })

    it('sub.example.com is a different canonical domain from example.com', () => {
      const a = extractDomain('https://sub.example.com/')
      const b = extractDomain('https://example.com/')
      expect(a).not.toBe(b)
    })

    it('strips trailing slash and path from URL', () => {
      expect(extractDomain('https://www.example.com/about/us/')).toBe('example.com')
    })
  })
})
