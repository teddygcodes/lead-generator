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

/**
 * Fetch a URL with timeout. Returns null on failure.
 */
async function fetchPage(url: string): Promise<string | null> {
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
 * Respects same-domain constraint and max pages.
 * NOTE: This tool does not enforce robots.txt in v1. See TODO in README.
 */
export async function enrichFromWebsite(websiteUrl: string): Promise<EnrichmentResult> {
  const normalizedUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
  const domain = normalizeDomain(normalizedUrl)
  if (!domain) {
    return { success: false, error: 'Invalid URL — could not parse domain' }
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
    // Don't refetch if already scraped
    if (pagesScraped.includes(subUrl)) continue
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
      metadata: { companyId, url: websiteUrl },
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

    // Update company with enrichment data
    await db.company.update({
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

    // Store a signal for this enrichment
    await db.signal.create({
      data: {
        companyId,
        sourceType: 'COMPANY_WEBSITE',
        sourceName: 'Website Enrichment',
        sourceUrl: websiteUrl,
        title: payload.title || 'Website content extracted',
        snippet: payload.description?.slice(0, 500) || payload.extractedText.slice(0, 500),
        rawText: payload.extractedText.slice(0, 2000),
        signalType: 'WEBSITE_CONTENT',
        signalDate: new Date(),
        relevanceScore: classification.confidence,
      },
    })

    await db.crawlJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
        recordsFound: payload.pagesScraped.length,
        recordsUpdated: 1,
        metadata: {
          companyId,
          url: websiteUrl,
          pagesScraped: payload.pagesScraped,
        },
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
