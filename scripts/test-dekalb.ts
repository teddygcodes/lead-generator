/**
 * Diagnostic script for the DeKalb ArcGIS permit adapter.
 * Run: pnpm tsx scripts/test-dekalb.ts
 *
 * Do not delete — kept as reference for adapter field mapping.
 */

import { fetchDekalbPermits } from '../lib/permits/dekalb'

async function main() {
  console.log('\n=== DeKalb ArcGIS permit adapter test ===\n')

  const permits = await fetchDekalbPermits()

  console.log(`\n=== RESULTS ===`)
  console.log(`Total permits fetched: ${permits.length}`)

  if (permits.length > 0) {
    console.log('\nFirst permit:')
    console.log(JSON.stringify(permits[0], null, 2))

    const withPhone   = permits.filter(p => p.contractorPhone).length
    const withValue   = permits.filter(p => p.jobValue !== null).length
    const residential = permits.filter(p => p.isResidential).length
    const statuses    = permits.reduce<Record<string, number>>((acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1
      return acc
    }, {})
    const types = permits.reduce<Record<string, number>>((acc, p) => {
      acc[p.permitType] = (acc[p.permitType] ?? 0) + 1
      return acc
    }, {})
    const uniqueContractors = new Set(permits.map(p => p.contractorName).filter(Boolean)).size

    console.log('\nSummary stats:')
    console.log(`  total:              ${permits.length}`)
    console.log(`  with phone:         ${withPhone}`)
    console.log(`  with job value:     ${withValue}`)
    console.log(`  residential:        ${residential}`)
    console.log(`  commercial:         ${permits.length - residential}`)
    console.log(`  unique contractors: ${uniqueContractors}`)
    console.log(`  by status:          ${JSON.stringify(statuses)}`)
    console.log(`  by type:            ${JSON.stringify(types)}`)
  } else {
    console.log('\n⚠️  0 permits returned.')
    console.log('Check that the where clause in dekalb.ts uses only a date filter')
    console.log('(applicationDateTime >= <unix_ms>) with no type filters.')
  }
}

main().catch(err => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
