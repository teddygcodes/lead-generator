import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { parse } from 'csv-parse/sync'

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 // 5MB

const KNOWN_ALIASES: Record<string, string> = {
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
  'web site': 'website',
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

function normalizeHeader(header: string): string {
  const lower = header.trim().toLowerCase()
  return KNOWN_ALIASES[lower] ?? lower
}

// Preview — no DB write
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  // File size check
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB` },
      { status: 400 },
    )
  }

  // File type check
  if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
    return NextResponse.json({ error: 'File must be a CSV (.csv)' }, { status: 400 })
  }

  const text = await file.text()

  let rows: Record<string, string>[]
  try {
    rows = parse(text, {
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

  if (rows.length === 0) {
    return NextResponse.json({ error: 'CSV file is empty or has no data rows' }, { status: 400 })
  }

  // Normalize headers
  const originalHeaders = Object.keys(rows[0])
  const normalizedHeaders = originalHeaders.map(normalizeHeader)
  const headerMapping: Record<string, string> = {}
  originalHeaders.forEach((orig, i) => {
    headerMapping[orig] = normalizedHeaders[i]
  })

  // Check which known aliases match
  const autoMapped = Object.entries(headerMapping).filter(
    ([, normalized]) => normalized !== normalized.toLowerCase() || KNOWN_ALIASES[normalized.toLowerCase()],
  )
  const needsMapping = originalHeaders.some(
    (h) => !KNOWN_ALIASES[h.trim().toLowerCase()] && h.trim().toLowerCase() !== 'name',
  )

  return NextResponse.json({
    rowCount: rows.length,
    rows: rows.slice(0, 25),
    headers: originalHeaders,
    normalizedHeaders,
    suggestedMapping: headerMapping,
    needsMapping,
    autoMapped: autoMapped.map(([orig]) => orig),
  })
}
