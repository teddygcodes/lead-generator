import { describe, it, expect } from 'vitest'
import { mergeCompanyData } from '../lib/dedupe'

// findExistingCompany requires a DB connection; test mergeCompanyData unit only.
// Integration tests for deduplication with real DB are covered in tests/api.test.ts.

describe('mergeCompanyData', () => {
  it('fills empty existing fields with incoming values', () => {
    const existing: Record<string, unknown> = { name: 'Acme Electric', website: null, phone: '' }
    const incoming: Record<string, unknown> = { name: 'Acme Electric', website: 'https://acme.com', phone: '7706221100' }
    const result = mergeCompanyData(existing, incoming)
    expect(result.website).toBe('https://acme.com')
    expect(result.phone).toBe('7706221100')
  })

  it('does NOT overwrite non-empty existing fields with empty incoming values', () => {
    const existing: Record<string, unknown> = { name: 'Acme Electric', website: 'https://acme.com', phone: '7706221100' }
    const incoming: Record<string, unknown> = { name: 'Acme Electric', website: '', phone: null }
    const result = mergeCompanyData(existing, incoming)
    expect(result.website).toBe('https://acme.com')
    expect(result.phone).toBe('7706221100')
  })

  it('does NOT overwrite non-empty existing fields with non-empty incoming values', () => {
    const existing: Record<string, unknown> = { website: 'https://original.com' }
    const incoming: Record<string, unknown> = { website: 'https://new.com' }
    const result = mergeCompanyData(existing, incoming)
    // existing was non-empty, so should remain unchanged
    expect(result.website).toBe('https://original.com')
  })

  it('preserves existing array fields if non-empty', () => {
    const existing: Record<string, unknown> = { segments: ['industrial', 'commercial'] }
    const incoming: Record<string, unknown> = { segments: [] }
    const result = mergeCompanyData(existing, incoming)
    expect(result.segments).toEqual(['industrial', 'commercial'])
  })

  it('fills empty existing array with incoming array', () => {
    const existing: Record<string, unknown> = { segments: [] }
    const incoming: Record<string, unknown> = { segments: ['industrial'] }
    const result = mergeCompanyData(existing, incoming)
    expect(result.segments).toEqual(['industrial'])
  })

  it('handles all empty incoming and all non-empty existing', () => {
    const existing: Record<string, unknown> = { name: 'Acme', email: 'acme@example.com', phone: '7706221100' }
    const incoming: Record<string, unknown> = { name: '', email: null, phone: undefined }
    const result = mergeCompanyData(existing, incoming)
    expect(result.name).toBe('Acme')
    expect(result.email).toBe('acme@example.com')
    expect(result.phone).toBe('7706221100')
  })

  it('returns a new object and does not mutate existing', () => {
    const existing: Record<string, unknown> = { name: 'Acme', website: null }
    const incoming: Record<string, unknown> = { name: 'Acme', website: 'https://acme.com' }
    const result = mergeCompanyData(existing, incoming)
    expect(result).not.toBe(existing)
    expect(existing.website).toBeNull()
  })
})
