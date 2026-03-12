/**
 * Diagnostic: use real browser interaction for search (fill + click + wait DOM).
 * Run: COBB_ACA_USERNAME=xxx COBB_ACA_PASSWORD=xxx pnpm tsx scripts/debug-cobb-search.ts
 */
import { chromium } from 'playwright-core'
import { findChromiumPath } from '../lib/permits/browser'
import { parse as parseHtml } from 'node-html-parser'

const COBB_BASE_URL = 'https://cobbca.cobbcounty.gov/CitizenAccess'
const LOGIN_URL  = `${COBB_BASE_URL}/Login.aspx`
const SEARCH_URL = `${COBB_BASE_URL}/Cap/CapHome.aspx?module=Building&customglobalsearch=true`

function parseRows(html: string) {
  const root = parseHtml(html)
  const rows: { date: string; num: string; name: string; detailHref: string }[] = []
  for (const row of root.querySelectorAll('tr.ACA_TabRow_Odd, tr.ACA_TabRow_Even')) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 4) continue
    const dateSpan = row.querySelector('span[id*="lblUpdatedTime"]')
    const date   = (dateSpan?.text ?? cells[1]?.text ?? '').trim()
    const link   = cells[2]?.querySelector('a')
    const num    = link?.text?.trim() ?? cells[2]?.text?.trim() ?? ''
    const name   = cells[3]?.text?.trim() ?? ''
    const href   = link?.getAttribute('href') ?? ''
    if (!num) continue
    rows.push({ date, num, name, detailHref: href })
  }
  return rows
}

async function main() {
  const username = process.env.COBB_ACA_USERNAME
  const password = process.env.COBB_ACA_PASSWORD
  if (!username || !password) { console.error('Set credentials'); process.exit(1) }

  const browser = await chromium.launch({ executablePath: findChromiumPath(), headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' })
  await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })
  const page = await context.newPage()

  // Login
  await page.goto(LOGIN_URL, { timeout: 30_000, waitUntil: 'load' })
  const frame = page.frame({ url: /login-panel/ })!
  await frame.waitForSelector('#username')
  await frame.fill('#username', username)
  await frame.fill('#passwordRequired', password)
  await frame.click('accela-button-primary button')
  await page.waitForURL(u => !u.toString().includes('/Login.aspx'), { timeout: 20_000 })
  console.log('Logged in.')

  // Navigate to search
  await page.goto(SEARCH_URL, { timeout: 20_000, waitUntil: 'load' })

  // Fill dates using real browser interaction
  const startInput = page.locator('#ctl00_PlaceHolderMain_generalSearchForm_txtGSStartDate')
  const endInput   = page.locator('#ctl00_PlaceHolderMain_generalSearchForm_txtGSEndDate')

  await startInput.click({ clickCount: 3 })
  await startInput.fill('01/01/2026')
  await page.keyboard.press('Tab')
  await new Promise(r => setTimeout(r, 300))

  await endInput.click({ clickCount: 3 })
  await endInput.fill('03/11/2026')
  await page.keyboard.press('Tab')
  await new Promise(r => setTimeout(r, 300))

  console.log('Dates filled. Clicking Search...')

  // Click the search link
  await page.click('a[href*="btnNewSearch"]')

  // Wait for results to appear
  await page.waitForSelector('tr.ACA_TabRow_Odd, tr.ACA_TabRow_Even', { timeout: 15_000 }).catch(() => {})
  await new Promise(r => setTimeout(r, 1000))

  const allRows: ReturnType<typeof parseRows> = []
  let pageNum = 1

  while (pageNum <= 50) {
    const html = await page.content()
    const rows = parseRows(html)
    console.log(`\nPage ${pageNum}: ${rows.length} rows`)

    for (const r of rows.slice(0, 8)) {
      console.log(`  ${r.date}  ${r.num.padEnd(20)} "${r.name}"`)
    }
    if (rows.length > 8) console.log(`  ... and ${rows.length - 8} more`)

    allRows.push(...rows)
    if (rows.length === 0) break

    // Check for Next > link
    const nextLink = page.locator('a', { hasText: 'Next >' })
    const nextCount = await nextLink.count()
    if (nextCount === 0) {
      console.log('No Next > — done paginating')
      break
    }

    await nextLink.first().click()
    await new Promise(r => setTimeout(r, 2000))
    pageNum++
  }

  console.log(`\n=== SUMMARY (01/01/2026 – 03/11/2026) ===`)
  console.log(`Total rows: ${allRows.length}`)
  const elec = allRows.filter(r => /electrical|electric|\belec\b|\belc\b/i.test(r.name))
  console.log(`Electrical matches: ${elec.length}`)
  console.log('\nAll unique project names:')
  const names = [...new Set(allRows.map(r => r.name).filter(Boolean))]
  names.sort().forEach(n => console.log(`  "${n}"`))

  if (elec.length) {
    console.log('\nElectrical permits:')
    elec.forEach(r => console.log(`  ${r.date} ${r.num} — "${r.name}"`))
  }

  await browser.close()
}

main().catch(e => { console.error(e); process.exit(1) })
