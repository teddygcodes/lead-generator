/**
 * Website enrichment service.
 * Fetches homepage + up to 3 same-domain pages and extracts structured data.
 * v1: HTML fetch only — no JS rendering, no browser automation.
 */

import { parse as parseHtml } from 'node-html-parser'
import { normalizeDomain, normalizePhone } from '@/lib/normalization'
import { classifyText } from './keywords'
import { db } from '@/lib/db'

const TIMEOUT_MS = parseInt(process.env.ENRICHMENT_TIMEOUT_MS ?? '10000')
const MAX_PAGES = parseInt(process.env.ENRICHMENT_MAX_PAGES ?? '4')

export interface EnrichmentPayload {
  url: string
  title: string
  description: string
  extractedText: string
  emails: string[]
  phones: string[]
  addresses: string[]
  serviceKeywords: string[]
  pagesScraped: string[]
}

export interface EnrichmentResult {
  success: boolean
  payload?: EnrichmentPayload
  error?: string
}

const SUBPAGE_PATHS = ['/about', '/services', '/contact', '/about-us', '/our-services', '/what-we-do']

// Per-domain robots.txt disallow cache.
// null = robots.txt unreachable; v1 policy: treat as no restrictions and proceed with crawl.
// To tighten in a future version: on unreachable robots.txt, skip crawl rather than allow.
// Cache is process-local — avoids repeated fetches in a run, not persistent across restarts.
const robotsCache = new Map<string, string[] | null>()

/**
 * Fetch and parse Disallow paths for User-agent: * from robots.txt.
 * v1 lightweight robots respect: reads User-agent: * and Disallow: lines only.
 * Does not handle Allow:, wildcard patterns, crawl-delay, multiple wildcard blocks,
 * or inline comments — first-pass basic structure only.
 * Returns null if robots.txt is unreachable (v1 policy: allow crawl; see cache comment).
 * Not exported — mock at the fetch/fetchPage level in tests rather than this function.
 */
async function fetchRobots(domain: string, siteOrigin: string): Promise<string[] | null> {
  if (robotsCache.has(domain)) return robotsCache.get(domain)!
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(`${siteOrigin}/robots.txt`, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) { robotsCache.set(domain, null); return null }
    const disallowed = parseRobotsDisallowedPaths(await res.text())
    robotsCache.set(domain, disallowed)
    return disallowed
  } catch {
    robotsCache.set(domain, null)
    return null
  }
}

/**
 * Parse Disallow paths for User-agent: * block only. Exported for unit testing.
 * v1: inline comments not stripped; multiple wildcard sections not merged robustly;
 * only basic `User-agent: *` + `Disallow:` structure is supported.
 * `Disallow: /` blocks all paths (correct by prefix logic).
 */
export function parseRobotsDisallowedPaths(text: string): string[] {
  const disallowed: string[] = []
  let inWildcardBlock = false
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.toLowerCase().startsWith('user-agent:')) {
      inWildcardBlock = trimmed.slice('user-agent:'.length).trim() === '*'
    } else if (inWildcardBlock && trimmed.toLowerCase().startsWith('disallow:')) {
      const path = trimmed.slice('disallow:'.length).trim()
      if (path) disallowed.push(path)
    }
  }
  return disallowed
}

/**
 * Returns true if robots.txt disallows the given path (prefix match, v1).
 * null disallowed list = unreachable robots.txt = allow (v1 policy). Exported for unit testing.
 */
export function isRobotsBlocked(path: string, disallowed: string[] | null): boolean {
  if (!disallowed) return false
  return disallowed.some((d) => d.length > 0 && path.startsWith(d))
}

// SSRF protection: block private/local hostnames before any outbound fetch.
// Normalized to lowercase; also blocks IPv6 localhost (::1).
const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/

/**
 * Fetch a URL with timeout. Returns null on failure or if the URL resolves to a
 * private/local host (SSRF protection).
 */
async function fetchPage(url: string): Promise<string | null> {
  // SSRF guard — reject private and local addresses before fetching
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  if (hostname === '::1' || PRIVATE_HOST_RE.test(hostname)) return null

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ElectricalLeadsBot/1.0)',
      },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return null
    return await res.text()
  } catch {
    return null
  }
}

/**
 * Extract useful data from HTML.
 */
function extractFromHtml(html: string): Partial<EnrichmentPayload> {
  const root = parseHtml(html)

  // Title
  const title = root.querySelector('title')?.text?.trim() ?? ''

  // Meta description
  const metaDesc =
    root.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ??
    root.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ??
    ''

  // Extract all visible text (remove scripts, styles, nav, footer noise)
  ;['script', 'style', 'noscript', 'header', 'footer', 'nav'].forEach((tag) => {
    root.querySelectorAll(tag).forEach((el) => el.remove())
  })
  const rawText = root.text.replace(/\s+/g, ' ').trim().slice(0, 5000)

  // Email extraction
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
  const allText = root.toString() + ' ' + rawText
  const emails = [
    ...new Set(
      (allText.match(emailRegex) ?? []).filter(
        (e) => !e.includes('example') && !e.includes('yourname'),
      ),
    ),
  ].slice(0, 5)

  // Phone extraction (US format)
  const phoneRegex = /(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g
  const phones = [...new Set((allText.match(phoneRegex) ?? []).map((p) => p.trim()))].slice(0, 3)

  // Address extraction (simple heuristic)
  const addressRegex = /\d{1,5}\s+[A-Za-z\s]+(?:street|st|avenue|ave|road|rd|drive|dr|blvd|boulevard|lane|ln|way|court|ct|circle|cir|parkway|pkwy)[.,]?\s*(?:[A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5})?/gi
  const addresses = [...new Set((rawText.match(addressRegex) ?? []).map((a) => a.trim()))].slice(0, 3)

  return {
    title,
    description: metaDesc,
    extractedText: rawText,
    emails,
    phones: phones.map(normalizePhone).filter(Boolean),
    addresses,
    serviceKeywords: [], // populated by caller
  }
}

/**
 * Crawl a company website and extract enrichment data.
 * Respects same-domain constraint, max pages, and robots.txt (User-agent: * + Disallow: only).
 */
export async function enrichFromWebsite(websiteUrl: string): Promise<EnrichmentResult> {
  const normalizedUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
  const domain = normalizeDomain(normalizedUrl)
  if (!domain) {
    return { success: false, error: 'Invalid URL — could not parse domain' }
  }

  const siteOrigin = (() => { try { const u = new URL(normalizedUrl); return `${u.protocol}//${u.host}` } catch { return `https://${domain}` } })()
  const disallowedPaths = await fetchRobots(domain, siteOrigin)
  const homepagePath = (() => { try { return new URL(normalizedUrl).pathname || '/' } catch { return '/' } })()
  if (isRobotsBlocked(homepagePath, disallowedPaths)) {
    return { success: false, error: `robots.txt disallows crawling ${domain}` }
  }

  const pagesScraped: string[] = []
  let allText = ''
  let title = ''
  let description = ''
  const allEmails: string[] = []
  const allPhones: string[] = []
  const allAddresses: string[] = []

  // Fetch homepage first
  const homepageHtml = await fetchPage(normalizedUrl)
  if (!homepageHtml) {
    return {
      success: false,
      error: `Could not fetch homepage for ${normalizedUrl} (blocked, timeout, or not HTML)`,
    }
  }

  pagesScraped.push(normalizedUrl)
  const homeData = extractFromHtml(homepageHtml)
  title = homeData.title ?? ''
  description = homeData.description ?? ''
  allText += ' ' + (homeData.extractedText ?? '')
  allEmails.push(...(homeData.emails ?? []))
  allPhones.push(...(homeData.phones ?? []))
  allAddresses.push(...(homeData.addresses ?? []))

  // Try up to 3 subpages (same domain only)
  let additionalPages = 0
  for (const path of SUBPAGE_PATHS) {
    if (additionalPages >= MAX_PAGES - 1) break
    const subUrl = `https://${domain}${path}`
    // Don't refetch if already scraped; skip if robots.txt disallows this path
    if (pagesScraped.includes(subUrl)) continue
    if (isRobotsBlocked(path, disallowedPaths)) continue
    const html = await fetchPage(subUrl)
    if (!html) continue
    pagesScraped.push(subUrl)
    additionalPages++
    const data = extractFromHtml(html)
    allText += ' ' + (data.extractedText ?? '')
    allEmails.push(...(data.emails ?? []))
    allPhones.push(...(data.phones ?? []))
    allAddresses.push(...(data.addresses ?? []))
  }

  // Classify the combined text
  const classification = classifyText(allText)

  const payload: EnrichmentPayload = {
    url: normalizedUrl,
    title,
    description,
    extractedText: allText.slice(0, 8000),
    emails: [...new Set(allEmails)].slice(0, 5),
    phones: [...new Set(allPhones)].slice(0, 3),
    addresses: [...new Set(allAddresses)].slice(0, 3),
    serviceKeywords: classification.matchedSpecialties,
    pagesScraped,
  }

  return { success: true, payload }
}

/**
 * Run enrichment for a company and persist results + CrawlJob record.
 */
export async function enrichCompany(
  companyId: string,
  websiteUrl: string,
): Promise<{ success: boolean; error?: string }> {
  // Check for concurrent run (simple lock via CrawlJob status)
  const activeJob = await db.crawlJob.findFirst({
    where: {
      status: 'RUNNING',
      metadata: {
        path: ['companyId'],
        equals: companyId,
      },
    },
  })
  if (activeJob) {
    return { success: false, error: 'Enrichment already in progress for this company' }
  }

  // Create CrawlJob
  const job = await db.crawlJob.create({
    data: {
      sourceType: 'COMPANY_WEBSITE',
      status: 'RUNNING',
      startedAt: new Date(),
      metadata: { companyId, url: websiteUrl, liveMode: true },
    },
  })

  try {
    const result = await enrichFromWebsite(websiteUrl)

    if (!result.success || !result.payload) {
      await db.crawlJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorMessage: result.error ?? 'Unknown enrichment error',
        },
      })
      return { success: false, error: result.error }
    }

    const { payload } = result
    const classification = classifyText(payload.extractedText)

    // Update company + create signal atomically.
    // If signal creation fails, the company update is rolled back — no orphaned enrichment state.
    // CrawlJob lifecycle updates stay outside this transaction.
    await db.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: companyId },
        data: {
          lastEnrichedAt: new Date(),
          lastSeenAt: new Date(),
          description: payload.description || undefined,
          email: payload.emails[0] || undefined,
          phone: payload.phones[0] || undefined,
          segments:
            classification.segments.length > 0 ? classification.segments : undefined,
          specialties:
            classification.matchedSpecialties.length > 0
              ? classification.matchedSpecialties
              : undefined,
        },
      })

      await tx.signal.create({
        data: {
          companyId,
          sourceType: 'COMPANY_WEBSITE',
          sourceName: 'Website Enrichment',
          sourceUrl: websiteUrl,
          title: payload.title || 'Website content extracted',
          snippet: payload.description?.slice(0, 500) || payload.extractedText.slice(0, 500),
          rawText: payload.extractedText.slice(0, 5000),
          signalType: 'WEBSITE_CONTENT',
          signalDate: new Date(),
          relevanceScore: classification.confidence,
        },
      })
    })

    await db.crawlJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
        recordsFound: payload.pagesScraped.length,
        recordsUpdated: 1,
        // metadata intentionally absent — set once at creation, never overwritten
      },
    })

    return { success: true }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db.crawlJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorMessage,
      },
    })
    return { success: false, error: errorMessage }
  }
}
