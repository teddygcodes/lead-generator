/**
 * Diagnostic script for the Cobb County ACA permit adapter.
 * Run: COBB_ACA_USERNAME=xxx COBB_ACA_PASSWORD=xxx pnpm tsx scripts/test-cobb.ts
 *
 * Do not delete — kept as reference for adapter field mapping.
 *
 * The adapter logs:
 *   "[cobb] page N — X total rows, Y electrical" — per-page progress
 *   "[cobb] sample: ..." — first matched permit + parsed contractor info
 *
 * If you see "0 permits" but pages are returning rows, the ELECTRICAL_TYPE_PATTERN
 * in lib/permits/cobb.ts may not be matching the Project Name values on those rows.
 * Check the per-page logs to see what Project Names are being returned and update
 * the pattern accordingly.
 */

import { fetchCobbPermits } from '../lib/permits/cobb'

async function main() {
  console.log('\n=== Cobb County ACA permit adapter test ===\n')

  if (!process.env.COBB_ACA_USERNAME || !process.env.COBB_ACA_PASSWORD) {
    console.error(
      'ERROR: COBB_ACA_USERNAME and COBB_ACA_PASSWORD must be set.\n' +
        'Run: COBB_ACA_USERNAME=tylergilstrap10@gmail.com COBB_ACA_PASSWORD=Abcde12345! pnpm tsx scripts/test-cobb.ts',
    )
    process.exit(1)
  }

  const permits = await fetchCobbPermits()

  console.log(`\n=== RESULTS ===`)
  console.log(`Total permits fetched: ${permits.length}`)

  if (permits.length > 0) {
    console.log('\nFirst 3 permits:')
    permits.slice(0, 3).forEach(p => console.log(JSON.stringify(p, null, 2)))

    const withContractor    = permits.filter(p => p.contractorName).length
    const withoutContractor = permits.length - withContractor
    const residential       = permits.filter(p => p.isResidential).length
    const withPhone         = permits.filter(p => p.contractorPhone).length
    const withLicense       = permits.filter(p => p.contractorLicense).length

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
    console.log(`  with phone:          ${withPhone}`)
    console.log(`  with license:        ${withLicense}`)
    console.log(`  residential:         ${residential}`)
    console.log(`  commercial:          ${permits.length - residential}`)
    console.log(`  unique contractors:  ${uniqueContractors}`)
    console.log(`  by status:           ${JSON.stringify(statuses)}`)
  } else {
    console.log('\n⚠️  0 permits returned.')
    console.log(
      'Check the per-page log lines above — if total rows > 0 but electrical = 0, ' +
        'the Project Name values do not match ELECTRICAL_TYPE_PATTERN in lib/permits/cobb.ts.',
    )
  }
}

main().catch(err => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
