/**
 * Cherokee County HTML permit adapter.
 *
 * Fetches electrical permit applications from Cherokee County's public permit
 * status portal (PHP report page, no authentication required).
 *
 * Endpoint:
 *   POST https://cherokeega.com/cherokeestatus/permit-applications-report.php
 *   Content-Type: application/x-www-form-urlencoded
 *
 * The portal is behind Cloudflare WAF which blocks standard Node.js fetch()
 * via TLS fingerprint (JA3/JA4). This adapter uses playwright-core to make
 * requests through a real Chrome browser engine, which passes the WAF.
 *
 * Run the diagnostic script to verify:
 *   pnpm tsx scripts/test-cherokee.ts
 */

import { chromium } from 'playwright-core'
import type { Page } from 'playwright-core'
import { parse } from 'node-html-parser'
import type { HTMLElement } from 'node-html-parser'
import { normalizeStatus, type NormalizedPermit } from './base'
import { findChromiumPath } from './browser'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENDPOINT =
  'https://cherokeega.com/cherokeestatus/permit-applications-report.php'

/** URL to load in the browser before fetching — establishes same-origin context. */
const ORIGIN_URL =
  'https://cherokeega.com/cherokeestatus/permit-applications.php'

const PAGE_SIZE = 50
const MAX_PAGES = 10

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Find the first `div.cs-section` whose `span.label` matches the given label text.
 */
function findSection(wrapper: HTMLElement, label: string): HTMLElement | null {
  const sections = wrapper.querySelectorAll('div.cs-section')
  for (const section of sections) {
    if (section.querySelector('span.label')?.text.trim() === label) {
      return section as HTMLElement
    }
  }
  return null
}

/**
 * Extract the visible text from a section, excluding its `span.label` text.
 */
function sectionText(section: HTMLElement, label: string): string {
  const raw = section.text.trim()
  // Strip the leading label text (e.g. "Description") from the section text
  if (raw.startsWith(label)) {
    return raw.slice(label.length).trim()
  }
  return raw
}

/**
 * Translate Cherokee-specific status strings before normalizeStatus().
 * "Ready for Payment" means the permit has been issued but the fee hasn't
 * been paid yet — treat it as ISSUED (same meaning for our purposes).
 */
function cherokeeStatus(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes('ready for payment')) return 'issued'
  return raw
}

/**
 * Parse contacts from the Contacts section using parallel arrays of
 * span.clickable (names) and div[style*=italic] (roles).
 */
function parseContacts(
  contactSection: HTMLElement | null,
): { name: string; role: string }[] {
  if (!contactSection) return []

  // Primary approach: parallel arrays — most robust with node-html-parser
  const nameEls = contactSection.querySelectorAll('span.clickable')
  const roleEls = contactSection.querySelectorAll('div[style*="italic"]')

  const names = nameEls.map(el => el.text.trim()).filter(Boolean)
  const roles = roleEls.map(el => el.text.trim())

  if (names.length > 0) {
    return names.map((name, i) => ({ name, role: roles[i] ?? '' }))
  }

  // Fallback: childNode iteration — pairs each span.clickable with the next
  // italic div sibling. Used when the parallel arrays don't align.
  const contacts: { name: string; role: string }[] = []
  const nodes = [...contactSection.childNodes]
  let i = 0
  while (i < nodes.length) {
    const node = nodes[i] as HTMLElement
    if (
      node.nodeType === 1 &&
      node.classList?.contains('clickable')
    ) {
      const name = node.text.trim()
      let role = ''
      let j = i + 1
      while (j < nodes.length) {
        const next = nodes[j] as HTMLElement
        if (
          next.nodeType === 1 &&
          next.getAttribute?.('style')?.includes('italic')
        ) {
          role = next.text.trim()
          break
        }
        j++
      }
      if (name) contacts.push({ name, role })
    }
    i++
  }
  return contacts
}

// ---------------------------------------------------------------------------
// Raw fetch (browser-based to bypass Cloudflare TLS fingerprinting)
// ---------------------------------------------------------------------------

/**
 * POST to the permit report endpoint from within a Chrome page context.
 * Using page.evaluate(fetch(...)) sends the request through Chrome's networking
 * stack (BoringSSL TLS), which passes Cloudflare's JA3/JA4 fingerprint check.
 */
async function fetchPage(page: Page, recordstart: number): Promise<string> {
  const bodyStr = new URLSearchParams({
    application_number: '',
    descript: '',
    contact_name: '',
    street_address: '',
    pin: '',
    map: '',
    bythis: 'EL',           // electrical permits only
    recordstart: String(recordstart),
    filter: 'dateentered',
    sortorder: 'desc',
    d: '30',                // last 30 days
  }).toString()

  // Run the fetch inside the browser — same-origin to cherokeega.com
  const result = await page.evaluate(
    async ({ endpoint, body }: { endpoint: string; body: string }) => {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        })
        if (!res.ok) {
          return { ok: false as const, status: res.status, statusText: res.statusText, html: '' }
        }
        return { ok: true as const, status: res.status, statusText: '', html: await res.text() }
      } catch (e) {
        return { ok: false as const, status: 0, statusText: String(e), html: '' }
      }
    },
    { endpoint: ENDPOINT, body: bodyStr },
  )

  if (!result.ok) {
    throw new Error(
      `[cherokee] HTTP ${result.status} ${result.statusText} (recordstart=${recordstart})`,
    )
  }

  return result.html
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse permit records out of a single page of HTML.
 */
function parsePage(html: string): NormalizedPermit[] {
  const root = parse(html)
  const wrappers = root.querySelectorAll('div.cs-wrapper')
  const permits: NormalizedPermit[] = []

  for (const wrapper of wrappers) {
    // 1. Permit number
    const permitNumber = wrapper.querySelector('div.cs-section#app a')?.text.trim()
    if (!permitNumber) continue

    // 2. Description
    const descSection = findSection(wrapper as HTMLElement, 'Description')
    const description = descSection ? sectionText(descSection as HTMLElement, 'Description') : null

    // 3. Date Entered
    const dateSection = findSection(wrapper as HTMLElement, 'Date Entered')
    const dateText = dateSection ? sectionText(dateSection as HTMLElement, 'Date Entered') : null
    const parsedDate = dateText ? new Date(dateText) : null
    const filedAt = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : new Date()

    // 4. Status
    const statusSection = findSection(wrapper as HTMLElement, 'Status')
    const rawStatus = statusSection?.querySelector('strong')?.text.trim() ?? ''

    // 5. Contacts → contractor
    const contactSection = findSection(wrapper as HTMLElement, 'Contacts')
    const contacts = parseContacts(contactSection as HTMLElement | null)
    const contractor = contacts.find(c => /contractor/i.test(c.role))

    // 6. Location
    const locationSection = findSection(wrapper as HTMLElement, 'Locations')
    const jobAddress = locationSection?.querySelector('span.clickable')?.text.trim() ?? null

    // Map status: pre-translate then normalize
    const normalizedStatus = normalizeStatus(cherokeeStatus(rawStatus))

    permits.push({
      source: 'CHEROKEE_HTML',
      externalId: permitNumber,
      permitNumber,
      permitType: 'ELECTRICAL',
      description: description || null,
      status: normalizedStatus,
      jobAddress: jobAddress || null,
      county: 'Cherokee',
      jobValue: null,
      isResidential: false,     // no reliable signal from this portal
      filedAt,
      issuedAt: rawStatus.toLowerCase() === 'issued' ? filedAt : null,
      inspectionAt: null,
      closedAt: null,
      contractorName: contractor?.name ?? '',
      contractorPhone: null,
      contractorLicense: null,
    })
  }

  return permits
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Fetch Cherokee County electrical permits from the last 30 days.
 * Paginates automatically (up to MAX_PAGES pages × PAGE_SIZE records).
 *
 * Launches a headless Chrome browser (reusing the Playwright Chromium already
 * installed by the MCP plugin, or falling back to system Chrome). One browser
 * instance is shared across all paginated requests and closed when done.
 */
export async function fetchCherokeePermits(): Promise<NormalizedPermit[]> {
  const executablePath = findChromiumPath()
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      // Disable navigator.webdriver flag so Cloudflare's bot check doesn't block us
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  })

  const allPermits: NormalizedPermit[] = []

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    })

    // Remove navigator.webdriver from the page's JS environment before any
    // navigation so Cloudflare's bot detection doesn't see it.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    const page = await context.newPage()

    // Navigate to the same origin so subsequent fetch() calls are same-origin.
    // waitUntil:'load' gives Cloudflare's JS challenge time to complete and
    // set any required cookies before we make the POST request.
    await page.goto(ORIGIN_URL, { timeout: 20_000, waitUntil: 'load' })

    for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
      const recordstart = pageNum * PAGE_SIZE

      let html: string
      try {
        html = await fetchPage(page, recordstart)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`[cherokee] fetch failed on page ${pageNum + 1}: ${message}`)
      }

      const pagePermits = parsePage(html)
      allPermits.push(...pagePermits)

      console.log(
        `[cherokee] page ${pageNum + 1}: parsed ${pagePermits.length} permits (total so far: ${allPermits.length})`,
      )

      // Stop if this page returned fewer than PAGE_SIZE — no more pages
      if (pagePermits.length < PAGE_SIZE) break
    }
  } finally {
    await browser.close()
  }

  console.log(`[cherokee] normalized ${allPermits.length} permits`)
  return allPermits
}
