/**
 * Diagnostic script — Accela API field mapping verification
 * Run: pnpm tsx scripts/test-accela.ts
 *
 * Do not delete — kept as reference for adapter field mapping.
 */

import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const APP_ID = process.env.ACCELA_APP_ID
const APP_SECRET = process.env.ACCELA_APP_SECRET
const AGENCY = 'ATLANTA_GA'
const AUTH_URL = 'https://auth.accela.com/oauth2/token'
const API_BASE = 'https://apis.accela.com'

async function main() {
  console.log('\n=== STEP 1: Get auth token for', AGENCY, '===\n')

  if (!APP_ID || !APP_SECRET) {
    console.error('ACCELA_APP_ID or ACCELA_APP_SECRET not set in .env.local — stopping.')
    process.exit(1)
  }

  // ---- Step 1: Token — try multiple param variations -------------------------
  // Variations differ in how environment + scope are passed, and in agency_name format.
  // Try each in order; stop at first success.
  type TokenAttempt = { label: string; agency: string; body: Record<string, string>; headers: Record<string, string> }
  const TOKEN_ATTEMPTS: TokenAttempt[] = [
    {
      label: 'Variation 1: environment+scope in body, agency_name=ATLANTA_GA',
      agency: 'ATLANTA_GA',
      body: { grant_type: 'client_credentials', client_id: APP_ID, client_secret: APP_SECRET,
               agency_name: 'ATLANTA_GA', environment: 'PROD', scope: 'records' },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
    {
      label: 'Variation 2: environment as header, scope dropped, agency_name=ATLANTA_GA',
      agency: 'ATLANTA_GA',
      body: { grant_type: 'client_credentials', client_id: APP_ID, client_secret: APP_SECRET,
               agency_name: 'ATLANTA_GA' },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-accela-environment': 'PROD' },
    },
    {
      label: 'Variation 3: no scope, environment as header, agency_name=ATLANTA_GA',
      agency: 'ATLANTA_GA',
      body: { grant_type: 'client_credentials', client_id: APP_ID, client_secret: APP_SECRET,
               agency_name: 'ATLANTA_GA', environment: 'PROD' },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-accela-environment': 'PROD' },
    },
    {
      label: 'Variation 4: agency_name=atlanta (lowercase)',
      agency: 'atlanta',
      body: { grant_type: 'client_credentials', client_id: APP_ID, client_secret: APP_SECRET,
               agency_name: 'atlanta', environment: 'PROD' },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-accela-environment': 'PROD' },
    },
    {
      label: 'Variation 5: agency_name=CITY_OF_ATLANTA',
      agency: 'CITY_OF_ATLANTA',
      body: { grant_type: 'client_credentials', client_id: APP_ID, client_secret: APP_SECRET,
               agency_name: 'CITY_OF_ATLANTA', environment: 'PROD' },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-accela-environment': 'PROD' },
    },
  ]

  let token = ''
  let tokenOk = false
  let workingAgency = AGENCY

  for (const attempt of TOKEN_ATTEMPTS) {
    console.log(`Trying: ${attempt.label}`)
    const res = await fetch(AUTH_URL, {
      method: 'POST',
      headers: attempt.headers,
      body: new URLSearchParams(attempt.body).toString(),
    })
    const text = await res.text()
    if (!res.ok) {
      console.log(`  → HTTP ${res.status}: ${text}`)
      continue
    }
    const data = JSON.parse(text)
    token = data.access_token as string
    if (token) {
      tokenOk = true
      workingAgency = attempt.agency
      console.log(`  → SUCCESS. Token (first 20): ${token.slice(0, 20)} | expires_in: ${data.expires_in}`)
      break
    }
    console.log('  → Response OK but no access_token:', text.slice(0, 200))
  }

  if (!tokenOk) {
    console.error('\nAll token variations failed. Check credentials and agency_name.')
    process.exit(1)
  }

  console.log(`\nWorking agency_name: "${workingAgency}"`)
  console.log(`Using for record fetch: AGENCY constant was "${AGENCY}"`)


  // ---- Step 2: Fetch records ------------------------------------------------
  console.log('\n=== STEP 2: Fetch records ===\n')

  const openedDateFrom = '2026-02-08'
  const typeStrings = [
    'Commercial - Electrical',
    'Commercial/Electrical',
    'COMMERCIAL/ELECTRICAL',
    'Building/Electrical',
    'Building - Electrical',
  ]

  let recordsFetched = 0
  let workingTypeString: string | null = null
  let rawRecords: unknown[] = []

  for (const typeStr of typeStrings) {
    console.log(`Trying type="${typeStr}" ...`)
    const url = new URL(`${API_BASE}/v4/records`)
    url.searchParams.set('type', typeStr)
    url.searchParams.set('openedDateFrom', openedDateFrom)
    url.searchParams.set('limit', '5')
    url.searchParams.set('offset', '0')

    const recRes = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-accela-agencyappid': APP_ID,
      },
    })

    if (!recRes.ok) {
      const errText = await recRes.text()
      console.log(`  → HTTP ${recRes.status}: ${errText.slice(0, 200)}`)
      continue
    }

    const recData = await recRes.json()
    const results: unknown[] = Array.isArray(recData)
      ? recData
      : (recData.result ?? recData.results ?? recData.records ?? [])

    console.log(`  → ${results.length} results`)
    console.log('  Full raw response:\n', JSON.stringify(recData, null, 2))

    if (results.length > 0) {
      workingTypeString = typeStr
      rawRecords = results
      recordsFetched = results.length
      break
    }
  }

  if (recordsFetched === 0) {
    console.log('\nNo records returned for any type string tried.')
    console.log('Summary:', { tokenOk, recordsFetched: 0, workingTypeString: null })
    process.exit(0)
  }

  // ---- Step 3: Contacts for first record ------------------------------------
  console.log('\n=== STEP 3: Contacts for first record ===\n')

  const firstRecord = rawRecords[0] as Record<string, unknown>
  const recordId = firstRecord.id as string

  console.log('First record id:', recordId)
  console.log(
    'licensedProfessional field exists?',
    'licensedProfessional' in firstRecord,
    (firstRecord.licensedProfessional as unknown) ?? '(not present)',
  )
  console.log(
    'professionals field exists?',
    'professionals' in firstRecord,
    (firstRecord.professionals as unknown) ?? '(not present)',
  )

  const contactsRes = await fetch(`${API_BASE}/v4/records/${recordId}/contacts`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-accela-agencyappid': APP_ID,
    },
  })

  let rawContactsResponse: unknown = null
  if (!contactsRes.ok) {
    rawContactsResponse = { error: contactsRes.status, body: await contactsRes.text() }
    console.log('Contacts fetch failed:', rawContactsResponse)
  } else {
    rawContactsResponse = await contactsRes.json()
    console.log('Full contacts response:\n', JSON.stringify(rawContactsResponse, null, 2))
  }

  // ---- Step 4: Summary ------------------------------------------------------
  console.log('\n=== STEP 4: Summary ===\n')

  // Find which field held a job value
  const valueFields = [
    'estimatedTotalJobCost',
    'totalFee',
    'jobValue',
    'value',
  ] as const
  let jobValueField: string = 'none found'
  for (const f of valueFields) {
    if (firstRecord[f] !== undefined && firstRecord[f] !== null) {
      jobValueField = `${f} = ${JSON.stringify(firstRecord[f])}`
      break
    }
  }
  // Also check nested valuations
  const valuations = firstRecord.valuations as unknown[] | undefined
  if (!jobValueField.startsWith('estimatedTotalJobCost') && Array.isArray(valuations) && valuations.length > 0) {
    jobValueField += ` | valuations[0] = ${JSON.stringify(valuations[0])}`
  }

  // Contractor location
  const contacts = Array.isArray(rawContactsResponse)
    ? rawContactsResponse
    : ((rawContactsResponse as Record<string, unknown>)?.result as unknown[] ?? [])
  const hasContractorOnRecord = Boolean(firstRecord.licensedProfessional ?? firstRecord.professionals)
  const hasContractorInContacts = contacts.some(
    (c: unknown) =>
      typeof c === 'object' &&
      c !== null &&
      ['contractor', 'license holder'].includes(
        String((c as Record<string, unknown>).type ?? '').toLowerCase(),
      ),
  )

  const summary = {
    tokenOk,
    recordsFetched,
    workingTypeString,
    sampleRecord: {
      id: firstRecord.id,
      permitNumber: firstRecord.customId ?? firstRecord.id,
      status: (firstRecord.status as Record<string, unknown>)?.value ?? firstRecord.status,
      description: firstRecord.description,
      jobValueField,
      contractorLocation: hasContractorOnRecord
        ? 'on record'
        : hasContractorInContacts
          ? 'in contacts'
          : 'not found',
    },
    rawContactsResponse,
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((err) => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
