// dev-only — not for production
// Run: pnpm tsx scripts/run-company-website.ts
// Triggers a COMPANY_WEBSITE adapter job directly (bypasses HTTP auth).

import { runJob } from '@/lib/jobs/runner'

async function main() {
  console.log('Running COMPANY_WEBSITE job...')
  const result = await runJob('COMPANY_WEBSITE')
  console.log(JSON.stringify(result, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
