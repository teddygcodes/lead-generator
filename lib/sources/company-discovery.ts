/**
 * CompanyDiscoveryAdapter — discovers new electrical company candidates via Accela
 * building permit searches across multiple Georgia jurisdictions.
 *
 * sourceType = 'COMPANY_DISCOVERY'
 * signalType = 'DISCOVERY'
 *
 * Live sources (all public, no auth required):
 *   - City of Atlanta (ATLANTA_GA) — ELEC CONT license type filter
 *   - Gwinnett County (GWINNETT) — Electrical Contractor - Non-Restricted license type filter
 *   - Hall County (HALLCO) — Electrical license type filter
 *
 * Each source: GET search form → extract __VIEWSTATE → POST with license type filter →
 * parse result table → paginate up to ACCELA_MAX_SEARCH_PAGES → GET each detail page →
 * parse Licensed Professional section. Rate-limited to 1.5s between requests.
 *
 * Additional sources (stubbed — see demoReason per module):
 *   - GA SOS GOALS licensee search (goals.sos.ga.gov) — blocked by reCAPTCHA v2
 *   - AECA member directory (atlantaelectrical.org) — accessibility not verified
 *
 * isDemoMode = false means at least one source is configured for live access.
 * It does NOT guarantee a particular run produced results. Failed runs return recordsFound: 0
 * and log warnings without claiming live success.
 */

import type {
  SourceAdapter,
  DiscoverResult,
  DetailResult,
  NormalizedRecord,
  PersistResult,
} from './base'
import { normalizeName } from '@/lib/normalization'
import { scoreCompany } from '@/lib/scoring'
import { db } from '@/lib/db'

// Rate limiting: applied to ALL Accela page fetches
const ACCELA_REQUEST_DELAY_MS = 1500

// Max pages of search results to paginate per source per run.
// Each page has ~10 permit rows. Default 5 → up to 50 permits/source → ~20-30 unique contractors.
// Override per-run via params.maxPages passed to discover().
const ACCELA_MAX_SEARCH_PAGES = 5

// How far back to query permits
const ACCELA_LOOKBACK_DAYS = 90

// Fit filter: required terms (at least one must appear in the company name).
// 'power' intentionally excluded — too noisy (utilities, energy firms, industrial equipment).
const FIT_REQUIRED = ['electric', 'electrical', 'electr']

// Fit filter: denylist — any of these terms in the name disqualifies the candidate.
const FIT_DENYLIST = [
  'utility',
  'utilities',
  'cooperative',
  'co-op',
  'co op',
  'generation',
  'solar farm',
  'wind farm',
  'manufacturer',
  'manufacturing',
  'distributor',
  'distribution',
  'holding',
  'holdings',
  'investment',
  'properties',
  'charging network',
  'charging station',
]

function passesNameFilter(name: string): boolean {
  const lower = name.toLowerCase()
  const hasFitTerm = FIT_REQUIRED.some((t) => lower.includes(t))
  const hasDisqualifier = FIT_DENYLIST.some((t) => lower.includes(t))
  return hasFitTerm && !hasDisqualifier
}

// City-to-county lookup for GA target counties.
// Keys are lowercase — normalize before lookup.
// Only covers target counties; unknown cities yield undefined (no county assigned).
const GA_CITY_COUNTY: Record<string, string> = {
  // Gwinnett County
  lawrenceville: 'Gwinnett',
  duluth: 'Gwinnett',
  norcross: 'Gwinnett',
  snellville: 'Gwinnett',
  suwanee: 'Gwinnett',
  buford: 'Gwinnett',
  lilburn: 'Gwinnett',
  loganville: 'Gwinnett',
  grayson: 'Gwinnett',
  dacula: 'Gwinnett',
  // Hall County
  gainesville: 'Hall',
  'flowery branch': 'Hall',
  oakwood: 'Hall',
  braselton: 'Hall',
  lula: 'Hall',
  clermont: 'Hall',
  // Forsyth County
  cumming: 'Forsyth',
  // Cobb County
  marietta: 'Cobb',
  smyrna: 'Cobb',
  kennesaw: 'Cobb',
  acworth: 'Cobb',
  austell: 'Cobb',
  'powder springs': 'Cobb',
  mableton: 'Cobb',
  vinings: 'Cobb',
  // Fulton County
  atlanta: 'Fulton',
  alpharetta: 'Fulton',
  roswell: 'Fulton',
  'sandy springs': 'Fulton',
  'johns creek': 'Fulton',
  milton: 'Fulton',
  'east point': 'Fulton',
  'college park': 'Fulton',
  // Cherokee County
  canton: 'Cherokee',
  woodstock: 'Cherokee',
  'ball ground': 'Cherokee',
  'holly springs': 'Cherokee',
  waleska: 'Cherokee',
}

/** Raw data extracted from an Accela permit detail page. */
interface AccelaPermitRaw {
  recordNumber: string // permit ID — used as sourceId and cache key
  recordType: string // e.g., "Commercial - Electrical"
  permitAddress: string // project site address (not used for company location)
  businessName: string // contractor company name, e.g., "ARQ GROUP LLC"
  licenseeName: string // individual licensee, e.g., "IVAN MARTINEZ"
  licenseNumber: string // e.g., "26012" — stable per contractor
  licenseCert: string // e.g., "ER102505"
  licenseType: string // e.g., "ELEC CONT" or "Electrical Contractor - Non-Restricted"
  phone: string
  street: string // contractor street address, e.g., "132 CAPUTI DR"
  city: string // contractor city, e.g., "ALTO"
  state: string // contractor state abbreviation, e.g., "GA"
  zip: string // contractor 5-digit zip, e.g., "30510"
  detailPageUrl: string
  sourceSlug: string // e.g., 'atlanta-ga', 'gwinnett', 'hallco'
  sourceName: string // e.g., 'City of Atlanta Building Permits (Accela)'
}

/** Configuration for a single Accela permit search source. */
interface AccelaSourceConfig {
  agencyCode: string // e.g., 'GWINNETT', 'HALLCO', 'ATLANTA_GA'
  sourceName: string // display name stored in signal metadata
  sourceSlug: string // stable slug for metadata.source — never derived at runtime
  licenseTypeFilter: string // value for the License Type dropdown POST field
}

// --- HTML parsing helpers ----------------------------------------------------

/** Extract all hidden form inputs (name → value) from an HTML string. */
function extractHiddenInputs(html: string): Record<string, string> {
  const inputs: Record<string, string> = {}
  for (const [tag] of html.matchAll(/<input[^>]+type=["']hidden["'][^>]*>/gi)) {
    const nameM = tag.match(/name=["']([^"']+)["']/)
    const valM = tag.match(/value=["']([^"']*)["']/)
    if (nameM) {
      inputs[nameM[1]] = valM ? valM[1] : ''
    }
  }
  return inputs
}

/**
 * Find the license type select field name in an Accela search form.
 * Primary strategy: match the standard Accela field name pattern `ddlGSLicenseType`.
 * Fallback: find the select whose options include the provided filterValue.
 * This handles variation across agency portals (Atlanta uses "ELEC CONT",
 * Gwinnett uses "Electrical Contractor - Non-Restricted", Hall uses "Electrical").
 */
function findLicenseTypeFieldName(html: string, filterValue: string): string | undefined {
  // Primary: all Accela portals use ddlGSLicenseType as the license type dropdown field name
  const namePatternM = html.match(/name=["']([^"']*ddlGSLicenseType[^"']*)["']/i)
  if (namePatternM) return namePatternM[1]

  // Fallback: find select whose options include the specific filter value
  for (const m of html.matchAll(/<select[^>]+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi)) {
    if (m[2].includes(filterValue)) {
      return m[1]
    }
  }
  return undefined
}

/**
 * Find date input field names for start/end date filtering.
 * Returns { start, end } field names or undefined if not found.
 */
function findDateFieldNames(html: string): { start: string; end: string } | undefined {
  const dateFromM = html.match(/name=["']([^"']*(?:DateFrom|StartDate|From)[^"']*)["']/i)
  const dateToM = html.match(/name=["']([^"']*(?:DateTo|EndDate|To)[^"']*)["']/i)
  if (dateFromM && dateToM) {
    return { start: dateFromM[1], end: dateToM[1] }
  }
  return undefined
}

/**
 * Extract permit detail capID triples from a search results HTML page.
 * Links to detail pages contain: capID1=X&capID2=Y&capID3=Z
 * Returns up to maxResults results.
 */
function extractPermitDetailIds(
  html: string,
  maxResults: number,
): Array<{ capID1: string; capID2: string; capID3: string }> {
  const results: Array<{ capID1: string; capID2: string; capID3: string }> = []
  const seen = new Set<string>()
  for (const m of html.matchAll(
    /capID1=([^&"'\s]+)&(?:amp;)?capID2=([^&"'\s]+)&(?:amp;)?capID3=([^&"'\s]+)/gi,
  )) {
    if (results.length >= maxResults) break
    const key = `${m[1]}:${m[2]}:${m[3]}`
    if (!seen.has(key)) {
      seen.add(key)
      results.push({ capID1: m[1], capID2: m[2], capID3: m[3] })
    }
  }
  return results
}

/**
 * Find the __EVENTTARGET for the next-page pager link in Accela search results.
 *
 * Accela pager links are inside a table with class "aca_pagination" / "ACA_Table_Pages".
 * The href attributes HTML-entity-encode single quotes as &#39;, so standard postback
 * regex won't match them. We decode those entities before searching.
 *
 * Strategy: find an <a> link whose text is `currentPage + 1` and extract its doPostBack target.
 * Falls back to finding a ">" / next-arrow link if numbered link not found.
 *
 * Returns undefined when on the last page (no next link exists).
 */
function extractPagerNextTarget(html: string, currentPage: number): string | undefined {
  // Decode HTML-entity-encoded single quotes used by Accela in href attributes
  const decoded = html.replace(/&#39;/g, "'")

  // Locate the pagination section
  const pagerIdx = decoded.search(/ACA_Table_Pages|aca_pagination/i)
  if (pagerIdx === -1) return undefined
  const pagerArea = decoded.slice(pagerIdx, pagerIdx + 4000)

  const nextPageNum = currentPage + 1

  // Collect all doPostBack links in pager area with their stripped text content
  for (const m of pagerArea.matchAll(
    /<a[^>]+href="javascript:__doPostBack\('([^']+)'\s*,\s*'[^']*'\)"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const target = m[1]
    // Strip inner HTML tags and decode entities to get plain text
    const text = m[2]
      .replace(/<[^>]+>/g, '')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&')
      .trim()

    // Method 1: link text is exactly the next page number
    if (/^\d+$/.test(text) && parseInt(text) === nextPageNum) return target

    // Method 2: "Next" or ">" arrow link — return first one found
    if (/^(next|>|›|»)/i.test(text)) return target
  }

  return undefined
}

/**
 * Parse the "Licensed Professional" section from an Accela detail page.
 * Locates the table with id containing "licensedps", finds the data <td>,
 * and splits on <br> tags to extract fields by position:
 *   [0] individual name, [1] business name, [2] license number,
 *   [3] street, [4] "City, ST, Zip", [5+] phone (10 digits) or license cert
 *
 * Example (verified in browser against permit BE-202601507):
 *   IVAN MARTINEZ → ARQ GROUP LLC → 26012 → 132 CAPUTI DR → ALTO, GA, 30510 → ELEC CONT ER102505
 *
 * Works across all Accela portals — the tbl_licensedps HTML structure is standardized.
 */
function parseLicensedProfessional(html: string): {
  licenseeName: string
  businessName: string
  licenseNumber: string
  street: string
  city: string
  state: string
  zip: string
  phone: string
  licenseCert: string
  licenseType: string
} | null {
  // Locate the table with id containing "licensedps"
  const tableStart = html.search(/id=["'][^"']*licensedps[^"']*["']/i)
  if (tableStart === -1) return null

  // Extract table content around the anchor
  const tableSection = html.slice(Math.max(0, tableStart - 50), tableStart + 3000)

  // Find the data <td> — the one containing <br> separators (not the left spacer td)
  const tdMatches = tableSection.match(/<td(?:\s[^>]*)?>[\s\S]*?<\/td>/gi) ?? []
  const dataTd =
    tdMatches.find((td) => td.includes('<br>') || td.includes('<br/>')) ?? tdMatches[1]
  if (!dataTd) return null

  // Split on <br> to get individual lines, strip remaining tags and decode entities
  const lines = dataTd
    .split(/<br\s*\/?>/gi)
    .map((line) =>
      line
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#\d+;/g, ' ')
        .trim(),
    )
    .filter((line) => line.length > 0)

  if (lines.length < 2) return null

  // Positional extraction
  const licenseeName = lines[0] ?? ''
  const businessName = lines[1] ?? ''
  const licenseNumber = lines[2] ?? ''
  const street = lines[3] ?? ''
  const cityStateZip = lines[4] ?? '' // e.g., "ALTO, GA, 30510" or "City, ST Zip"

  // Parse city/state/zip — format is "City, ST, Zip" or "City, ST Zip"
  const cszParts = cityStateZip.split(',').map((p) => p.trim())
  let city = ''
  let state = 'GA'
  let zip = ''
  if (cszParts.length >= 3) {
    // "City, ST, Zip"
    city = cszParts[0]
    state = cszParts[1].replace(/\d/g, '').trim() || 'GA'
    zip = cszParts[2].replace(/\D/g, '').slice(0, 5)
  } else if (cszParts.length === 2) {
    // "City, ST Zip" or "City, ST"
    city = cszParts[0]
    const stZip = cszParts[1].trim()
    const stZipM = stZip.match(/^([A-Z]{2})\s+(\d{5})/)
    if (stZipM) {
      state = stZipM[1]
      zip = stZipM[2]
    } else {
      state = stZip.slice(0, 2) || 'GA'
    }
  }

  // Scan remaining lines for phone (exactly 10 digits) and license cert.
  // Handles both Atlanta "ELEC CONT" format and Gwinnett/Hall "Electrical Contractor" format.
  const remainingLines = lines.slice(5)
  let phone = ''
  let licenseCert = ''
  let licenseType = ''
  for (const line of remainingLines) {
    if (/^\d{10}$/.test(line)) {
      phone = line
    } else if (/ELEC\s*CONT|Electrical\s+Contractor/i.test(line) && !licenseCert) {
      const certM = line.match(/([A-Z]{2,3}\d{4,8})/i)
      licenseCert = certM ? certM[1].toUpperCase() : ''
      licenseType = line.trim()
    }
  }

  return { licenseeName, businessName, licenseNumber, street, city, state, zip, phone, licenseCert, licenseType }
}

// --- Source factory ----------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Create an Accela permit search source for a given Georgia jurisdiction.
 * All Accela portals share the same HTML structure and POST mechanics —
 * only the agency code and license type filter value differ.
 */
function createAccelaSource(config: AccelaSourceConfig) {
  const accelaBase = `https://aca-prod.accela.com/${config.agencyCode}`
  const accelaHome = `${accelaBase}/Cap/CapHome.aspx?module=Building`

  return {
    liveMode: true as const,
    sourceName: config.sourceName,
    sourceSlug: config.sourceSlug,
    sourceUrl: accelaHome,

    async discover(params?: Record<string, unknown>): Promise<AccelaPermitRaw[]> {
      const maxSearchPages =
        typeof params?.maxPages === 'number' ? params.maxPages : ACCELA_MAX_SEARCH_PAGES

      try {
        // Step 1: GET the search form page — extract ViewState + session cookie
        const homeResp = await fetch(accelaHome, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        })
        if (!homeResp.ok) {
          console.warn(`[accela:${config.sourceSlug}] GET home failed: ${homeResp.status}`)
          return []
        }

        const setCookieHeader = homeResp.headers.get('set-cookie') ?? ''
        const homeHtml = await homeResp.text()
        const hiddenInputs = extractHiddenInputs(homeHtml)
        const licenseFieldName = findLicenseTypeFieldName(homeHtml, config.licenseTypeFilter)

        if (!hiddenInputs['__VIEWSTATE']) {
          console.warn(
            `[accela:${config.sourceSlug}] __VIEWSTATE not found on home page — layout may have changed`,
          )
          return []
        }

        await sleep(ACCELA_REQUEST_DELAY_MS)

        // Step 2: POST search with configured license type filter
        const endDate = new Date()
        const startDate = new Date()
        startDate.setDate(endDate.getDate() - ACCELA_LOOKBACK_DAYS)
        const fmt = (d: Date) =>
          `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`

        const formData = new URLSearchParams()
        for (const [k, v] of Object.entries(hiddenInputs)) {
          formData.set(k, v)
        }
        if (licenseFieldName) {
          formData.set(licenseFieldName, config.licenseTypeFilter)
        }
        const dateFields = findDateFieldNames(homeHtml)
        if (dateFields) {
          formData.set(dateFields.start, fmt(startDate))
          formData.set(dateFields.end, fmt(endDate))
        }
        // Trigger via __EVENTTARGET — the search link calls
        // WebForm_DoPostBackWithOptions("ctl00$PlaceHolderMain$btnNewSearch", ...)
        formData.set('__EVENTTARGET', 'ctl00$PlaceHolderMain$btnNewSearch')
        formData.set('__EVENTARGUMENT', '')

        const sessionCookieStr = setCookieHeader
          .split(/,(?=\s*\w+=)/)
          .map((c) => c.split(';')[0])
          .join('; ')

        const searchResp = await fetch(accelaHome, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            Cookie: sessionCookieStr,
            Referer: accelaHome,
          },
          body: formData.toString(),
        })
        if (!searchResp.ok) {
          console.warn(`[accela:${config.sourceSlug}] POST search failed: ${searchResp.status}`)
          return []
        }

        let currentPageHtml = await searchResp.text()
        let currentPageCookieHeader = searchResp.headers.get('set-cookie') ?? setCookieHeader

        // Step 3: Paginate through search results collecting all unique capID triples.
        // Accela pager links encode single quotes as &#39; — handled by extractPagerNextTarget.
        // Each page POST uses the __VIEWSTATE from the previous results page.
        const allCapIdSet = new Set<string>()
        const allCapIds: Array<{ capID1: string; capID2: string; capID3: string }> = []

        for (let pageNum = 1; pageNum <= maxSearchPages; pageNum++) {
          const pageCapIds = extractPermitDetailIds(currentPageHtml, 25)
          for (const id of pageCapIds) {
            const key = `${id.capID1}:${id.capID2}:${id.capID3}`
            if (!allCapIdSet.has(key)) {
              allCapIdSet.add(key)
              allCapIds.push(id)
            }
          }

          if (pageNum === maxSearchPages) break // reached page cap

          const nextTarget = extractPagerNextTarget(currentPageHtml, pageNum)
          if (!nextTarget) break // no more pages

          await sleep(ACCELA_REQUEST_DELAY_MS)

          // POST pager using __VIEWSTATE from current results page
          const pageViewState = extractHiddenInputs(currentPageHtml)
          const pagerFormData = new URLSearchParams()
          for (const [k, v] of Object.entries(pageViewState)) {
            pagerFormData.set(k, v)
          }
          pagerFormData.set('__EVENTTARGET', nextTarget)
          pagerFormData.set('__EVENTARGUMENT', '')

          const pageCookieStr = currentPageCookieHeader
            .split(/,(?=\s*\w+=)/)
            .map((c) => c.split(';')[0])
            .join('; ')

          const pagerResp = await fetch(accelaHome, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
              Accept:
                'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
              Cookie: pageCookieStr,
              Referer: accelaHome,
            },
            body: pagerFormData.toString(),
          })

          if (!pagerResp.ok) {
            console.warn(
              `[accela:${config.sourceSlug}] page ${pageNum + 1} fetch failed: ${pagerResp.status} — stopping pagination`,
            )
            break
          }

          currentPageHtml = await pagerResp.text()
          currentPageCookieHeader = pagerResp.headers.get('set-cookie') ?? currentPageCookieHeader
        }

        if (allCapIds.length === 0) {
          console.warn(
            `[accela:${config.sourceSlug}] No permit IDs found in search results — table layout may have changed`,
          )
          return []
        }

        console.log(
          `[accela:${config.sourceSlug}] Found ${allCapIds.length} permit IDs across ${Math.min(maxSearchPages, Math.ceil(allCapIds.length / 10))} page(s) — fetching detail pages`,
        )

        // Step 4: GET each detail page and parse Licensed Professional section
        const detailCookie = currentPageCookieHeader
          .split(/,(?=\s*\w+=)/)
          .map((c) => c.split(';')[0])
          .join('; ')

        const results: AccelaPermitRaw[] = []

        for (const { capID1, capID2, capID3 } of allCapIds) {
          await sleep(ACCELA_REQUEST_DELAY_MS)

          const recordNumber = `${config.sourceSlug}:${capID1}-${capID2}-${capID3}`
          const detailUrl =
            `${accelaBase}/Cap/CapDetail.aspx` +
            `?Module=Building&TabName=Building` +
            `&capID1=${capID1}&capID2=${capID2}&capID3=${capID3}` +
            `&agencyCode=${config.agencyCode}`

          try {
            const detailResp = await fetch(detailUrl, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                Accept:
                  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                Cookie: detailCookie,
                Referer: accelaHome,
              },
            })
            if (!detailResp.ok) {
              console.warn(
                `[accela:${config.sourceSlug}] detail page ${recordNumber} returned ${detailResp.status}`,
              )
              continue
            }

            const detailHtml = await detailResp.text()
            const lp = parseLicensedProfessional(detailHtml)
            if (!lp || !lp.businessName) {
              console.warn(
                `[accela:${config.sourceSlug}] No Licensed Professional / business name found for ${recordNumber}`,
              )
              continue
            }

            results.push({
              recordNumber,
              recordType: '',
              permitAddress: '',
              businessName: lp.businessName,
              licenseeName: lp.licenseeName,
              licenseNumber: lp.licenseNumber,
              licenseCert: lp.licenseCert,
              licenseType: lp.licenseType || config.licenseTypeFilter,
              phone: lp.phone,
              street: lp.street,
              city: lp.city,
              state: lp.state || 'GA',
              zip: lp.zip,
              detailPageUrl: detailUrl,
              sourceSlug: config.sourceSlug,
              sourceName: config.sourceName,
            })
          } catch (err) {
            console.warn(
              `[accela:${config.sourceSlug}] Failed to fetch/parse detail ${recordNumber}:`,
              err,
            )
          }
        }

        return results
      } catch (err) {
        console.warn(`[accela:${config.sourceSlug}] source unavailable:`, err)
        return []
      }
    },
  }
}

// --- Source instances --------------------------------------------------------

const atlantaSource = createAccelaSource({
  agencyCode: 'ATLANTA_GA',
  sourceSlug: 'atlanta-ga',
  sourceName: 'City of Atlanta Building Permits (Accela)',
  licenseTypeFilter: 'ELEC CONT',
})

const gwinnettSource = createAccelaSource({
  agencyCode: 'GWINNETT',
  sourceSlug: 'gwinnett',
  sourceName: 'Gwinnett County Building Permits (Accela)',
  licenseTypeFilter: 'Electrical Contractor - Non-Restricted',
})

const hallCountySource = createAccelaSource({
  agencyCode: 'HALLCO',
  sourceSlug: 'hallco',
  sourceName: 'Hall County Building Permits (Accela)',
  licenseTypeFilter: 'Electrical',
})

/**
 * GA SOS GOALS electrical contractor lookup.
 * Portal confirmed: goals.sos.ga.gov/GASOSOneStop/s/licensee-search
 * "Electrical Contractors" and "Low Voltage Contractors" profession types confirmed in browser.
 * Deferred: blocked by reCAPTCHA v2 and Salesforce Aura session tokens.
 */
const gaLicenseModule = {
  liveMode: false as const,
  demoReason:
    'GA SOS electrical contractor lookup (goals.sos.ga.gov/GASOSOneStop/s/licensee-search) blocked by reCAPTCHA v2 and Salesforce Aura session tokens. Correct portal confirmed in browser with Electrical Contractors and Low Voltage Contractors profession types. Deferred due to reCAPTCHA and session complexity.',
  async discover(): Promise<AccelaPermitRaw[]> {
    return []
  },
}

/**
 * AECA member directory.
 * Portal: atlantaelectrical.org
 * Deferred: accessibility not verified.
 */
const aecaModule = {
  liveMode: false as const,
  demoReason: 'AECA member directory (atlantaelectrical.org) accessibility not verified.',
  async discover(): Promise<AccelaPermitRaw[]> {
    return []
  },
}

// --- Adapter -----------------------------------------------------------------

export class CompanyDiscoveryAdapter implements SourceAdapter {
  sourceType = 'COMPANY_DISCOVERY'
  isDemoMode: boolean
  demoReason: string | undefined

  // Populated during discover(), consumed by fetchDetails() and normalize().
  // Cleared at the start of each discover() call.
  private _cache = new Map<string, AccelaPermitRaw>()

  constructor() {
    // isDemoMode = false means "at least one source is configured for live access".
    // It does NOT guarantee a particular run produced results — runs that fail honestly
    // return recordsFound: 0 and log warnings without claiming live success.
    // When anyLive = true, demoReason = undefined (adapter is live-capable).
    // Stub modules keep their demoReason strings for documentation only —
    // they do NOT drive adapter isDemoMode.
    const liveModules = [atlantaSource, gwinnettSource, hallCountySource]
    const stubModules = [gaLicenseModule, aecaModule]
    const anyLive = liveModules.some((m) => m.liveMode)
    this.isDemoMode = !anyLive
    this.demoReason = !anyLive ? stubModules.map((m) => m.demoReason).join(' | ') : undefined
  }

  /**
   * Discover electrical contractor candidates from all configured live sources.
   * Sources run concurrently. A failed source is logged as a warning and does not
   * halt discovery — other sources continue and contribute their results.
   * Stubs return [] immediately and are not listed in Promise.allSettled.
   */
  async discover(params?: Record<string, unknown>): Promise<DiscoverResult[]> {
    this._cache.clear()

    const [atlantaResult, gwinnettResult, hallResult] = await Promise.allSettled([
      atlantaSource.discover(params),
      gwinnettSource.discover(params),
      hallCountySource.discover(params),
      // gaLicenseModule — stub, always returns []
      // aecaModule — stub, always returns []
    ])

    const raw: AccelaPermitRaw[] = [
      ...(atlantaResult.status === 'fulfilled' ? atlantaResult.value : []),
      ...(gwinnettResult.status === 'fulfilled' ? gwinnettResult.value : []),
      ...(hallResult.status === 'fulfilled' ? hallResult.value : []),
    ]

    if (atlantaResult.status === 'rejected') {
      console.warn('[company-discovery] atlanta source failed:', atlantaResult.reason)
    }
    if (gwinnettResult.status === 'rejected') {
      console.warn('[company-discovery] gwinnett source failed:', gwinnettResult.reason)
    }
    if (hallResult.status === 'rejected') {
      console.warn('[company-discovery] hallco source failed:', hallResult.reason)
    }

    const seen = new Set<string>()
    const results: DiscoverResult[] = []

    for (const permit of raw) {
      const name = permit.businessName || permit.licenseeName
      if (!name) continue
      if (!passesNameFilter(name)) continue

      const dedupeKey = `${normalizeName(name)}::${permit.city.toLowerCase().trim()}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      this._cache.set(permit.recordNumber, permit)
      results.push({
        sourceId: permit.recordNumber,
        name,
        metadata: {
          city: permit.city || undefined,
          source: permit.sourceSlug,
          liveMode: true,
        },
      })
    }

    return results
  }

  /**
   * Return cached Accela data from discover() — no external calls.
   */
  async fetchDetails(sourceId: string): Promise<DetailResult | null> {
    const cached = this._cache.get(sourceId)
    if (!cached) return null
    return { sourceId, rawData: cached as unknown as Record<string, unknown> }
  }

  /**
   * Normalize an Accela permit record to a standard company record.
   * Reads directly from _cache (typed Map<string, AccelaPermitRaw>) — no cross-type cast.
   */
  normalize(raw: DetailResult): NormalizedRecord {
    const data = this._cache.get(raw.sourceId)!
    const name = data.businessName || data.licenseeName
    const city = data.city || undefined
    const state = data.state || 'GA'
    const zip = data.zip || undefined
    const street = data.street || undefined
    const cityKey = city?.toLowerCase()
    const county = cityKey ? (GA_CITY_COUNTY[cityKey] ?? undefined) : undefined

    return {
      name,
      normalizedName: normalizeName(name),
      city,
      state,
      zip,
      street,
      phone: data.phone || undefined,
      county,
      sourceType: this.sourceType,
      sourceName: data.sourceName,
      sourceUrl: data.detailPageUrl || undefined,
    }
  }

  /**
   * Persist normalized discovery records.
   *
   * Demo mode: no DB writes — returns zeros immediately.
   *
   * Live mode:
   * 1. Apply name fit filter — skip disqualified names
   * 2. Dedupe with city: normalizedName + city (case-insensitive) when city available;
   *    name-only only when city is absent, and only if exactly 1 unambiguous match exists
   * 3. Existing company: create DISCOVERY signal if not already present for this source slug
   * 4. New company: create Company (DISCOVERED) + DISCOVERY signal
   *
   * Signal dedup uses metadata.source (sourceSlug) — one DISCOVERY signal per source per
   * company. This is appropriate for company identity dedup. For per-permit activity lineage,
   * the dedup key would need to change to recordNumber (permit ID) in a future pass.
   */
  async persist(records: NormalizedRecord[]): Promise<PersistResult> {
    if (this.isDemoMode) {
      return { created: 0, updated: 0, skipped: 0, errors: [] }
    }

    let created = 0
    let updated = 0
    let skipped = 0
    const errors: string[] = []

    for (const record of records) {
      try {
        // 1. Fit filter
        if (!passesNameFilter(record.name)) {
          skipped++
          continue
        }

        const normalizedName = record.normalizedName ?? normalizeName(record.name)

        // Retrieve license number and source info from cache
        const cachedPermit = record.sourceUrl
          ? Array.from(this._cache.values()).find((p) => p.detailPageUrl === record.sourceUrl)
          : undefined
        const licenseNumber = cachedPermit?.licenseNumber ?? ''
        const sourceSlug = cachedPermit?.sourceSlug ?? 'accela'
        const sourceName = cachedPermit?.sourceName ?? record.sourceName ?? 'Accela Permit Search'

        // 2. Dedupe with city
        let existingCompany: { id: string } | null = null

        if (record.city) {
          existingCompany = await db.company.findFirst({
            where: {
              normalizedName,
              city: { equals: record.city, mode: 'insensitive' },
            },
            select: { id: true },
          })
        } else {
          const matches = await db.company.findMany({
            where: { normalizedName },
            select: { id: true },
            take: 2,
          })
          if (matches.length === 1) {
            existingCompany = matches[0]
          } else if (matches.length > 1) {
            skipped++
            continue
          }
        }

        if (existingCompany) {
          // Existing company — add DISCOVERY signal if not already present for this source slug
          const existingSignal = await db.signal.findFirst({
            where: {
              companyId: existingCompany.id,
              signalType: 'DISCOVERY',
              metadata: { path: ['source'], equals: sourceSlug },
            },
          })
          if (existingSignal) {
            skipped++
            continue
          }

          await db.signal.create({
            data: {
              companyId: existingCompany.id,
              sourceType: 'COMPANY_DISCOVERY',
              sourceName,
              sourceUrl: record.sourceUrl ?? undefined,
              signalType: 'DISCOVERY',
              signalDate: new Date(),
              county: record.county ?? undefined,
              city: record.city ?? undefined,
              title: `Company discovered via ${sourceName}`,
              snippet: `${record.name} found as licensed contractor on ${sourceName}${record.city ? ` in ${record.city}` : ''}.`,
              relevanceScore: 0.6,
              metadata: {
                source: sourceSlug,
                licenseNumber,
                liveMode: true,
              },
            },
          })
          updated++
        } else {
          const score = scoreCompany({
            county: record.county,
            state: record.state,
            phone: record.phone,
            street: record.street,
          })

          const newCompany = await db.company.create({
            data: {
              name: record.name,
              normalizedName,
              city: record.city ?? undefined,
              state: record.state ?? 'GA',
              zip: record.zip ?? undefined,
              street: record.street ?? undefined,
              phone: record.phone ?? undefined,
              county: record.county ?? undefined,
              recordOrigin: 'DISCOVERED',
              leadScore: score.leadScore,
              activeScore: score.activeScore,
              sourceConfidence: 0.5,
              lastSeenAt: new Date(),
            },
          })

          await db.signal.create({
            data: {
              companyId: newCompany.id,
              sourceType: 'COMPANY_DISCOVERY',
              sourceName,
              sourceUrl: record.sourceUrl ?? undefined,
              signalType: 'DISCOVERY',
              signalDate: new Date(),
              county: record.county ?? undefined,
              city: record.city ?? undefined,
              title: `Company discovered via ${sourceName}`,
              snippet: `${record.name} found as licensed contractor on ${sourceName}${record.city ? ` in ${record.city}` : ''}.`,
              relevanceScore: 0.6,
              metadata: {
                source: sourceSlug,
                licenseNumber,
                liveMode: true,
              },
            },
          })

          created++
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }

    return { created, updated, skipped, errors }
  }
}

export const companyDiscoveryAdapter = new CompanyDiscoveryAdapter()
