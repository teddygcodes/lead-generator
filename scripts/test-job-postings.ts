/**
 * Read-only diagnostic script for the job postings CSE fetcher.
 * Prints fetched postings and company name extraction rate — no DB writes.
 *
 * Usage: pnpm tsx scripts/test-job-postings.ts
 *
 * Requires GOOGLE_CSE_API_KEY and GOOGLE_CSE_ENGINE_ID to be set.
 * Copy from .env.local or export them before running:
 *   export GOOGLE_CSE_API_KEY=... GOOGLE_CSE_ENGINE_ID=...
 */

import { fetchElectricianJobPostings, extractCompanyFromTitle } from '../lib/signals/job-postings'
import { VALID_COUNTIES } from '../lib/jobs/sync-permits'

async function main() {
  console.log('\n=== Job Postings CSE fetcher test ===')
  console.log(`Counties: ${VALID_COUNTIES.join(', ')}\n`)

  const postings = await fetchElectricianJobPostings(VALID_COUNTIES)

  console.log(`Total postings fetched: ${postings.length}\n`)

  if (postings.length === 0) {
    console.log('No postings returned. Check GOOGLE_CSE_API_KEY and GOOGLE_CSE_ENGINE_ID.')
    return
  }

  // Print first 20 for manual review
  const preview = postings.slice(0, 20)
  for (const p of preview) {
    console.log(`Title:   ${p.title}`)
    console.log(`Company: ${p.company ?? '(extraction failed)'}`)
    console.log(`URL:     ${p.url}`)
    console.log()
  }

  const extracted = postings.filter((p) => p.company !== null)
  const rate = Math.round((extracted.length / postings.length) * 100)
  console.log(`Extraction rate: ${extracted.length}/${postings.length} (${rate}%)`)

  if (rate < 50) {
    console.log('\n⚠  Extraction rate below 50%. Consider tuning GENERIC_WORDS or the')
    console.log('   segment-splitting regex in extractCompanyFromTitle() before running')
    console.log('   the full sync — low extraction means stubs will be low quality.')
  } else {
    console.log('\n✓  Extraction rate looks good. Review the names above before syncing.')
  }

  // Quick sanity test of the extractor on a few known patterns
  console.log('\n--- Extractor sanity checks ---')
  const testCases: [string, string | null][] = [
    ['Journeyman Electrician - Wayne Griffin Electric - Gainesville, GA', 'Wayne Griffin Electric'],
    ['Commercial Electrician | Ace Power Solutions | Atlanta, GA', 'Ace Power Solutions'],
    ['Electrician Wanted - Now Hiring - Indeed', null],
    ['Electrical Contractor Jobs in Hall County GA', null],
  ]
  let passed = 0
  for (const [input, expected] of testCases) {
    const result = extractCompanyFromTitle(input)
    const ok = result === expected
    console.log(`${ok ? '✓' : '✗'} "${input}"`)
    if (!ok) console.log(`    expected: ${expected ?? 'null'} | got: ${result ?? 'null'}`)
    if (ok) passed++
  }
  console.log(`\n${passed}/${testCases.length} sanity checks passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
