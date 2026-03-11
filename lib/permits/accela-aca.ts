/**
 * Accela ACA (Citizen Access) portal scraper adapter.
 *
 * Scrapes electrical permit data from aca-prod.accela.com using the public-facing
 * ASP.NET WebForms search interface. No API key or OAuth required — uses session
 * cookies + VIEWSTATE only.
 *
 * Supported agencies: Atlanta/Fulton (ATLANTA_GA), Gwinnett (GWINNETT), Hall (HALLCO)
 *
 * Two passes per permit:
 *   1. List pages  — date, permit#, type, address, description, status
 *   2. Detail page — contractor name, business, license#, phone
 *      (one GET per permit; job value not publicly available → null)
 */

import { parse as parseHtml } from 'node-html-parser'
import type { HTMLElement as NHtmlElement } from 'node-html-parser'
import { type NormalizedPermit, isResidential, normalizeStatus } from '@/lib/permits/base'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type AcaAgencyCode = 'ATLANTA_GA' | 'GWINNETT' | 'HALLCO'

interface AcaAgencyConfig {
  source:           string
  county:           string
  /** ACA module parameter, e.g. "Building" or "HallCounty" */
  module:           string
  /**
   * Display text labels of the permit type dropdown options to search.
   * Each entry is the exact option text as shown in the `<select>` on the search page.
   * These vary per agency — confirm against the live HTML when adding new agencies.
   */
  permitTypeLabels: string[]
}

const ACA_AGENCY_CONFIG: Record<AcaAgencyCode, AcaAgencyConfig> = {
  ATLANTA_GA: {
    source:           'ACA_ATLANTA',
    county:           'Fulton',   // Atlanta is a city in Fulton County
    module:           'Building',
    permitTypeLabels: ['Commercial - Electrical', 'Residential - Electrical'],
  },
  GWINNETT: {
    source:           'ACA_GWINNETT',
    county:           'Gwinnett',
    module:           'Building',
    // GWINNETT labels residential electrical as "Electrical".
    // "Cable TV Power Booster Installation" is the (mislabeled) commercial electrical type;
    // its option value path is Building/Commercial/Electrical/NA.
    permitTypeLabels: ['Cable TV Power Booster Installation', 'Electrical'],
  },
  HALLCO: {
    source:           'ACA_HALLCO',
    county:           'Hall',
    module:           'HallCounty',   // Hall County portal requires this non-standard module name
    permitTypeLabels: ['H - Commercial Electrical Permit', 'H - Residential Electrical Permit'],
  },
}

const ACA_BASE_URL    = 'https://aca-prod.accela.com'
const MAX_PAGES       = 50   // safety cap: 50 × 10 = 500 permits per type
const DETAIL_DELAY_MS = 200  // polite delay between detail page GETs

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

/** Format a Date as MM/DD/YYYY for ACA form fields. */
function toMDY(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${m}/${d}/${date.getFullYear()}`
}

/** Parse MM/DD/YYYY string into a Date. Returns null on failure. */
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
// ASP.NET ScriptManager UpdatePanel response parser
// ---------------------------------------------------------------------------

/**
 * Parsed content of an ASP.NET ScriptManager UpdatePanel AJAX response.
 *
 * The raw response uses a pipe-delimited format:
 *   <length>|<type>|<id>|<content>|...
 *
 * Segment types we care about:
 *   updatePanel  — updated panel HTML
 *   hiddenField  — updated hidden field values (id = field name, content = new value)
 *
 * IMPORTANT: __VIEWSTATE and ACA_CS_FIELD updates come in `hiddenField` segments, NOT
 * embedded in the updatePanel HTML. Failing to read these means pagination POSTs use a
 * stale VIEWSTATE (from the initial GET) and the server returns empty page-2 results.
 */
interface ParsedAjaxPage {
  html:             string   // joined content from all updatePanel segments
  resultsPanelName: string   // ASP.NET $ name of the panel owning the results grid
  viewState:        string   // __VIEWSTATE from hiddenField segments (may be empty)
  eventValidation:  string   // __EVENTVALIDATION from hiddenField segments (may be empty)
  acaCsField:       string   // ACA_CS_FIELD from hiddenField segments (may be empty)
}

function extractUpdatePanelHtml(body: string): ParsedAjaxPage {
  const fallback: ParsedAjaxPage = {
    html: body, resultsPanelName: 'ctl00$PlaceHolderMain$updatePanel',
    viewState: '', eventValidation: '', acaCsField: '',
  }
  if (!body || !/^\d+\|/.test(body)) return fallback

  const panelSegments: Array<{ id: string; content: string }> = []
  const hiddenFields: Record<string, string> = {}
  let pos = 0
  let guard = 0

  while (pos < body.length && guard++ < 500) {
    const lenEnd = body.indexOf('|', pos)
    if (lenEnd < 0) break
    const segLen = parseInt(body.slice(pos, lenEnd), 10)
    if (isNaN(segLen)) break

    const typeEnd = body.indexOf('|', lenEnd + 1)
    if (typeEnd < 0) break
    const segType = body.slice(lenEnd + 1, typeEnd)

    const idEnd = body.indexOf('|', typeEnd + 1)
    if (idEnd < 0) break
    const segId = body.slice(typeEnd + 1, idEnd)

    const contentStart = idEnd + 1
    const contentEnd   = contentStart + segLen
    if (contentEnd > body.length) break
    const content = body.slice(contentStart, contentEnd)

    if (segType === 'updatePanel') {
      panelSegments.push({ id: segId, content })
    } else if (segType === 'hiddenField') {
      // id = ASP.NET field name (e.g. "__VIEWSTATE"), content = new value
      hiddenFields[segId] = content
    }
    pos = contentEnd + 1
  }

  if (panelSegments.length === 0) {
    return { ...fallback, viewState: hiddenFields['__VIEWSTATE'] ?? '', eventValidation: hiddenFields['__EVENTVALIDATION'] ?? '', acaCsField: hiddenFields['ACA_CS_FIELD'] ?? '' }
  }

  // Detect which panel segment contains the permit results grid.
  // Use result-row span ID patterns (lbl* = display-only, not form inputs) to avoid
  // false-positives from the search form segment which also contains "Permit Number" text.
  const resultsIndicators = [
    'lblPermitNumber',   // GWINNETT-style result rows
    'lblUpdatedTime',    // GWINNETT-style date column
    'Record Number',     // Atlanta-style table header
  ]
  let resultsPanelName = panelSegments[0].id.replace(/_/g, '$')

  for (const seg of panelSegments) {
    if (resultsIndicators.some(ind => seg.content.includes(ind))) {
      resultsPanelName = seg.id.replace(/_/g, '$')
      break
    }
  }

  return {
    html:             panelSegments.map(s => s.content).join('\n'),
    resultsPanelName,
    viewState:        hiddenFields['__VIEWSTATE']        ?? '',
    eventValidation:  hiddenFields['__EVENTVALIDATION']  ?? '',
    acaCsField:       hiddenFields['ACA_CS_FIELD']       ?? '',
  }
}

// ---------------------------------------------------------------------------
// Cookie utilities
// ---------------------------------------------------------------------------

function getSetCookies(headers: Headers): string[] {
  // getSetCookie() is available in Node.js 18.10+ / undici
  const h = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof h.getSetCookie === 'function') return h.getSetCookie()
  const single = headers.get('set-cookie')
  return single ? [single] : []
}

function buildCookieString(setCookies: string[]): string {
  return setCookies.map(h => h.split(';')[0].trim()).join('; ')
}

// ---------------------------------------------------------------------------
// VIEWSTATE / form field extraction
// ---------------------------------------------------------------------------

/** Extract the value of a hidden <input> by name or id. */
function extractHidden(html: string, fieldName: string): string {
  const escaped = fieldName.replace(/\$/g, '\\$')
  const patterns = [
    new RegExp(`<input[^>]+(?:id|name)="${escaped}"[^>]*value="([^"]*)"`, 'i'),
    new RegExp(`<input[^>]+value="([^"]*)"[^>]*(?:id|name)="${escaped}"`, 'i'),
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m?.[1] !== undefined) return m[1]
  }
  return ''
}

interface SessionState {
  viewState:            string
  eventValidation:      string
  viewStateGenerator:   string
  acaCsField:           string   // CSRF token required in every POST body
  permitTypeFieldName:  string
  permitTypeValues:     Record<string, string>  // maps display text → option value
  startDateFieldName:   string   // empty string if the portal has no date range inputs
  defaultStartDate:     string   // page's pre-filled start date value (matches VIEWSTATE)
  endDateFieldName:     string   // empty string if the portal has no date range inputs
  defaultEndDate:       string   // page's pre-filled end date value (matches VIEWSTATE)
  searchTypeFieldName:  string   // e.g. ddlSearchType; value '0' = General Search; empty if absent
  searchButtonTarget:   string
  cookieStr:            string
}

/**
 * Dynamically extract form field names (and default date values) from the search page HTML.
 * Returns null if the page structure is unexpected (wrong agency, 404, etc.).
 *
 * Date fields are optional — some portals (e.g. GWINNETT) do not expose start/end date
 * inputs in their global search form.  When absent, the scraper posts without date
 * parameters and relies entirely on client-side date filtering.
 *
 * We capture the page's OWN default date values because the VIEWSTATE encodes those
 * defaults.  If we override dates with our custom range, ASP.NET's server-side
 * reconciliation throws "String was not recognized as a valid DateTime".  Instead we
 * send the page defaults and filter the returned rows client-side.
 */
function extractFormFields(
  html: string,
): Pick<SessionState, 'permitTypeFieldName' | 'permitTypeValues' | 'startDateFieldName' | 'defaultStartDate' | 'endDateFieldName' | 'defaultEndDate' | 'searchTypeFieldName' | 'searchButtonTarget'> | null {
  const root = parseHtml(html)

  // Permit type: find the <select> whose name contains "ddlGSPermitType".
  // This is the standard ACA field name across all agency portals.
  // Also build a complete map of display text → option value.
  let permitTypeFieldName = ''
  const permitTypeValues: Record<string, string> = {}
  let searchTypeFieldName = ''

  for (const sel of root.querySelectorAll('select')) {
    const name = sel.getAttribute('name') ?? ''
    if (/ddlGSPermitType/i.test(name)) {
      permitTypeFieldName = name
      for (const opt of sel.querySelectorAll('option')) {
        const text  = opt.text.trim()
        const value = opt.getAttribute('value') ?? text
        if (text) permitTypeValues[text] = value
      }
    } else if (/ddlSearchType/i.test(name)) {
      // Some portals (e.g. GWINNETT) have a search-type selector.
      // We always send '0' (General Search) to get permit-level results.
      searchTypeFieldName = name
    }
  }

  // Date inputs: find <input> whose id contains "StartDate" / "EndDate".
  // Capture the current `value` attribute (page default) alongside the field name.
  // These are OPTIONAL — not all agency portals expose date range filters.
  let startDateFieldName = ''
  let defaultStartDate   = ''
  let endDateFieldName   = ''
  let defaultEndDate     = ''
  for (const inp of root.querySelectorAll('input')) {
    const id   = inp.getAttribute('id')    ?? ''
    const name = inp.getAttribute('name')  ?? ''
    const val  = inp.getAttribute('value') ?? ''
    if (/startdate/i.test(id) && !startDateFieldName) {
      startDateFieldName = name
      defaultStartDate   = val
    }
    if (/enddate/i.test(id) && !endDateFieldName) {
      endDateFieldName = name
      defaultEndDate   = val
    }
  }

  // Search button target: <a> whose href contains "btnNewSearch".
  // node-html-parser decodes HTML entities in attribute values, so &quot; → "
  let searchButtonTarget = ''
  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href') ?? ''
    if (href.includes('btnNewSearch')) {
      const m = href.match(/WebForm_PostBackOptions\("([^"]+)"/)
      if (m) { searchButtonTarget = m[1]; break }
    }
  }

  // Only permit type field and search button are required; date fields are optional.
  if (!permitTypeFieldName || !searchButtonTarget) {
    return null
  }

  return {
    permitTypeFieldName,
    permitTypeValues,
    startDateFieldName,
    defaultStartDate,
    endDateFieldName,
    defaultEndDate,
    searchTypeFieldName,
    searchButtonTarget,
  }
}

// ---------------------------------------------------------------------------
// Session init — GET the search page to acquire cookies + VIEWSTATE
// ---------------------------------------------------------------------------

async function initSession(agencyCode: string, module: string): Promise<SessionState | null> {
  const url = `${ACA_BASE_URL}/${agencyCode}/Cap/CapHome.aspx?module=${module}&customglobalsearch=true`

  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadGenerator/1.0)' },
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    console.warn(`[accela-aca] ${agencyCode}: session GET failed:`, err)
    return null
  }

  if (!res.ok) {
    console.warn(`[accela-aca] ${agencyCode}: session GET returned ${res.status}`)
    return null
  }

  const html      = await res.text()
  const cookieStr = buildCookieString(getSetCookies(res.headers))
  const fields    = extractFormFields(html)

  if (!fields) {
    console.warn(`[accela-aca] ${agencyCode}: unexpected page structure — could not extract form fields`)
    return null
  }

  return {
    viewState:          extractHidden(html, '__VIEWSTATE'),
    eventValidation:    extractHidden(html, '__EVENTVALIDATION'),
    viewStateGenerator: extractHidden(html, '__VIEWSTATEGENERATOR'),
    acaCsField:         extractHidden(html, 'ACA_CS_FIELD'),
    cookieStr,
    ...fields,
  }
}

// ---------------------------------------------------------------------------
// POST helper — submit the search form or a pagination click
// ---------------------------------------------------------------------------

interface PostResult {
  html:             string
  resultsPanelName: string   // ASP.NET field name of the panel containing the results grid
  viewState:        string
  eventValidation:  string
  acaCsField:       string
  cookieStr:        string
}

async function postCapHome(
  agencyCode:   string,
  module:       string,
  state:        SessionState,
  extraFields:  Record<string, string>,
  isAjax = false,
): Promise<PostResult | null> {
  const url = `${ACA_BASE_URL}/${agencyCode}/Cap/CapHome.aspx?module=${module}&customglobalsearch=true`

  const body = new URLSearchParams({
    __VIEWSTATE:            state.viewState,
    __EVENTVALIDATION:      state.eventValidation,
    __VIEWSTATEGENERATOR:   state.viewStateGenerator,
    __VIEWSTATEENCRYPTED:   '',
    __LASTFOCUS:            '',
    __EVENTARGUMENT:        '',
    ACA_CS_FIELD:           state.acaCsField,
    ...extraFields,
  })
  if (isAjax) {
    body.set('__ASYNCPOST', 'true')
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Cookie':       state.cookieStr,
    'User-Agent':   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer':      url,
    'Origin':       ACA_BASE_URL,
  }
  if (isAjax) {
    headers['X-Requested-With'] = 'XMLHttpRequest'
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: body.toString(),
      signal: AbortSignal.timeout(25_000),
    })
  } catch (err) {
    console.warn(`[accela-aca] ${agencyCode}: POST failed:`, err)
    return null
  }

  if (!res.ok) {
    console.warn(`[accela-aca] ${agencyCode}: POST returned ${res.status}`)
    return null
  }

  const rawBody       = await res.text()
  const parsed        = extractUpdatePanelHtml(rawBody)
  const newSetCookies = getSetCookies(res.headers)
  const cookieStr     = newSetCookies.length > 0 ? buildCookieString(newSetCookies) : state.cookieStr

  // Prefer hiddenField-segment values (direct from ScriptManager protocol).
  // Fall back to extractHidden (for full-page responses) then to current state.
  return {
    html:             parsed.html,
    resultsPanelName: parsed.resultsPanelName,
    viewState:        parsed.viewState        || extractHidden(parsed.html, '__VIEWSTATE')       || state.viewState,
    eventValidation:  parsed.eventValidation  || extractHidden(parsed.html, '__EVENTVALIDATION') || state.eventValidation,
    acaCsField:       parsed.acaCsField       || extractHidden(parsed.html, 'ACA_CS_FIELD')      || state.acaCsField,
    cookieStr,
  }
}

// ---------------------------------------------------------------------------
// List page parser
// ---------------------------------------------------------------------------

interface ListRow {
  date:         string
  permitNumber: string
  detailPath:   string  // e.g. "/ATLANTA_GA/Cap/CapDetail.aspx?..."
  recordType:   string
  address:      string
  description:  string
  status:       string
}

/**
 * Column layout (0-indexed <td> cells) for standard ACA portals (e.g. Atlanta):
 *   0=checkbox  1=date  2=permitNum(link)  3=recordType  4=address
 *   5=description  6=permitName  7=status  8=action  9=shortNotes
 *
 * GWINNETT uses span IDs instead of fixed column positions:
 *   lblUpdatedTime → date, lblPermitNumber → permit#, lblType → record type,
 *   lblProjectName → description, lblStatus → status
 *   Detail path is constructed from <input id="RecordId"> when no <a href="CapDetail"> exists.
 */
const DATE_COL   = 1
const PERMIT_COL = 2
const TYPE_COL   = 3
const ADDR_COL   = 4
const DESC_COL   = 5
const PNAME_COL  = 6
const STATUS_COL = 7

function parseListRows(html: string, agencyCode: string, module: string): ListRow[] {
  const root    = parseHtml(html)
  const results: ListRow[] = []

  // Find the results table.
  // Standard portals (Atlanta): table text contains "Record Number" and "Record Type".
  // GWINNETT-style portals: table contains spans with id*="lblPermitNumber",
  //   or table text contains "Permit Number" and "Permit Type".
  let dataTable: NHtmlElement | null = null
  for (const tbl of root.querySelectorAll('table')) {
    const hasStandardHeaders = tbl.text.includes('Record Number') && tbl.text.includes('Record Type')
    const hasAltHeaders      = tbl.text.includes('Permit Number') && tbl.text.includes('Permit Type')
    const hasSpanIds         = tbl.querySelector('span[id*="lblPermitNumber"]') !== null
    if (hasStandardHeaders || hasAltHeaders || hasSpanIds) {
      dataTable = tbl
      break
    }
  }
  if (!dataTable) return []

  for (const row of dataTable.querySelectorAll('tr')) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 4) continue

    // --- Date ---
    // GWINNETT uses span[id*="lblUpdatedTime"]; standard portals use cell text directly.
    const dateSpan = row.querySelector('span[id*="lblUpdatedTime"]')
    const dateText = (dateSpan ? dateSpan.text : (cells[DATE_COL]?.text ?? '')).trim()
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateText)) continue

    // --- Permit number + detail path ---
    let permitNumber = ''
    let detailPath   = ''

    const permitSpan = row.querySelector('span[id*="lblPermitNumber"]')
    if (permitSpan) {
      // GWINNETT-style: span holds permit number; detail link may be absent for 26TMP permits.
      permitNumber = permitSpan.text.trim()
      const permitCell = cells.find(c => c.querySelector('span[id*="lblPermitNumber"]') !== null)
      const capDetailLink = permitCell?.querySelector('a[href*="CapDetail"]')
      if (capDetailLink) {
        detailPath = capDetailLink.getAttribute('href') ?? ''
      } else {
        // Build detail path from RecordId hidden input (e.g. "26EST-00000-23641")
        const recordIdInput = row.querySelector('input[id="RecordId"]') ||
                              row.querySelector('input[ID="RecordId"]')
        const recordId      = recordIdInput?.getAttribute('value') ?? ''
        if (recordId) {
          const parts = recordId.split('-')
          if (parts.length === 3) {
            const [c1, c2, c3] = parts
            detailPath = `/${agencyCode}/Cap/CapDetail.aspx?Module=${module}&TabName=${module}` +
                         `&capID1=${c1}&capID2=${c2}&capID3=${c3}` +
                         `&agencyCode=${agencyCode}&IsToShowInspection=`
          }
        }
      }
    } else {
      // Standard portal (Atlanta): permit number is <a> link text in PERMIT_COL cell
      if (cells.length < 8) continue
      const permitCell   = cells[PERMIT_COL]
      const permitLink   = permitCell?.querySelector('a')
      permitNumber = (permitLink?.text ?? permitCell?.text ?? '').trim()
      detailPath   = permitLink?.getAttribute('href') ?? ''
    }

    if (!permitNumber || !detailPath) continue

    // --- Record type ---
    const typeSpan = row.querySelector('span[id*="lblType"]')
    const recordType = (typeSpan
      ? typeSpan.text
      : (cells.length > TYPE_COL ? cells[TYPE_COL]?.text ?? '' : '')).trim()

    // --- Address ---
    const addrSpan = row.querySelector('span[id*="lblAddress"]') ||
                     row.querySelector('span[id*="lblLocation"]')
    const address = (addrSpan
      ? addrSpan.text
      : (cells.length > ADDR_COL ? cells[ADDR_COL]?.text ?? '' : '')).trim()

    // --- Description: project name span, Description col, or Permit Name col ---
    const projSpan = row.querySelector('span[id*="lblProjectName"]') ||
                     row.querySelector('span[id*="lblDescription"]')
    const description = projSpan
      ? projSpan.text.trim()
      : (cells.length > DESC_COL
          ? (cells[DESC_COL]?.text?.trim() || cells[PNAME_COL]?.text?.trim() || '')
          : '')

    // --- Status ---
    const statusSpan = row.querySelector('span[id*="lblStatus"]')
    const status = (statusSpan
      ? statusSpan.text
      : (cells.length > STATUS_COL ? cells[STATUS_COL]?.text ?? '' : '')).trim()

    results.push({ date: dateText, permitNumber, detailPath, recordType, address, description, status })
  }

  return results
}

/** Extract the __doPostBack target from the "Next >" pagination link.
 *
 * Also walks up the element tree to find the ASP.NET UpdatePanel that owns the pager
 * control.  This panel name must be used in the ctl00$ScriptManager1 field of the
 * pagination POST — if we reference the wrong panel the server silently ignores the
 * async trigger and returns a full-page response with no grid rows.
 *
 * ACA portals vary in whether they use single or double quotes in __doPostBack calls.
 * node-html-parser decodes HTML entities in attribute values, so &quot; → " —
 * the regex must accept both quote styles.
 */
interface NextPageInfo {
  target:    string   // __doPostBack target for the "Next >" link
  panelName: string   // UpdatePanel ID in ctl00$... dollar notation; empty if not found
}

function extractNextTarget(html: string): NextPageInfo | null {
  const root = parseHtml(html)
  for (const a of root.querySelectorAll('a')) {
    const text = a.text.trim()
    // Match "Next >" or "Next>" (some portals omit the space)
    if (text === 'Next >' || text === 'Next>') {
      const href = a.getAttribute('href') ?? ''
      // Accept single-quoted: __doPostBack('target','') or double-quoted: __doPostBack("target","")
      const m = href.match(/__doPostBack\(['"]([^'"]+)['"]/)
      if (!m) continue

      // Walk up the element tree to find the closest ancestor whose id contains "updatePanel".
      // On page 1 the full outer HTML is available so the wrapper div is present.
      // On page 2+ (UpdatePanel response) only the inner HTML is returned — in that case
      // panelName will be empty and the caller falls back to the last known panel name.
      let panelName = ''
      let el: NHtmlElement | null = a.parentNode as NHtmlElement | null
      while (el) {
        const id = (el as NHtmlElement).getAttribute?.('id') ?? ''
        if (id && /updatepanel/i.test(id)) {
          panelName = id.replace(/_/g, '$')
          break
        }
        el = el.parentNode as NHtmlElement | null
      }

      return { target: m[1], panelName }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Detail page parser — extract contractor from "Licensed Professional" section
// ---------------------------------------------------------------------------

interface ContractorInfo {
  contractorName:    string
  contractorPhone:   string | null
  contractorLicense: string | null
}

async function fetchContractorInfo(
  detailPath: string,
  cookieStr:  string,
): Promise<ContractorInfo> {
  const url = `${ACA_BASE_URL}${detailPath}`
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'Cookie':     cookieStr,
        'User-Agent': 'Mozilla/5.0 (compatible; LeadGenerator/1.0)',
      },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return { contractorName: '', contractorPhone: null, contractorLicense: null }
  }
  if (!res.ok) return { contractorName: '', contractorPhone: null, contractorLicense: null }

  return parseContractorSection(await res.text())
}

function parseContractorSection(html: string): ContractorInfo {
  const root = parseHtml(html)

  // Locate the section heading for "Licensed Professional:" (Atlanta) or "Applicant:" (GWINNETT).
  // ACA portal uses <h1> for section headings; check h1–h3 for robustness.
  let lpSection: NHtmlElement | null = null
  outer:
  for (const selector of ['h1', 'h2', 'h3']) {
    for (const heading of root.querySelectorAll(selector)) {
      const text = heading.text
      if (/licensed professional/i.test(text) || /\bapplicant\b/i.test(text)) {
        lpSection = heading.parentNode as NHtmlElement | null
        break outer
      }
    }
  }
  if (!lpSection) return { contractorName: '', contractorPhone: null, contractorLicense: null }

  // Convert inner HTML to plain text, using <br> and block-level tags as line breaks
  const innerHtml = lpSection.innerHTML
  const textBlock = innerHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|li|tr|td|th|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

  const lines = textBlock
    .split(/\n/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l && !/licensed professional|^applicant/i.test(l))

  if (lines.length === 0) return { contractorName: '', contractorPhone: null, contractorLicense: null }

  // Structure (from portal investigation 2026-03-10):
  //   lines[0] = individual name  (e.g. "STEPHEN DORLON HARVEY")
  //   lines[1] = business name    (e.g. "1 ELECTRIC, LLC")
  //   lines[2] = state license#   (e.g. "158412LGB")
  //   lines[3] = street address
  //   lines[4] = city, state, zip
  //   ...     "Home Phone:" → phone number
  //   ...     "Fax:" → fax number
  //   last    = city license type (e.g. "ELEC CONT EN213518")
  const line0 = lines[0] ?? ''
  const line1 = lines[1] ?? ''
  const line2 = lines[2] ?? ''

  // Prefer business name when it contains a business-type keyword
  const businessKw = /llc|inc|corp|electric|electrical|power|systems|services|contracting|contractors|group|co\./i
  const contractorName = (businessKw.test(line1) ? line1 : line0 || line1).trim()

  // State license: 4–15 uppercase alphanumeric chars with no spaces
  const contractorLicense = /^[A-Z0-9]{4,15}$/.test(line2.toUpperCase()) ? line2.toUpperCase() : null

  // Phone: find "Home Phone:" (Atlanta) or "Phone 1:" (GWINNETT) label.
  // Number may be on the same line (after the label) or on the next line.
  let contractorPhone: string | null = null
  for (let i = 0; i < lines.length; i++) {
    if (/home phone|phone\s*1/i.test(lines[i])) {
      const raw = lines[i].replace(/(?:home phone|phone\s*1)[:\s]*/i, '').replace(/\D/g, '')
      contractorPhone = raw.length >= 10 ? raw.slice(0, 10) : null
      if (!contractorPhone && lines[i + 1]) {
        const next = lines[i + 1].replace(/\D/g, '')
        contractorPhone = next.length >= 10 ? next.slice(0, 10) : null
      }
      break
    }
  }

  // Fallback: first 10-digit sequence found in the section
  if (!contractorPhone) {
    const m = lpSection.text.match(/\b(\d{10})\b/)
    if (m) contractorPhone = m[1]
  }

  return { contractorName, contractorPhone, contractorLicense }
}

// ---------------------------------------------------------------------------
// Paginated fetch for one permit type
// ---------------------------------------------------------------------------

async function fetchAllPagesForType(
  agencyCode:       string,
  module:           string,
  state:            SessionState,   // mutated in-place: cookies/VIEWSTATE updated after each POST
  permitType:       string,
  filterStartDate:  string,         // MM/DD/YYYY — used to filter rows client-side
  filterEndDate:    string,         // MM/DD/YYYY — used to filter rows client-side
): Promise<ListRow[]> {
  // Resolve option value for this permit type (e.g. "Building/Commercial/Electrical/NA")
  // Fall back to the text label if no mapping found (defensive).
  const permitTypeValue = state.permitTypeValues[permitType] ?? permitType

  // Prefer our custom 30-day filter window.  For portals that expose date inputs
  // (hasDates), we send filterStartDate/filterEndDate directly.  If the server
  // rejects them with a pageRedirect/Error (e.g. ASP.NET DateTime validation),
  // we automatically retry with the portal's own default dates (narrower window)
  // so we always get at least some results.
  // For portals without date inputs (e.g. GWINNETT), we skip date fields entirely
  // and apply filtering client-side.
  const hasDates      = !!state.startDateFieldName && !!state.endDateFieldName
  const postStartDate = hasDates ? filterStartDate : ''
  const postEndDate   = hasDates ? filterEndDate   : ''
  console.log(
    `[accela-aca] ${agencyCode}/${permitType}: posting with dates ${hasDates ? `${postStartDate} → ${postEndDate}` : '(no date filter — portal does not support it)'}`,
    `(portal defaults: ${state.defaultStartDate || 'none'} → ${state.defaultEndDate || 'none'})`,
  )

  // Build per-search extra fields; include date fields only if the portal has them.
  // Include ddlSearchType=0 (General Search) when the portal exposes that selector.
  const searchExtraFields: Record<string, string> = {
    'ctl00$ScriptManager1': `ctl00$PlaceHolderMain$updatePanel|${state.searchButtonTarget}`,
    __EVENTTARGET:          state.searchButtonTarget,
    [state.permitTypeFieldName]: permitTypeValue,
  }
  if (hasDates) {
    searchExtraFields[state.startDateFieldName] = postStartDate
    searchExtraFields[state.endDateFieldName]   = postEndDate
  }
  if (state.searchTypeFieldName) {
    searchExtraFields[state.searchTypeFieldName] = '0'   // '0' = General Search
  }

  // Initial search POST — async UpdatePanel request (btnNewSearch is an async trigger)
  let searchResult = await postCapHome(agencyCode, module, state, searchExtraFields, true)

  if (!searchResult) return []

  // If the server rejected our custom dates (ASP.NET DateTime validation error),
  // retry with the portal's own default dates.  This gives a narrower window
  // but guarantees at least some results rather than zero.
  if (hasDates && (/pageRedirect/.test(searchResult.html) || /Error\.aspx/i.test(searchResult.html))) {
    const fallbackStart = state.defaultStartDate || filterStartDate
    const fallbackEnd   = state.defaultEndDate   || filterEndDate
    console.warn(
      `[accela-aca] ${agencyCode}/${permitType}: custom dates caused server error — retrying with portal defaults (${fallbackStart} → ${fallbackEnd})`,
    )
    const retryFields = {
      ...searchExtraFields,
      [state.startDateFieldName]: fallbackStart,
      [state.endDateFieldName]:   fallbackEnd,
    }
    searchResult = await postCapHome(agencyCode, module, state, retryFields, true) ?? searchResult
  }

  // If still an error after retry, skip this type
  if (/pageRedirect/.test(searchResult.html) || /Error\.aspx/i.test(searchResult.html)) {
    console.warn(`[accela-aca] ${agencyCode}/${permitType}: server returned error/redirect — skipping type`)
    console.warn(`[accela-aca] ${agencyCode}/${permitType}: response snippet: ${searchResult.html.slice(0, 200)}`)
    return []
  }

  // Propagate updated session state for subsequent calls.
  // Also capture the results panel name for correct ScriptManager1 values in pagination POSTs.
  state.viewState       = searchResult.viewState
  state.eventValidation = searchResult.eventValidation
  state.acaCsField      = searchResult.acaCsField
  state.cookieStr       = searchResult.cookieStr
  const resultsPanelName = searchResult.resultsPanelName

  const filterStart = parseMDY(filterStartDate)
  const filterEnd   = parseMDY(filterEndDate)

  const allRows: ListRow[] = []
  let   currentHtml = searchResult.html
  let   page        = 1

  // The panel that owns the pager is detected from the "Next >" link's UpdatePanel ancestor
  // on the first page (where the wrapper div is present in the HTML).  We cache it here and
  // reuse for page 2+ because UpdatePanel responses only return inner HTML (no wrapper div).
  let paginationPanelName = resultsPanelName

  while (page <= MAX_PAGES) {
    const rows = parseListRows(currentHtml, agencyCode, module)
    if (rows.length === 0) {
      if (page === 1) {
        console.log(`[accela-aca] ${agencyCode}/${permitType}: 0 results on first page`)
      }
      break
    }

    // Filter rows to our 30-day window; results are newest-first so we can early-exit
    let allOlderThanWindow = true
    for (const row of rows) {
      const d = parseMDY(row.date)
      if (d && filterEnd   && d > filterEnd)   continue   // future / too recent? skip
      if (d && filterStart && d < filterStart) continue   // older than window: skip
      allRows.push(row)
      allOlderThanWindow = false
    }

    console.log(
      `[accela-aca] ${agencyCode}/${permitType}: page ${page} — ${rows.length} rows (in-window so far: ${allRows.length})`,
    )

    // Early-exit: all rows on this page predate our window → no need to paginate further
    if (allOlderThanWindow && page > 1) {
      console.log(`[accela-aca] ${agencyCode}/${permitType}: all rows on page ${page} predate window — stopping`)
      break
    }

    const nextInfo = extractNextTarget(currentHtml)
    if (!nextInfo) break  // no more pages

    // Latch the pagination panel from the first time we find the "Next >" link.
    // On page 1, the full outer HTML contains the UpdatePanel wrapper div so we can detect it.
    // On page 2+, the server returns only the panel's inner HTML so panelName will be empty —
    // in that case we keep using the panel we found on page 1.
    if (nextInfo.panelName) paginationPanelName = nextInfo.panelName

    // Build pagination extra fields; include date and search-type fields as applicable.
    // ctl00$ScriptManager1 MUST reference the panel that owns the pager control, NOT the
    // outer search panel — sending the wrong panel name causes the server to discard the
    // async trigger and return a full-page (or empty) response.
    const pageExtraFields: Record<string, string> = {
      __EVENTTARGET:               nextInfo.target,
      [state.permitTypeFieldName]: permitTypeValue,
      'ctl00$ScriptManager1':      `${paginationPanelName}|${nextInfo.target}`,
    }
    if (hasDates) {
      pageExtraFields[state.startDateFieldName] = postStartDate
      pageExtraFields[state.endDateFieldName]   = postEndDate
    }
    if (state.searchTypeFieldName) {
      pageExtraFields[state.searchTypeFieldName] = '0'
    }

    // Pagination POST — uses __doPostBack which triggers an UpdatePanel AJAX refresh
    const nextResult = await postCapHome(agencyCode, module, state, pageExtraFields, true)

    if (!nextResult) break

    state.viewState       = nextResult.viewState
    state.eventValidation = nextResult.eventValidation
    state.acaCsField      = nextResult.acaCsField
    state.cookieStr       = nextResult.cookieStr
    currentHtml           = nextResult.html
    page++
  }

  return allRows
}

// ---------------------------------------------------------------------------
// Main adapter
// ---------------------------------------------------------------------------

export async function accelaAcaAdapter(agencyCode: AcaAgencyCode, daysBack = 30): Promise<NormalizedPermit[]> {
  const config    = ACA_AGENCY_CONFIG[agencyCode]
  const endDate   = toMDY(new Date())
  const startDate = toMDY(new Date(Date.now() - daysBack * 24 * 60 * 60 * 1_000))

  console.log(`[accela-aca] ${agencyCode}: starting scrape (${startDate} → ${endDate})`)

  const state = await initSession(agencyCode, config.module)
  if (!state) {
    console.warn(`[accela-aca] ${agencyCode}: session init failed — returning []`)
    return []
  }

  // Collect list rows across all permit types; deduplicate by permitNumber
  const seen    = new Set<string>()
  const allRows: ListRow[] = []

  for (const permitType of config.permitTypeLabels) {
    const rows = await fetchAllPagesForType(agencyCode, config.module, state, permitType, startDate, endDate)
    for (const row of rows) {
      if (!seen.has(row.permitNumber)) {
        seen.add(row.permitNumber)
        allRows.push(row)
      }
    }
  }

  console.log(`[accela-aca] ${agencyCode}: ${allRows.length} unique permits — fetching contractor details`)

  // Fetch detail pages for contractor info (one GET per permit)
  const results: NormalizedPermit[] = []
  let hasLoggedSample = false

  for (const row of allRows) {
    try {
      await new Promise(r => setTimeout(r, DETAIL_DELAY_MS))

      const contractor = await fetchContractorInfo(row.detailPath, state.cookieStr)

      if (!hasLoggedSample) {
        console.log(
          `[accela-aca] ${agencyCode} sample:`,
          JSON.stringify({ row, contractor }, null, 2),
        )
        hasLoggedSample = true
      }

      if (!contractor.contractorName) {
        console.warn(`[accela-aca] ${agencyCode}: skip ${row.permitNumber} — no contractor`)
        continue
      }

      const filedAt = parseMDY(row.date)
      if (!filedAt) {
        console.warn(`[accela-aca] ${agencyCode}: skip ${row.permitNumber} — unparseable date: ${row.date}`)
        continue
      }

      const residential = isResidential(row.description) || /residential/i.test(row.recordType)

      results.push({
        source:            config.source,
        externalId:        row.permitNumber,
        permitNumber:      row.permitNumber,
        permitType:        'ELECTRICAL',
        description:       row.description || null,
        status:            normalizeStatus(row.status),
        jobAddress:        row.address || null,
        county:            config.county,
        jobValue:          null,   // not publicly available on ACA portal
        isResidential:     residential,
        filedAt,
        issuedAt:          null,   // available on detail page but not extracted yet
        inspectionAt:      null,
        closedAt:          null,
        contractorName:    contractor.contractorName,
        contractorPhone:   contractor.contractorPhone,
        contractorLicense: contractor.contractorLicense,
      })
    } catch (err) {
      console.warn(`[accela-aca] ${agencyCode}: error processing ${row.permitNumber}:`, err)
      // Never throw — skip and continue
    }
  }

  console.log(
    `[accela-aca] ${agencyCode}: complete — ${results.length} permits with contractor data`,
  )
  return results
}
