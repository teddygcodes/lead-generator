/**
 * Test script for the Accela ACA portal scraper adapter.
 * Run: pnpm tsx scripts/test-accela-aca.ts [ATLANTA_GA|GWINNETT|HALLCO]
 *
 * Do not delete — kept as reference for adapter field mapping.
 */

import { accelaAcaAdapter } from '../lib/permits/accela-aca'
import type { AcaAgencyCode } from '../lib/permits/accela-aca'

const AGENCY_ARG = (process.argv[2] ?? 'ATLANTA_GA') as AcaAgencyCode

async function main() {
  console.log(`\n=== Accela ACA scraper test: ${AGENCY_ARG} ===\n`)

  const permits = await accelaAcaAdapter(AGENCY_ARG)

  console.log(`\n=== RESULTS ===`)
  console.log(`Total permits with contractor: ${permits.length}`)

  if (permits.length > 0) {
    console.log('\nFirst permit:')
    console.log(JSON.stringify(permits[0], null, 2))

    const withPhone   = permits.filter(p => p.contractorPhone).length
    const withLicense = permits.filter(p => p.contractorLicense).length
    const residential = permits.filter(p => p.isResidential).length

    console.log('\nSummary stats:')
    console.log(`  total:            ${permits.length}`)
    console.log(`  with phone:       ${withPhone}`)
    console.log(`  with license:     ${withLicense}`)
    console.log(`  residential:      ${residential}`)
    console.log(`  commercial:       ${permits.length - residential}`)

    const uniqueContractors = new Set(permits.map(p => p.contractorName)).size
    console.log(`  unique contractors: ${uniqueContractors}`)
  }
}

main().catch(err => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
