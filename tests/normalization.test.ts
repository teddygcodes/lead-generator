import { describe, it, expect } from 'vitest'
import {
  normalizeName,
  normalizeDomain,
  normalizePhone,
  normalizeAddress,
  extractDomain,
} from '../lib/normalization'

describe('normalizeName', () => {
  it('strips common legal suffixes', () => {
    expect(normalizeName('Acme Electric LLC')).toBe('acme electric')
    expect(normalizeName('Piedmont Power Inc.')).toBe('piedmont power')
    expect(normalizeName('Atlanta Wiring Corp')).toBe('atlanta wiring')
    expect(normalizeName('South Electric Company')).toBe('south electric')
    expect(normalizeName('Hall Electrical Ltd')).toBe('hall electrical')
  })

  it('lowercases and trims', () => {
    expect(normalizeName('  North Georgia Electric  ')).toBe('north georgia electric')
    expect(normalizeName('BUCKHEAD ELECTRICAL')).toBe('buckhead electrical')
  })

  it('handles name with no suffix', () => {
    expect(normalizeName('Gainesville Power')).toBe('gainesville power')
  })

  it('handles empty string', () => {
    expect(normalizeName('')).toBe('')
  })

  it('handles multiple spaces', () => {
    expect(normalizeName('Metro   Atlanta   Electric')).toBe('metro atlanta electric')
  })
})

describe('normalizeDomain', () => {
  it('strips https:// prefix', () => {
    expect(normalizeDomain('https://example.com')).toBe('example.com')
  })

  it('strips http:// prefix', () => {
    expect(normalizeDomain('http://example.com')).toBe('example.com')
  })

  it('strips www.', () => {
    expect(normalizeDomain('www.example.com')).toBe('example.com')
  })

  it('strips https://www.', () => {
    expect(normalizeDomain('https://www.example.com')).toBe('example.com')
  })

  it('strips trailing slash', () => {
    expect(normalizeDomain('https://example.com/')).toBe('example.com')
  })

  it('strips path', () => {
    expect(normalizeDomain('https://example.com/about')).toBe('example.com')
  })

  it('returns empty string for empty input', () => {
    expect(normalizeDomain('')).toBe('')
  })

  it('lowercases', () => {
    expect(normalizeDomain('EXAMPLE.COM')).toBe('example.com')
  })
})

describe('normalizePhone', () => {
  it('extracts 10 digits from formatted number', () => {
    expect(normalizePhone('(770) 622-1100')).toBe('7706221100')
  })

  it('strips dashes', () => {
    expect(normalizePhone('770-622-1100')).toBe('7706221100')
  })

  it('strips +1 country code', () => {
    expect(normalizePhone('+17706221100')).toBe('7706221100')
  })

  it('returns 10-digit string as-is', () => {
    expect(normalizePhone('7706221100')).toBe('7706221100')
  })

  it('returns empty string for non-phone input', () => {
    expect(normalizePhone('')).toBe('')
    expect(normalizePhone('N/A')).toBe('')
  })

  it('handles spaces', () => {
    expect(normalizePhone('770 622 1100')).toBe('7706221100')
  })
})

describe('normalizeAddress', () => {
  it('trims whitespace', () => {
    expect(normalizeAddress('  4250 Industrial Blvd  ')).toBe('4250 Industrial Blvd')
  })

  it('handles empty string', () => {
    expect(normalizeAddress('')).toBe('')
  })

  it('handles null/undefined', () => {
    expect(normalizeAddress(null as unknown as string)).toBe('')
    expect(normalizeAddress(undefined as unknown as string)).toBe('')
  })
})

describe('extractDomain', () => {
  it('extracts domain from full URL', () => {
    expect(extractDomain('https://www.example.com/page')).toBe('example.com')
  })

  it('handles URL without www', () => {
    expect(extractDomain('https://example.com')).toBe('example.com')
  })

  it('returns empty string for empty input', () => {
    expect(extractDomain('')).toBe('')
    expect(extractDomain(null as unknown as string)).toBe('')
  })

  it('handles bare hostname without protocol', () => {
    expect(extractDomain('example.com')).toBe('example.com')
  })
})
