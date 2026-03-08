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
  summary: z.string().max(1000),
  likelyBuyerProfile: z.string().max(500),
  confidence: z.number().min(0).max(1),
  recommendedFollowUpAngle: z.string().max(500),
})

export type AIEnrichmentOutput = z.infer<typeof AIEnrichmentSchema>

function buildPrompt(companyName: string, extractedText: string): string {
  return `You are analyzing an electrical contractor company for sales intelligence purposes.

Company: ${companyName}

Extracted website text (first 3000 chars):
${extractedText.slice(0, 3000)}

Return a JSON object with these exact fields:
{
  "primarySegment": one of: "industrial" | "commercial" | "residential" | "mixed",
  "secondarySegments": array of strings (e.g. ["industrial", "commercial"]),
  "specialties": array of electrical specialties mentioned (e.g. ["switchgear", "panelboards", "lighting"]),
  "summary": 2-3 sentence summary of what this contractor does and who they serve,
  "likelyBuyerProfile": describe the likely purchasing decision maker (e.g. "Owner/operator, 5-20 employees, handles procurement directly"),
  "confidence": number 0-1 indicating your confidence in this classification,
  "recommendedFollowUpAngle": specific opening angle for a sales rep to use in first outreach
}

Return ONLY the JSON object, no explanation or markdown.`
}

async function callAnthropic(prompt: string): Promise<string | null> {
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
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.content?.[0]?.text ?? null
  } catch {
    return null
  }
}

async function callOpenAI(prompt: string): Promise<string | null> {
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
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024,
        temperature: 0.1,
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
async function callAI(prompt: string): Promise<string | null> {
  if (AI_PROVIDER === 'openai') return callOpenAI(prompt)
  return callAnthropic(prompt)
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
): Promise<{ output: AIEnrichmentOutput; usedFallback: boolean }> {
  const prompt = buildPrompt(companyName, extractedText)
  const rawResponse = await callAI(prompt)
  const parsed = parseAIOutput(rawResponse)

  if (parsed) {
    return { output: parsed, usedFallback: false }
  }

  // Fallback: keyword classifier
  const fallback = keywordFallback(extractedText, companyName)
  return { output: fallback, usedFallback: true }
}
