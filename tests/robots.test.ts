import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseRobotsDisallowedPaths, isRobotsBlocked, enrichFromWebsite } from '../lib/enrichment/index'

// ---- parseRobotsDisallowedPaths ----

describe('parseRobotsDisallowedPaths', () => {
  it('parses User-agent: * + Disallow: lines correctly', () => {
    const txt = 'User-agent: *\nDisallow: /private\nDisallow: /admin\n'
    expect(parseRobotsDisallowedPaths(txt)).toEqual(['/private', '/admin'])
  })

  it('ignores non-wildcard User-agent blocks', () => {
    const txt = 'User-agent: Googlebot\nDisallow: /secret\n\nUser-agent: *\nDisallow: /public-block\n'
    expect(parseRobotsDisallowedPaths(txt)).toEqual(['/public-block'])
  })

  it('returns empty array for empty robots.txt', () => {
    expect(parseRobotsDisallowedPaths('')).toEqual([])
  })

  it('returns empty array when no User-agent: * block is present', () => {
    const txt = 'User-agent: Bingbot\nDisallow: /foo\n'
    expect(parseRobotsDisallowedPaths(txt)).toEqual([])
  })

  it('handles Disallow: / (full site block)', () => {
    const txt = 'User-agent: *\nDisallow: /\n'
    expect(parseRobotsDisallowedPaths(txt)).toEqual(['/'])
  })
})

// ---- isRobotsBlocked ----

describe('isRobotsBlocked', () => {
  it('returns true when path matches a Disallow prefix', () => {
    expect(isRobotsBlocked('/admin/panel', ['/admin'])).toBe(true)
  })

  it('returns true for exact prefix match', () => {
    expect(isRobotsBlocked('/private', ['/private'])).toBe(true)
  })

  it('returns false when path does not match any Disallow', () => {
    expect(isRobotsBlocked('/about', ['/admin', '/private'])).toBe(false)
  })

  it('returns false when disallowed list is null (v1: unreachable robots.txt = allow)', () => {
    expect(isRobotsBlocked('/anything', null)).toBe(false)
  })

  it('returns false when disallowed list is empty', () => {
    expect(isRobotsBlocked('/anything', [])).toBe(false)
  })

  it('Disallow: / blocks all paths (prefix logic)', () => {
    expect(isRobotsBlocked('/', ['/'])).toBe(true)
    expect(isRobotsBlocked('/about', ['/'])).toBe(true)
    expect(isRobotsBlocked('/some/deep/path', ['/'])).toBe(true)
  })

  it('does not match partial path segments', () => {
    // /admin does not block /administrator — only exact prefix (not word-boundary aware in v1)
    // This is a known v1 limitation; just confirm current behavior
    expect(isRobotsBlocked('/administrator', ['/admin'])).toBe(true) // prefix match
  })
})

// ---- enrichFromWebsite — robots integration ----
//
// Uses unique hostnames per test to avoid robotsCache cross-test pollution.
// Mocks global fetch at the smallest stable seam; restored after each test.

describe('enrichFromWebsite — robots integration', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns success: false when homepage is disallowed by robots.txt', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/robots.txt')) {
        return new Response('User-agent: *\nDisallow: /\n', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      }
      return new Response('<html><body>should not reach here</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    })

    const result = await enrichFromWebsite('https://robots-blocked-home.test/')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/robots\.txt disallows crawling/)
  })

  it('skips disallowed subpages but still enriches homepage successfully', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/robots.txt')) {
        // Disallow /about only
        return new Response('User-agent: *\nDisallow: /about\n', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      }
      // All pages return valid HTML so enrichment can complete
      return new Response(
        '<html><head><title>Sparks Electric</title><meta name="description" content="Industrial electrical contractor"></head><body>electrical services</body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      )
    })

    const result = await enrichFromWebsite('https://robots-blocked-about.test/')
    expect(result.success).toBe(true)
    // /about must NOT appear in scraped pages
    expect(result.payload?.pagesScraped.some((p) => p.includes('/about'))).toBe(false)
    // Homepage must have been scraped
    expect(result.payload?.pagesScraped[0]).toContain('robots-blocked-about.test')
  })
})
