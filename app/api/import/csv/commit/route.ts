import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { parse } from 'csv-parse/sync'
import { z } from 'zod'
import { db } from '@/lib/db'
import { normalizeName, normalizeDomain, normalizePhone, extractDomain, deriveCountyFromCity } from '@/lib/normalization'
import { findExistingCompany, mergeCompanyData } from '@/lib/dedupe'
import { ImportRowSchema } from '@/lib/validation/schemas'
import { scoreCompany } from '@/lib/scoring'

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

const CommitBodySchema = z.object({
  fieldMapping: z.record(z.string(), z.string()),
})

const HEADER_ALIASES: Record<string, string> = {
  company: 'name',
  'company name': 'name',
  company_name: 'name',
  'business name': 'name',
  business_name: 'name',
  organization: 'name',
  org: 'name',
  url: 'website',
  site: 'website',
  web: 'website',
  web_site: 'website',
  tel: 'phone',
  telephone: 'phone',
  mobile: 'phone',
  phone_number: 'phone',
  'e-mail': 'email',
  'email address': 'email',
  email_address: 'email',
  addr: 'street',
  address: 'street',
  'street address': 'street',
  street_address: 'street',
  town: 'city',
  'postal code': 'zip',
  'zip code': 'zip',
  zip_code: 'zip',
  postal_code: 'zip',
  'state/province': 'state',
  state_province: 'state',
  region: 'county',
}

function resolveHeader(orig: string, fieldMapping: Record<string, string>): string {
  if (fieldMapping[orig]) return fieldMapping[orig]
  const lower = orig.trim().toLowerCase()
  return HEADER_ALIASES[lower] ?? lower
}

// Planned write operations — collected in read phase, executed atomically in write phase.
type PlannedWrite =
  | {
      type: 'update'
      companyId: string
      data: {
        website?: string | null
        phone?: string | null
        email?: string | null
        street?: string | null
        city?: string | null
        state?: string | null
        zip?: string | null
        county?: string | null
        lastSeenAt: Date
      }
    }
  | {
      type: 'create'
      data: {
        name: string
        normalizedName: string
        website?: string
        domain?: string
        phone?: string
        email?: string
        street?: string
        city?: string
        state: string
        zip?: string
        county?: string
        leadScore: number
        activeScore: number
        lastSeenAt: Date
        recordOrigin: 'IMPORTED'
      }
    }

// Commit — validates and writes to DB
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = formData.get('file')
  const mappingRaw = formData.get('fieldMapping')

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: `File too large. Max ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB` }, { status: 400 })
  }

  // Parse field mapping
  let fieldMapping: Record<string, string> = {}
  if (mappingRaw && typeof mappingRaw === 'string') {
    try {
      fieldMapping = CommitBodySchema.shape.fieldMapping.parse(JSON.parse(mappingRaw))
    } catch {
      return NextResponse.json({ error: 'Invalid fieldMapping JSON' }, { status: 400 })
    }
  }

  const text = await file.text()
  let rawRows: Record<string, string>[]
  try {
    rawRows = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
    }) as Record<string, string>[]
  } catch (err) {
    return NextResponse.json(
      { error: 'Could not parse CSV', details: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }

  // Create a CrawlJob for this import
  const job = await db.crawlJob.create({
    data: {
      sourceType: 'CSV_IMPORT',
      status: 'RUNNING',
      startedAt: new Date(),
      metadata: { filename: file.name, totalRows: rawRows.length },
    },
  })

  // --- Phase 1a: Validate + normalize every row (no DB) ---
  type ValidatedRow = {
    i: number
    row: ReturnType<typeof ImportRowSchema.parse>
    normalizedNameVal: string
    domain: string | null
    phone: string | null
  }
  const validatedRows: ValidatedRow[] = []
  let skipped = 0
  let invalid = 0
  const errors: Array<{ row: number; error: string }> = []

  for (let i = 0; i < rawRows.length; i++) {
    const rawRow = rawRows[i]
    const mappedRow: Record<string, string> = {}
    for (const [origKey, val] of Object.entries(rawRow)) {
      const targetKey = resolveHeader(origKey, fieldMapping)
      if (targetKey === '__skip') continue
      mappedRow[targetKey] = val
    }
    const parseResult = ImportRowSchema.safeParse(mappedRow)
    if (!parseResult.success) {
      invalid++
      const firstError = parseResult.error.issues[0]
      errors.push({ row: i + 2, error: firstError?.message ?? 'Validation failed' })
      continue
    }
    const row = parseResult.data
    validatedRows.push({
      i,
      row,
      normalizedNameVal: normalizeName(row.name),
      domain: row.website ? extractDomain(row.website) : normalizeDomain(row.domain),
      phone: normalizePhone(row.phone),
    })
  }

  // --- Phase 1b: Bulk dedupe — one query for all names + one for all domains ---
  const allNames = validatedRows.map((r) => r.normalizedNameVal).filter(Boolean)
  const allDomains = validatedRows.map((r) => r.domain).filter(Boolean) as string[]

  const existingCompanies = await db.company.findMany({
    where: {
      OR: [
        ...(allNames.length ? [{ normalizedName: { in: allNames } }] : []),
        ...(allDomains.length ? [{ domain: { in: allDomains } }] : []),
      ],
    },
    select: { id: true, normalizedName: true, domain: true, website: true, phone: true, email: true, street: true, city: true, state: true, zip: true, county: true },
  })
  const byName = new Map(existingCompanies.map((c) => [c.normalizedName, c]))
  const byDomain = new Map(existingCompanies.filter((c) => c.domain).map((c) => [c.domain!, c]))

  // --- Phase 1c: Plan writes ---
  const plannedWrites: PlannedWrite[] = []
  // Track names/domains planned for creation in this batch to avoid intra-batch duplicates
  const creatingNames = new Set<string>()
  const creatingDomains = new Set<string>()

  for (const { i, row, normalizedNameVal, domain, phone } of validatedRows) {
    try {
      const existing =
        (domain && byDomain.get(domain)) ??
        (normalizedNameVal && byName.get(normalizedNameVal)) ??
        null

      if (existing) {
        const merged = mergeCompanyData(
          {
            website: existing.website,
            phone: existing.phone,
            email: existing.email,
            street: existing.street,
            city: existing.city,
            state: existing.state,
            zip: existing.zip,
            county: existing.county,
          },
          {
            website: row.website || undefined,
            phone: phone || undefined,
            email: row.email || undefined,
            street: row.street || undefined,
            city: row.city || undefined,
            state: row.state || undefined,
            zip: row.zip || undefined,
            county: row.county || deriveCountyFromCity(row.city, row.state) || undefined,
          },
        )
        plannedWrites.push({ type: 'update', companyId: existing.id, data: { ...merged, lastSeenAt: new Date() } })
      } else {
        // Skip intra-batch duplicates (same name or domain appearing twice in CSV)
        if (normalizedNameVal && creatingNames.has(normalizedNameVal)) { skipped++; continue }
        if (domain && creatingDomains.has(domain)) { skipped++; continue }

        const score = scoreCompany({ county: row.county, state: row.state, website: row.website, email: row.email, phone })
        plannedWrites.push({
          type: 'create',
          data: {
            name: row.name,
            normalizedName: normalizedNameVal,
            website: row.website || undefined,
            domain: domain || undefined,
            phone: phone || undefined,
            email: row.email || undefined,
            street: row.street || undefined,
            city: row.city || undefined,
            state: row.state || 'GA',
            zip: row.zip || undefined,
            county: row.county || deriveCountyFromCity(row.city, row.state) || undefined,
            leadScore: score.leadScore,
            activeScore: score.activeScore,
            lastSeenAt: new Date(),
            recordOrigin: 'IMPORTED',
          },
        })
        if (normalizedNameVal) creatingNames.add(normalizedNameVal)
        if (domain) creatingDomains.add(domain)
      }
    } catch (err) {
      errors.push({ row: i + 2, error: err instanceof Error ? err.message : String(err) })
      invalid++
    }
  }

  // --- Phase 2: Execute writes sequentially (no transaction — avoids timeout on large imports) ---
  const created = plannedWrites.filter((w) => w.type === 'create').length
  const updated = plannedWrites.filter((w) => w.type === 'update').length

  try {
    for (const op of plannedWrites) {
      if (op.type === 'update') {
        await db.company.update({ where: { id: op.companyId }, data: op.data })
      } else {
        await db.company.create({ data: op.data })
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db.crawlJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', finishedAt: new Date(), errorMessage },
    })
    return NextResponse.json(
      { error: 'Import failed — database write error', details: errorMessage },
      { status: 500 },
    )
  }

  await db.crawlJob.update({
    where: { id: job.id },
    data: {
      status: 'COMPLETED',
      finishedAt: new Date(),
      recordsFound: rawRows.length,
      recordsCreated: created,
      recordsUpdated: updated,
      errorMessage:
        errors.length > 0 ? `${errors.length} row errors — see import result` : null,
    },
  })

  return NextResponse.json({
    created,
    updated,
    skipped,
    invalid,
    total: rawRows.length,
    errors,
    jobId: job.id,
  })
}
