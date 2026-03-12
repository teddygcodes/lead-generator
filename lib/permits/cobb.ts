/**
 * Cobb County ACA (Citizen Access) permit adapter.
 *
 * Fetches electrical permit applications from Cobb County's self-hosted ACA portal.
 * Unlike other ACA portals, Cobb requires login to access Building Permit search.
 *
 * Portal:
 *   https://cobbca.cobbcounty.gov/CitizenAccess/
 *
 * Authentication:
 *   Requires COBB_ACA_USERNAME and COBB_ACA_PASSWORD environment variables.
 *   Register a free account at https://cobbca.cobbcounty.gov/CitizenAccess/
 *   Returns [] gracefully if credentials are absent.
 *
 * Approach:
 *   - Playwright headless Chrome for login (Angular iframe login form)
 *   - Real browser interaction for search (fill + click + wait DOM) — required because
 *     the Telerik RadDatePicker updates a hidden _ext_ClientState field via JS; background
 *     POSTs that only set the visible text input are ignored by the server
 *   - Single wide search by date range (Jan 1 of current year → today by default)
 *   - Filter results client-side: keep rows whose Project Name matches
 *     ELECTRICAL_TYPE_PATTERN (catches "ELEC", "ELECTRICAL", "COMMERCIAL ELECTRICAL", etc.)
 *   - Licensed Professional section is in a <table id="tbl_licensedps"> on detail pages
 *
 * Run the diagnostic script to verify:
 *   COBB_ACA_USERNAME=xxx COBB_ACA_PASSWORD=xxx pnpm tsx scripts/test-cobb.ts
 */

import { chromium } from 'playwright-core'
import type { Page } from 'playwright-core'
import { parse as parseHtml } from 'node-html-parser'
import type { HTMLElement as NHtmlElement } from 'node-html-parser'
import { normalizeStatus, isResidential, type NormalizedPermit } from './base'
import { findChromiumPath } from './browser'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COBB_BASE_URL = 'https://cobbca.cobbcounty.gov/CitizenAccess'
const COBB_MODULE   = 'Building'
const COBB_SOURCE   = 'ACA_COBB'
const COBB_COUNTY   = 'Cobb'

const LOGIN_URL  = `${COBB_BASE_URL}/Login.aspx`
const SEARCH_URL = `${COBB_BASE_URL}/Cap/CapHome.aspx?module=${COBB_MODULE}&customglobalsearch=true`

/**
 * Regex applied to each permit's Project Name column to decide whether
 * it is an electrical permit.  The Cobb portal has no server-side type
 * filter on the simple search form, so we filter results here.
 *
 * Catches variants seen in the wild:
 *   "ELEC", "Elec", "ELECTRICAL", "Electrical",
 *   "COMMERCIAL ELECTRICAL", "Residential Electrical",
 *   "MEIER - ELECTRICAL JOB", "ELC", etc.
 */
const ELECTRICAL_TYPE_PATTERN = /electrical|electric|\belec\b|\belc\b/i

const MAX_PAGES       = 50   // safety cap: 50 pages × 10 rows = 500 permits
const DETAIL_DELAY_MS = 200  // polite delay between detail page GETs

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

function toMDY(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${m}/${d}/${date.getFullYear()}`
}

function parseMDY(str: string): Date | null {
  const parts = str.split('/')
  if (parts.length !== 3) return null
  const mm = parseInt(parts[0], 10)
  const dd = parseInt(parts[1], 10)
  const yyyy = parseInt(parts[2], 10)
  if (!mm || !dd || !yyyy) return null
  return new Date(yyyy, mm - 1, dd)
}


// ---------------------------------------------------------------------------
// List page parser — Cobb-specific
//
// Results table:  #ctl00_PlaceHolderMain_dgvPermitList_gdvPermitList
// Data row class: ACA_TabRow_Odd / ACA_TabRow_Even
// Columns (0-indexed td):
//   [0] checkbox
//   [1] Date       — <span id="...lblUpdatedTime">MM/DD/YYYY</span>
//   [2] Building Number — <a href="/CitizenAccess/Cap/CapDetail.aspx?...">NNNN-NNNNNN</a>
//   [3] Project Name — plain text (e.g. "COMMERCIAL ELECTRICAL", "ELEC")
//   [4] Address
//   [5] Status
// ---------------------------------------------------------------------------

interface ListRow {
  date:        string
  permitNumber: string
  detailPath:  string
  /** The "Project Name" column — used to filter for electrical permits */
  projectName: string
  address:     string
  status:      string
}

function parseListRows(html: string): ListRow[] {
  const root    = parseHtml(html)
  const results: ListRow[] = []

  // Data rows have class ACA_TabRow_Odd or ACA_TabRow_Even (header/pagination rows do not)
  const dataRows = root.querySelectorAll('tr.ACA_TabRow_Odd, tr.ACA_TabRow_Even')

  for (const row of dataRows as NHtmlElement[]) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 6) continue

    // --- Date (column 1) ---
    const dateSpan = row.querySelector('span[id*="lblUpdatedTime"]')
    const dateText = (dateSpan?.text ?? cells[1]?.text ?? '').trim()
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateText)) continue

    // --- Permit number + detail path (column 2) ---
    const permitLink   = cells[2]?.querySelector('a')
    const permitNumber = permitLink?.text?.trim() ?? ''
    let   detailPath   = permitLink?.getAttribute('href') ?? ''

    if (!permitNumber || !detailPath) continue

    // Ensure absolute path
    if (!detailPath.startsWith('http') && !detailPath.startsWith('/')) {
      detailPath = `/CitizenAccess/${detailPath.replace(/^\.\.\//, '')}`
    }

    // --- Project Name (column 3) — used for electrical filtering ---
    const projectName = cells[3]?.text?.trim() ?? ''

    // --- Address (column 4) ---
    const address = cells[4]?.text?.trim() ?? ''

    // --- Status (column 5) ---
    const status = cells[5]?.text?.trim() ?? ''

    results.push({ date: dateText, permitNumber, detailPath, projectName, address, status })
  }

  return results
}


// ---------------------------------------------------------------------------
// Contractor detail page parser — Cobb-specific
//
// Structure on detail page:
//   <table id="tbl_licensedps">
//     <tbody><tr>
//       <td class="td_child_left"></td>   ← empty margin cell
//       <td>                               ← data cell
//         JASON LEE BALLEW jason.ballew@example.com <br>
//         ANSCO & ASSOCIATES LLC<br>
//         200 NORTH POINT CENTER EAST<br>
//         ALPHARETTA, GA, 30022<br>
//         <table ...><tr>
//           <td>Company Phone:</td>
//           <td><div class="ACA_PhoneNumberLTR">6788368938</div></td>
//         </tr></table>
//         ELEC  EN212535<br>
//       </td>
//     </tr></tbody>
//   </table>
// ---------------------------------------------------------------------------

interface ContractorInfo {
  contractorName:    string
  contractorPhone:   string | null
  contractorLicense: string | null
}

function parseContractorSection(html: string): ContractorInfo {
  const none: ContractorInfo = { contractorName: '', contractorPhone: null, contractorLicense: null }
  const root = parseHtml(html)

  // Cobb portal uses a dedicated table with id="tbl_licensedps"
  const lpTable = root.querySelector('#tbl_licensedps')
  if (!lpTable) return none

  // Data is in the second td (first td is the empty left-margin cell)
  const dataTd = lpTable.querySelector('td:not(.td_child_left)')
  if (!dataTd) return none

  // Extract phone from .ACA_PhoneNumberLTR before stripping HTML
  const phoneEl  = dataTd.querySelector('.ACA_PhoneNumberLTR')
  const rawPhone = (phoneEl?.text ?? '').replace(/\D/g, '')
  const contractorPhone = rawPhone.length >= 10 ? rawPhone.slice(0, 10) : null

  // Convert HTML to newline-separated text lines by replacing structural
  // tags before stripping HTML, so we don't lose word boundaries
  const textBlock = (dataTd as NHtmlElement).innerHTML
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:td|tr|table|div|p|span)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')

  const lines = textBlock
    .split(/\n/)
    .map(l => l.trim())
    .filter(l =>
      l.length > 0 &&
      !/^company phone/i.test(l) &&   // "Company Phone:" label
      !/^\d{10}$/.test(l),            // raw 10-digit phone number line
    )

  if (lines.length === 0) return { contractorName: '', contractorPhone, contractorLicense: null }

  // Line 0: "<CONTACT NAME> [<email>]"
  //   Email is the part containing '@'; the rest is the contact person's name
  const line0Parts  = (lines[0] ?? '').split(/\s+/)
  const contactName = line0Parts.filter(p => !p.includes('@')).join(' ').trim()

  // Line 1: company name (e.g. "ANSCO & ASSOCIATES LLC")
  const companyLine = lines[1]?.trim() ?? ''

  // Prefer company name if it looks like a business entity; otherwise fall back
  // to the contact name from line 0
  const businessKw  = /llc|inc|corp|electric|electrical|power|systems|services|contracting|contractors|group|co\./i
  const contractorName = (businessKw.test(companyLine) ? companyLine : contactName || companyLine).trim()

  // License line: matches "ELEC EN212535", "GA-EL 123456", etc.
  //   Signature: type code (2-6 uppercase letters) + space + number (4-15 alphanumeric)
  let contractorLicense: string | null = null
  for (const line of lines) {
    if (/^[A-Z]{2,6}\s+[A-Z0-9]{4,15}$/.test(line)) {
      contractorLicense = line
      break
    }
  }

  return { contractorName, contractorPhone, contractorLicense }
}

// ---------------------------------------------------------------------------
// Paginated search — real browser interaction
//
// The Cobb portal uses a Telerik RadDatePicker whose actual state is stored
// in a hidden _ext_ClientState field.  Background UpdatePanel POSTs that set
// only the visible text input are ignored by the server, returning a different
// (usually smaller) result set.  Real browser interaction — click, fill, Tab,
// click Search — triggers the Telerik JS that updates ClientState, so the
// server honours the date range and returns all matching permits.
// ---------------------------------------------------------------------------

async function fetchAllPages(
  page:      Page,
  startDate: string,
  endDate:   string,
): Promise<ListRow[]> {
  // Navigate to search page
  await page.goto(SEARCH_URL, { timeout: 20_000, waitUntil: 'load' })

  // Fill dates using real browser interaction
  const startInput = page.locator('#ctl00_PlaceHolderMain_generalSearchForm_txtGSStartDate')
  const endInput   = page.locator('#ctl00_PlaceHolderMain_generalSearchForm_txtGSEndDate')

  await startInput.click({ clickCount: 3 })
  await startInput.fill(startDate)
  await page.keyboard.press('Tab')
  await new Promise(r => setTimeout(r, 300))

  await endInput.click({ clickCount: 3 })
  await endInput.fill(endDate)
  await page.keyboard.press('Tab')
  await new Promise(r => setTimeout(r, 300))

  // Click the Search button
  await page.click('a[href*="btnNewSearch"]')

  // Wait for results row to appear (or timeout gracefully if no results)
  await page.waitForSelector('tr.ACA_TabRow_Odd, tr.ACA_TabRow_Even', { timeout: 15_000 })
    .catch(() => {})
  await new Promise(r => setTimeout(r, 500))

  const allRows: ListRow[] = []
  let pageNum = 1

  while (pageNum <= MAX_PAGES) {
    const html       = await page.content()
    const rows       = parseListRows(html)
    const electrical = rows.filter(r => ELECTRICAL_TYPE_PATTERN.test(r.projectName))

    console.log(`[cobb] page ${pageNum} — ${rows.length} total rows, ${electrical.length} electrical`)

    allRows.push(...electrical)
    if (rows.length === 0) break

    // Check for Next > link
    const nextLink  = page.locator('a', { hasText: 'Next >' })
    const nextCount = await nextLink.count()
    if (nextCount === 0) {
      console.log('[cobb] no Next > link — done paginating')
      break
    }

    // Snapshot the first row's text so we can detect when the UpdatePanel replaces it
    const firstRowBefore = await page
      .locator('tr.ACA_TabRow_Odd, tr.ACA_TabRow_Even')
      .first()
      .textContent()
      .catch(() => '')

    await nextLink.first().click()

    // Wait until the UpdatePanel swaps in the next page (typically <500 ms)
    await page.waitForFunction(
      (prev: string | null) => {
        const row = document.querySelector('tr.ACA_TabRow_Odd, tr.ACA_TabRow_Even')
        return Boolean(row) && row!.textContent !== prev
      },
      firstRowBefore,
      { timeout: 8_000 },
    ).catch(() => {})
    await new Promise(r => setTimeout(r, 200))  // tiny render buffer
    pageNum++
  }

  return allRows
}

// ---------------------------------------------------------------------------
// Contractor detail fetch
// ---------------------------------------------------------------------------

async function fetchContractorInfo(page: Page, detailPath: string): Promise<ContractorInfo> {
  // detailPath from the search results is an absolute server path like
  // "/CitizenAccess/Cap/CapDetail.aspx?..." — prepend only the host,
  // NOT COBB_BASE_URL (which already contains "/CitizenAccess").
  const url = detailPath.startsWith('http')
    ? detailPath
    : detailPath.startsWith('/')
    ? `https://cobbca.cobbcounty.gov${detailPath}`
    : `${COBB_BASE_URL}/${detailPath}`

  // ASP.NET detail pages require real browser navigation (session cookies).
  // Use 'load' (faster than 'networkidle') then wait explicitly for the
  // Licensed Professionals table, which is rendered by JS after page load.
  try {
    await page.goto(url, { timeout: 20_000, waitUntil: 'load' })
  } catch {
    // 'load' rarely times out; fall through and check for the element anyway.
  }

  // Wait for #tbl_licensedps to appear in the DOM (JS-rendered, usually <2 s)
  await page.waitForSelector('#tbl_licensedps', { timeout: 8_000 }).catch(() => {})

  // If #tbl_licensedps is present this permit has a licensed contractor.
  const lpEl = await page.$('#tbl_licensedps')
  if (!lpEl) return { contractorName: '', contractorPhone: null, contractorLicense: null }

  const html = await page.content()
  return parseContractorSection(html)
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function fetchCobbPermits(): Promise<NormalizedPermit[]> {
  const username = process.env.COBB_ACA_USERNAME
  const password = process.env.COBB_ACA_PASSWORD

  if (!username || !password) {
    console.warn('[cobb] COBB_ACA_USERNAME / COBB_ACA_PASSWORD not set — skipping')
    return []
  }

  const executablePath = findChromiumPath()
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
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
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    const page = await context.newPage()

    // -----------------------------------------------------------------------
    // Step 1 — Login
    // -----------------------------------------------------------------------

    console.log('[cobb] Navigating to login page…')
    await page.goto(LOGIN_URL, { timeout: 20_000, waitUntil: 'load' })

    // The login iframe has id="LoginFrame" but name="" (empty), so we match
    // by URL instead of name.  The Sign In button is an Angular PrimeNG
    // component (<button class="p-button">) with no type attribute, so
    // button[type=submit] won't match — use the Angular component selector.
    const loginFrame = page.frame({ url: /login-panel/ })
    if (!loginFrame) {
      throw new Error('[cobb] LoginFrame iframe not found (url: /login-panel/ not matched)')
    }

    // Intercept the SignIn API response so we can surface a useful error
    // message instead of a cryptic timeout if credentials are wrong.
    let signInErrorMessage: string | null = null
    page.on('response', async response => {
      if (response.url().includes('/api/PublicUser/SignIn')) {
        try {
          const json = await response.json() as { type?: string; message?: string }
          if (json?.type === 'error') {
            signInErrorMessage = json.message ?? 'Unknown error from SignIn API'
          }
        } catch { /* ignore parse errors */ }
      }
    })

    await loginFrame.waitForSelector('#username', { timeout: 10_000 })
    await loginFrame.fill('#username', username)
    await loginFrame.fill('#passwordRequired', password)
    await loginFrame.click('accela-button-primary button')

    // Wait until we leave the Login page
    try {
      await page.waitForURL(url => !url.toString().includes('/Login.aspx'), { timeout: 20_000 })
    } catch {
      // Surface the real error if the SignIn API told us why it failed
      if (signInErrorMessage) {
        throw new Error(
          `[cobb] Login failed: ${signInErrorMessage} — ` +
            'Check COBB_ACA_USERNAME and COBB_ACA_PASSWORD in .env.local.',
        )
      }
      throw new Error(
        '[cobb] Login timed out — page never left Login.aspx. ' +
          'Check COBB_ACA_USERNAME and COBB_ACA_PASSWORD in .env.local.',
      )
    }

    // Confirm a real session was established — ACA portals can redirect away
    // from /Login.aspx on failure (e.g. to an error interstitial) without
    // actually setting a valid session cookie.  Verifying the Logout link is
    // present confirms authentication succeeded.
    try {
      await page.waitForSelector(
        'a[href*="Logout"], a[href*="logout"]',
        { timeout: 8_000 },
      )
    } catch {
      throw new Error(
        '[cobb] Login appeared to succeed (left Login.aspx) but no Logout link found — ' +
          'credentials may be incorrect or the portal returned an error page. ' +
          'Check COBB_ACA_USERNAME and COBB_ACA_PASSWORD.',
      )
    }

    console.log('[cobb] Login confirmed. Navigating to Building Permits search…')

    // -----------------------------------------------------------------------
    // Step 2 — Search all Building permits (real browser interaction)
    //
    // Default: Jan 1 of the current year → today.
    // Override start via PERMIT_LOOKBACK_DAYS env var (days back from today).
    // -----------------------------------------------------------------------

    const endDate = toMDY(new Date())
    const lookbackDays = parseInt(process.env.PERMIT_LOOKBACK_DAYS ?? '0', 10)
    const startDate = lookbackDays > 0
      ? toMDY(new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1_000))
      : `01/01/${new Date().getFullYear()}`

    console.log(`[cobb] Searching all Building permits from ${startDate} to ${endDate}…`)

    const allRows = await fetchAllPages(page, startDate, endDate)

    // De-duplicate by permit number (in case the same permit appears on multiple pages)
    const seen    = new Set<string>()
    const unique  = allRows.filter(r => !seen.has(r.permitNumber) && seen.add(r.permitNumber))

    console.log(`[cobb] ${unique.length} unique electrical permits — fetching contractor details…`)

    // -----------------------------------------------------------------------
    // Step 3 — Reset browser state, then fetch detail pages
    //
    // Navigate to Dashboard first so the search results page state doesn't
    // interfere with direct navigation to CapDetail.aspx pages.
    // -----------------------------------------------------------------------

    await page.goto(`${COBB_BASE_URL}/Dashboard.aspx`, { timeout: 15_000, waitUntil: 'load' })

    let hasLoggedSample = false

    for (const row of unique) {
      try {
        await new Promise(r => setTimeout(r, DETAIL_DELAY_MS))

        const contractor = await fetchContractorInfo(page, row.detailPath)

        if (!hasLoggedSample) {
          console.log('[cobb] sample:', JSON.stringify({ row, contractor }, null, 2))
          hasLoggedSample = true
        }

        if (!contractor.contractorName) {
          console.warn(`[cobb] skip ${row.permitNumber} — no contractor name found`)
          continue
        }

        const filedAt = parseMDY(row.date)
        if (!filedAt) {
          console.warn(`[cobb] skip ${row.permitNumber} — unparseable date: ${row.date}`)
          continue
        }

        const residential = isResidential(row.projectName) || /residential/i.test(row.projectName)

        allPermits.push({
          source:            COBB_SOURCE,
          externalId:        row.permitNumber,
          permitNumber:      row.permitNumber,
          permitType:        'ELECTRICAL',
          description:       row.projectName || null,
          status:            normalizeStatus(row.status),
          jobAddress:        row.address || null,
          county:            COBB_COUNTY,
          jobValue:          null,
          isResidential:     residential,
          filedAt,
          issuedAt:          null,
          inspectionAt:      null,
          closedAt:          null,
          contractorName:    contractor.contractorName,
          contractorPhone:   contractor.contractorPhone,
          contractorLicense: contractor.contractorLicense,
        })
      } catch (err) {
        console.warn(`[cobb] error processing ${row.permitNumber}:`, err)
      }
    }
  } finally {
    await browser.close()
  }

  console.log(`[cobb] complete — ${allPermits.length} permits with contractor data`)
  return allPermits
}
