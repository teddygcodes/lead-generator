import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { parse } from 'csv-parse/sync'
import { z } from 'zod'
import { db } from '@/lib/db'
import { normalizeName, normalizeDomain, normalizePhone, extractDomain } from '@/lib/normalization'
import { findExistingCompany, mergeCompanyData } from '@/lib/dedupe'
import { ImportRowSchema } from '@/lib/validation/schemas'
import { scoreCompany } from '@/lib/scoring'

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

const CommitBodySchema = z.object({
  fieldMapping: z.record(z.string(), z.string()),
})

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

  // --- Phase 1: Read + plan (no DB writes) ---
  // Validate, normalize, and dedupe each row. Collect write operations to execute atomically.
  // All DB reads happen here; writes are deferred to the transaction below.
  const plannedWrites: PlannedWrite[] = []
  let skipped = 0
  let invalid = 0
  const errors: Array<{ row: number; error: string }> = []

  for (let i = 0; i < rawRows.length; i++) {
    const rawRow = rawRows[i]

    // Apply field mapping
    const mappedRow: Record<string, string> = {}
    for (const [origKey, val] of Object.entries(rawRow)) {
      const targetKey = fieldMapping[origKey] ?? origKey.trim().toLowerCase()
      mappedRow[targetKey] = val
    }

    // Validate required fields
    const parseResult = ImportRowSchema.safeParse(mappedRow)
    if (!parseResult.success) {
      invalid++
      const firstError = parseResult.error.issues[0]
      errors.push({ row: i + 2, error: firstError?.message ?? 'Validation failed' })
      continue // invalid rows don't block valid ones
    }

    const row = parseResult.data

    // Normalize
    const normalizedNameVal = normalizeName(row.name)
    const domain = row.website ? extractDomain(row.website) : normalizeDomain(row.domain)
    const phone = normalizePhone(row.phone)

    try {
      const dedupeResult = await findExistingCompany({ domain, name: row.name, phone })

      if (dedupeResult.found && dedupeResult.companyId) {
        // Update: never overwrite non-empty with empty
        const existing = await db.company.findUnique({ where: { id: dedupeResult.companyId } })
        if (!existing) { skipped++; continue }

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
            county: row.county || undefined,
          },
        )

        plannedWrites.push({
          type: 'update',
          companyId: dedupeResult.companyId,
          data: { ...merged, lastSeenAt: new Date() },
        })
      } else {
        // Create new company
        const score = scoreCompany({
          county: row.county,
          state: row.state,
          website: row.website,
          email: row.email,
          phone,
        })

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
            county: row.county || undefined,
            leadScore: score.leadScore,
            activeScore: score.activeScore,
            lastSeenAt: new Date(),
            recordOrigin: 'IMPORTED',
          },
        })
      }
    } catch (err) {
      errors.push({
        row: i + 2,
        error: err instanceof Error ? err.message : String(err),
      })
      invalid++
    }
  }

  // --- Phase 2: Execute all writes atomically ---
  // If the server crashes here, no partial data is written.
  // Acceptable for launch because imports are small/bounded; row-count limiting is P1.
  const created = plannedWrites.filter((w) => w.type === 'create').length
  const updated = plannedWrites.filter((w) => w.type === 'update').length

  try {
    await db.$transaction(async (tx) => {
      for (const op of plannedWrites) {
        if (op.type === 'update') {
          await tx.company.update({ where: { id: op.companyId }, data: op.data })
        } else {
          await tx.company.create({ data: op.data })
        }
      }
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await db.crawlJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorMessage,
      },
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
