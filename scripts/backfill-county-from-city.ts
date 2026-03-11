/**
 * One-time backfill: set county for Georgia companies that have a city but null county.
 * Uses the static GEORGIA_CITY_TO_COUNTY lookup map.
 * Run with: npx ts-node --project tsconfig.json scripts/backfill-county-from-city.ts
 */

import { PrismaClient } from '@prisma/client'
import { deriveCountyFromCity } from '../lib/normalization/georgia-cities'

const db = new PrismaClient()
const CHUNK_SIZE = 50

async function main() {
  const companies = await db.company.findMany({
    where: {
      county: null,
      city: { not: null },
      OR: [{ state: 'GA' }, { state: 'Georgia' }, { state: null }],
    },
    select: { id: true, city: true, state: true },
  })

  console.log(`Found ${companies.length} companies with city but no county`)

  const toUpdate = companies
    .map((c) => ({ id: c.id, county: deriveCountyFromCity(c.city, c.state) }))
    .filter((c): c is { id: string; county: string } => c.county !== null)

  const skipped = companies.length - toUpdate.length
  console.log(`Static map resolved ${toUpdate.length} of ${companies.length} (${skipped} cities not in map — will be resolved at next enrichment via Geocoding API)`)

  if (toUpdate.length === 0) {
    console.log('Nothing to update.')
    return
  }

  let totalUpdated = 0
  for (let i = 0; i < toUpdate.length; i += CHUNK_SIZE) {
    const chunk = toUpdate.slice(i, i + CHUNK_SIZE)
    await Promise.all(
      chunk.map((c) => db.company.update({ where: { id: c.id }, data: { county: c.county } })),
    )
    totalUpdated += chunk.length
    console.log(`Updated ${totalUpdated} / ${toUpdate.length}`)
  }

  console.log(`Done. ${totalUpdated} companies now have a county.`)
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
