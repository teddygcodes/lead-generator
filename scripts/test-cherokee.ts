/**
 * Diagnostic script for the Cherokee County HTML permit adapter.
 * Run: pnpm tsx scripts/test-cherokee.ts
 *
 * Do not delete — kept as reference for adapter field mapping.
 */

import { fetchCherokeePermits } from '../lib/permits/cherokee'

async function main() {
  console.log('\n=== Cherokee County permit adapter test ===\n')

  const permits = await fetchCherokeePermits()

  console.log(`\n=== RESULTS ===`)
  console.log(`Total permits fetched: ${permits.length}`)

  if (permits.length > 0) {
    console.log('\nFirst 3 permits:')
    permits.slice(0, 3).forEach(p => console.log(JSON.stringify(p, null, 2)))

    const withContractor   = permits.filter(p => p.contractorName).length
    const withoutContractor = permits.length - withContractor
    const residential      = permits.filter(p => p.isResidential).length

    const statuses = permits.reduce<Record<string, number>>((acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1
      return acc
    }, {})

    const uniqueContractors = new Set(
      permits.map(p => p.contractorName).filter(Boolean),
    ).size

    console.log('\nSummary stats:')
    console.log(`  total:               ${permits.length}`)
    console.log(`  with contractor:     ${withContractor}`)
    console.log(`  without contractor:  ${withoutContractor}`)
    console.log(`  residential:         ${residential}`)
    console.log(`  unique contractors:  ${uniqueContractors}`)
    console.log(`  by status:           ${JSON.stringify(statuses)}`)
  } else {
    console.log('\n⚠️  0 permits returned.')
    console.log('Check the POST endpoint and form params in cherokee.ts.')
  }
}

main().catch(err => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
