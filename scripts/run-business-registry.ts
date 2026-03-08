// dev-only — not for production
// Run: pnpm tsx scripts/run-business-registry.ts
// Triggers a BUSINESS_REGISTRY adapter job directly (bypasses HTTP auth).

import { runJob } from '@/lib/jobs/runner'

async function main() {
  console.log('Running BUSINESS_REGISTRY (LICENSE key) job...')
  const result = await runJob('LICENSE')
  console.log(JSON.stringify(result, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
