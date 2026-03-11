/**
 * One-off cleanup script: clears permit-to-company links that were created by a bug where
 * company names consisting entirely of generic words (e.g. "Power Solutions Group") would
 * normalize to "" and match every permit contractor with score 0.85.
 *
 * Run ONCE after deploying the normalizeForMatch / matchScore fix:
 *   pnpm tsx scripts/fix-permit-links.ts
 *
 * Permits are cleared (companyId = null) only for companies whose name stripped to ""
 * under the old logic. They will be re-matched correctly on the next sync run.
 */

import { db } from '../lib/db'

/** Replicates the OLD (buggy) normalizeForMatch to identify affected companies. */
function oldNormalizeForMatch(name: string): string {
  const STRIP_SUFFIXES = [
    'llc', 'inc', 'corp', 'co', 'ltd', 'electric', 'electrical',
    'power', 'systems', 'services', 'solutions', 'contractors', 'group',
  ]
  let n = name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
  for (const suffix of STRIP_SUFFIXES) {
    n = n.replace(new RegExp(`\\b${suffix}\\b`, 'g'), '')
  }
  return n.replace(/\s+/g, ' ').trim()
}

async function main() {
  console.log('🔍 Finding companies that normalized to "" under old matching logic…')

  const companies = await db.company.findMany({ select: { id: true, name: true } })

  const badIds = companies
    .filter(c => oldNormalizeForMatch(c.name) === '')
    .map(c => c.id)

  if (badIds.length === 0) {
    console.log('✅ No affected companies found — no cleanup needed.')
    return
  }

  console.log(`⚠️  Found ${badIds.length} affected company/companies:`)
  companies
    .filter(c => badIds.includes(c.id))
    .forEach(c => console.log(`   • "${c.name}" (${c.id})`))

  // Count how many permits are linked to these companies
  const count = await db.permit.count({ where: { companyId: { in: badIds } } })
  console.log(`\n🗑  Clearing links on ${count} permit(s)…`)

  const result = await db.permit.updateMany({
    where: { companyId: { in: badIds } },
    data: { companyId: null, matchConfidence: null, matchedAt: null },
  })

  console.log(`✅ Cleared ${result.count} permit link(s). Re-run a county sync to re-match correctly.`)
}

main()
  .catch(err => {
    console.error('❌ Script failed:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
