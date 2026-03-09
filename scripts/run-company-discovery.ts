// dev-only — not for production
// Run: pnpm tsx scripts/run-company-discovery.ts
// Triggers a COMPANY_DISCOVERY adapter job directly (bypasses HTTP auth).
// Fetches ELEC CONT permits from Atlanta Accela and creates DISCOVERED company records.

import { runJob } from '@/lib/jobs/runner'

async function main() {
  console.log('Running COMPANY_DISCOVERY (Atlanta Accela) job...')
  const result = await runJob('COMPANY_DISCOVERY')
  console.log(JSON.stringify(result, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
