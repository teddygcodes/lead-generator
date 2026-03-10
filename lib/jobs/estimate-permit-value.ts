/**
 * estimate-permit-value.ts
 *
 * AI classification pass that estimates value buckets for permits
 * that lack job value data, using Claude to classify based on description.
 */

import { db } from '@/lib/db'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_SIZE = 10
const DELAY_MS = 600

const VALID_BUCKETS = [
  'UNDER_20K',
  '20K_TO_100K',
  '100K_TO_500K',
  '500K_PLUS',
  'UNKNOWN',
] as const

type ValueBucket = (typeof VALID_BUCKETS)[number]

const SYSTEM_PROMPT = `You classify electrical permit job values for a sales intelligence tool. Respond with ONLY one of these exact strings and nothing else, no explanation, no punctuation:
UNDER_20K
20K_TO_100K
100K_TO_500K
500K_PLUS
UNKNOWN`

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface EstimateResult {
  estimated: number
  skipped: number
  unknown: number
  errors: string[]
}

// ---------------------------------------------------------------------------
// Claude API call
// ---------------------------------------------------------------------------

async function callClaudeForBucket(
  permitType: string,
  county: string,
  description: string,
): Promise<ValueBucket> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set')
  }

  const userMessage = `Permit type: ${permitType}
County: ${county}
Description: ${description}

Classify the estimated value of this electrical or construction permit. Consider: industrial > commercial > residential in value, new construction > renovation > repair, larger square footage = higher value. If the description gives no useful scope information (e.g. 'electrical work', 'see plans', 'repair'), return UNKNOWN.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 20,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`)

  const data = await res.json()
  const text: string = data?.content?.[0]?.text ?? ''

  const normalized = text.trim().toUpperCase()

  if ((VALID_BUCKETS as readonly string[]).includes(normalized)) {
    return normalized as ValueBucket
  }

  return 'UNKNOWN'
}

// ---------------------------------------------------------------------------
// Single permit estimation
// ---------------------------------------------------------------------------

async function estimateOne(
  permit: {
    id: string
    permitType: string
    county: string
    description: string
  },
  result: EstimateResult,
): Promise<void> {
  try {
    const bucket = await callClaudeForBucket(permit.permitType, permit.county, permit.description)

    await db.permit.update({
      where: { id: permit.id },
      data: {
        estimatedValueBucket: bucket,
        valueIsEstimated: true,
        valueEstimatedAt: new Date(),
      },
    })

    if (bucket === 'UNKNOWN') {
      result.unknown++
    } else {
      result.estimated++
    }
  } catch (err) {
    result.errors.push(
      `Permit ${permit.id}: ${err instanceof Error ? err.message : String(err)}`,
    )
    // Do NOT rethrow — continue processing
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function estimatePermitValues(): Promise<EstimateResult> {
  const result: EstimateResult = {
    estimated: 0,
    skipped: 0,
    unknown: 0,
    errors: [],
  }

  // Query permits that need estimation
  const permits = await db.permit.findMany({
    where: {
      jobValue: null,
      estimatedValueBucket: null,
      description: { not: null },
      isResidential: false,
      status: { not: 'CLOSED' },
    },
    select: {
      id: true,
      permitType: true,
      county: true,
      description: true,
    },
  })

  // Filter description.length > 15 in JS (Prisma doesn't have string length filter)
  const eligible = permits.filter((p) => (p.description?.length ?? 0) > 15)

  result.skipped = permits.length - eligible.length

  // Cast eligible to the shape expected by estimateOne (description is now known non-null)
  const eligibleWithDesc = eligible as Array<{
    id: string
    permitType: string
    county: string
    description: string
  }>

  // Process in batches
  for (let i = 0; i < eligibleWithDesc.length; i += BATCH_SIZE) {
    const batch = eligibleWithDesc.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map((p) => estimateOne(p, result)))

    if (i + BATCH_SIZE < eligibleWithDesc.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
    }
  }

  console.log(
    `[estimate-permit-value] complete: estimated=${result.estimated} unknown=${result.unknown} skipped=${result.skipped} errors=${result.errors.length}`,
  )

  return result
}
