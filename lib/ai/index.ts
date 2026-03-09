/**
 * Provider-agnostic AI enrichment wrapper.
 * Uses raw fetch — no SDK dependency.
 * Supported providers: anthropic, openai (via env vars)
 * Falls back gracefully to null if no AI provider is configured.
 */

import { z } from 'zod'
import { classifyText } from '@/lib/enrichment/keywords'

const AI_PROVIDER = process.env.AI_PROVIDER ?? 'anthropic'
const AI_MODEL = process.env.AI_MODEL ?? 'claude-3-5-sonnet-20241022'
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? ''
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''

// Zod schema for AI output validation
export const AIEnrichmentSchema = z.object({
  primarySegment: z.enum(['industrial', 'commercial', 'residential', 'mixed']),
  secondarySegments: z.array(z.string()).default([]),
  specialties: z.array(z.string()).default([]),
  serviceAreas: z.array(z.string()).default([]),
  employeeSizeEstimate: z.enum(['1-5', '6-20', '21-50', '50+']).optional(),
  summary: z.string().max(1000),
  likelyBuyerProfile: z.string().max(500),
  confidence: z.number().min(0).max(1),
  recommendedFollowUpAngle: z.string().max(500),
})

export type AIEnrichmentOutput = z.infer<typeof AIEnrichmentSchema>

function buildSystemMessage(): string {
  return (
    'You are a B2B sales intelligence analyst specializing in the electrical contractor market ' +
    'in Atlanta metro and North Georgia. You help electrical supply reps prioritize and tailor ' +
    'outreach to contractor accounts. Return only valid JSON — no markdown, no explanation.'
  )
}

function buildUserMessage(companyName: string, extractedText: string, dataSource = 'Website content'): string {
  return `Analyze this electrical contractor for sales intelligence.

Company: ${companyName}

${dataSource}:
${extractedText.slice(0, 5000)}

Return a JSON object with these exact fields. If evidence is weak, omit optional fields rather than guessing. Do not repeat the same information across fields. Do not put segment names (industrial, commercial, residential) in the specialties array — specialties are specific capabilities, not market segments.

{
  "primarySegment": "industrial" | "commercial" | "residential" | "mixed",
    // industrial = factories, warehouses, manufacturing, data centers
    // commercial = offices, retail, restaurants, hotels, medical buildings
    // residential = homes, apartments, condos, subdivisions
    // mixed = clearly serves multiple with roughly equal focus

  "secondarySegments": string[],
    // other segments they serve; empty array if single-focus

  "specialties": string[],
    // specific electrical capabilities explicitly stated or clearly demonstrated:
    // switchgear, panelboards, lighting controls, generators, service/maintenance,
    // low voltage, fire alarm, EV charging, etc.
    // Do not include generic terms or segment names

  "serviceAreas": string[],
    // Georgia counties or cities explicitly listed, labeled as service areas,
    // or repeatedly mentioned in a coverage context
    // ("serving North Georgia", branch office pages, service area maps)
    // Do NOT infer from a single office address alone or one project mention
    // Only include Georgia locations — ignore out-of-state unless clearly the primary footprint
    // Return empty array if not clearly stated

  "employeeSizeEstimate": "1-5" | "6-20" | "21-50" | "50+",
    // Infer conservatively from explicit evidence:
    //   "1-5": sole proprietor, owner-operator language, single-person copy
    //   "6-20": "our team", a few project photos, small crew references
    //   "21-50": multiple crews, divisions, active job listings, bonded capacity
    //   "50+": large fleet, multiple offices, major commercial portfolio
    // OMIT THIS FIELD entirely if the website gives insufficient evidence

  "summary": string,
    // 2-3 sentences: what they do, who they serve, any notable capabilities
    // Do not repeat content from specialties or serviceAreas

  "likelyBuyerProfile": string,
    // Who controls material purchasing and how decisions are made
    // Base on website evidence and common contractor patterns only
    // If unclear, keep it brief and conservative — do not invent org structures
    // e.g. "Owner/operator handles all procurement directly"
    // e.g. "Project manager per job; owner approves large-ticket items"

  "confidence": number (0.0 to 1.0),
    // Based on: amount of usable website content, clarity of segment cues,
    // whether specialties were explicit vs inferred, geographic specificity
    // Use 0.8+ only when content is rich and classification is unambiguous

  "recommendedFollowUpAngle": string
    // Specific, operational opening for an electrical supply rep
    // Must reference likely material categories, project type, or buying pattern
    // Do NOT claim specific manufacturer preferences unless the website strongly supports them
    // e.g. "Their heavy commercial focus suggests significant panel/breaker volume —
    //       ask what distribution channels they currently use"
    // No generic intros ("introduce yourself", "schedule a meeting")
}`
}

async function callAnthropic(system: string, userMessage: string): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 1024,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.content?.[0]?.text ?? null
  } catch {
    return null
  }
}

async function callOpenAI(system: string, userMessage: string): Promise<string | null> {
  if (!OPENAI_API_KEY) return null
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 1024,
        temperature: 0,
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.choices?.[0]?.message?.content ?? null
  } catch {
    return null
  }
}

/**
 * Call the configured AI provider.
 * Returns raw text response or null if unavailable.
 */
async function callAI(system: string, userMessage: string): Promise<string | null> {
  if (AI_PROVIDER === 'openai') return callOpenAI(system, userMessage)
  return callAnthropic(system, userMessage)
}

/**
 * Parse and validate AI JSON output against schema.
 * Returns null if output is invalid or missing.
 */
function parseAIOutput(raw: string | null): AIEnrichmentOutput | null {
  if (!raw) return null
  try {
    // Strip markdown fences if present
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(cleaned)
    const validated = AIEnrichmentSchema.parse(parsed)
    return validated
  } catch {
    return null
  }
}

/**
 * Keyword-based fallback when AI is unavailable or output is invalid.
 */
function keywordFallback(extractedText: string, companyName: string): AIEnrichmentOutput {
  const classification = classifyText(extractedText)
  return {
    primarySegment: classification.segment,
    secondarySegments: classification.segments,
    specialties: classification.matchedSpecialties,
    serviceAreas: [],
    summary: `${companyName} is a ${classification.segment} electrical contractor. Classification based on keyword analysis.`,
    likelyBuyerProfile: 'Assess at first contact — classification confidence is low without AI enrichment',
    confidence: classification.confidence * 0.6, // lower confidence for fallback
    recommendedFollowUpAngle: 'Request project list and material suppliers to qualify',
  }
}

/**
 * Main AI enrichment function.
 * Returns validated output, or keyword-based fallback if AI is unavailable/fails.
 */
export async function enrichWithAI(
  companyName: string,
  extractedText: string,
  dataSource = 'Website content',
): Promise<{ output: AIEnrichmentOutput; usedFallback: boolean }> {
  const system = buildSystemMessage()
  const userMessage = buildUserMessage(companyName, extractedText, dataSource)
  const rawResponse = await callAI(system, userMessage)
  const parsed = parseAIOutput(rawResponse)

  if (parsed) {
    return { output: parsed, usedFallback: false }
  }

  // Fallback: keyword classifier
  const fallback = keywordFallback(extractedText, companyName)
  return { output: fallback, usedFallback: true }
}
