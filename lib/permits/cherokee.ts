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
 * Run the diagnostic script to verify:
 *   pnpm tsx scripts/test-cherokee.ts
 */

import { parse } from 'node-html-parser'
import type { HTMLElement } from 'node-html-parser'
import { normalizeStatus, type NormalizedPermit } from './base'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENDPOINT =
  'https://cherokeega.com/cherokeestatus/permit-applications-report.php'

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
// Raw fetch
// ---------------------------------------------------------------------------

/**
 * Fetch a single page of Cherokee permit HTML.
 */
async function fetchPage(recordstart: number): Promise<string> {
  const body = new URLSearchParams({
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
  })

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Origin': 'https://cherokeega.com',
      'Referer': 'https://cherokeega.com/cherokeestatus/permit-applications-report.php',
    },
    body: body.toString(),
  })

  if (!res.ok) {
    throw new Error(`[cherokee] HTTP ${res.status} ${res.statusText} (recordstart=${recordstart})`)
  }

  return res.text()
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
 */
export async function fetchCherokeePermits(): Promise<NormalizedPermit[]> {
  const allPermits: NormalizedPermit[] = []

  for (let page = 0; page < MAX_PAGES; page++) {
    const recordstart = page * PAGE_SIZE

    let html: string
    try {
      html = await fetchPage(recordstart)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`[cherokee] fetch failed on page ${page + 1}: ${message}`)
    }

    const pagePermits = parsePage(html)
    allPermits.push(...pagePermits)

    console.log(
      `[cherokee] page ${page + 1}: parsed ${pagePermits.length} permits (total so far: ${allPermits.length})`,
    )

    // Stop if this page returned fewer than PAGE_SIZE — no more pages
    if (pagePermits.length < PAGE_SIZE) break
  }

  console.log(`[cherokee] normalized ${allPermits.length} permits`)
  return allPermits
}
