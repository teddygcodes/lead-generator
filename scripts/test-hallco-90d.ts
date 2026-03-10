/**
 * One-off test: check Hall County permits from 90 days back to see if
 * older/completed permits have contractor names populated.
 */
import { accelaAcaAdapter } from '../lib/permits/accela-aca'

async function main() {
  console.log('Fetching HALLCO permits for last 90 days…\n')
  const permits = await accelaAcaAdapter('HALLCO', 90)

  const withContractor = permits.filter(p => p.contractorName && p.contractorName.trim() !== '')
  const withoutContractor = permits.filter(p => !p.contractorName || p.contractorName.trim() === '')

  console.log(`\n--- RESULTS ---`)
  console.log(`Total permits:       ${permits.length}`)
  console.log(`With contractor:     ${withContractor.length}`)
  console.log(`Without contractor:  ${withoutContractor.length}`)

  if (withContractor.length > 0) {
    console.log('\n--- Sample with contractor (first 5) ---')
    withContractor.slice(0, 5).forEach(p => {
      console.log(`  ${p.permitNumber} | ${p.status} | filed: ${p.filedAt.toISOString().slice(0,10)} | contractor: ${p.contractorName}`)
    })
  }

  if (withoutContractor.length > 0) {
    console.log('\n--- Sample without contractor (first 5) ---')
    withoutContractor.slice(0, 5).forEach(p => {
      console.log(`  ${p.permitNumber} | ${p.status} | filed: ${p.filedAt.toISOString().slice(0,10)}`)
    })
  }
}

main().catch(console.error)
