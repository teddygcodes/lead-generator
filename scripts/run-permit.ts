// dev-only — not for production
// Run: pnpm tsx scripts/run-permit.ts
// Triggers PERMIT adapter demo run to confirm honest demo behavior.

import { runJob } from '@/lib/jobs/runner'

async function main() {
  console.log('Running PERMIT job (demo mode expected)...')
  const result = await runJob('PERMIT')
  console.log(JSON.stringify(result, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
