/**
 * Google Custom Search Engine (CSE) adapter — job postings signal source.
 * Searches for electrical contractors actively hiring in each target county.
 * Company names are extracted from job posting titles and fed into the sync orchestrator.
 *
 * Uses the same GOOGLE_CSE_API_KEY + GOOGLE_CSE_ENGINE_ID env vars as website-finder.ts.
 * Cost: ~10 CSE queries per sync run ≈ $0.05 at $5/1,000 queries.
 */

const GOOGLE_CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY ?? ''
const GOOGLE_CSE_ENGINE_ID = process.env.GOOGLE_CSE_ENGINE_ID ?? ''

export function isJobPostingsConfigured(): boolean {
  return Boolean(GOOGLE_CSE_API_KEY && GOOGLE_CSE_ENGINE_ID)
}

export interface JobPosting {
  /** Extracted company name, or null if extraction failed. */
  company: string | null
  title: string
  url: string
  snippet: string
}

// Words that are noise when trying to identify a company name from a job title segment.
const GENERIC_WORDS = new Set([
  'hiring', 'now', 'jobs', 'job', 'employment', 'career', 'careers', 'work',
  'apply', 'wanted', 'needed', 'electrician', 'electricians', 'journeyman',
  'apprentice', 'commercial', 'residential', 'industrial', 'indeed',
  'ziprecruiter', 'linkedin', 'glassdoor', 'monster', 'handshake',
  'position', 'positions', 'opening', 'openings', 'full', 'time', 'part',
])

/**
 * Extract a company name from a job posting title string.
 * Titles commonly look like: "Electrician - Ace Electric - Atlanta, GA"
 * or "Journeyman Electrician | Wayne Griffin Electric | Gainesville, GA".
 * The job role is usually the first segment; the company follows the first separator.
 */
export function extractCompanyFromTitle(title: string): string | null {
  // Split on common separators
  const segments = title.split(/\s*[-|–—@•]\s*/).map((s) => s.trim()).filter(Boolean)

  // Try segments starting at index 1 (skip the job title segment)
  for (const seg of segments.slice(1)) {
    // Filter out location segments (contain commas like "Atlanta, GA") and pure numbers
    if (seg.includes(',') && /[A-Z]{2}/.test(seg)) continue

    const words = seg.split(/\s+/).filter((w) => !GENERIC_WORDS.has(w.toLowerCase()))

    // Require at least 2 non-generic words — single words are too ambiguous
    if (words.length >= 2) {
      return words.join(' ')
    }
  }

  return null
}

/**
 * Build the set of CSE query strings for all target counties.
 * Two queries per county: a broad hiring search and a contractor-specific search.
 */
function buildQueries(counties: string[]): string[] {
  return counties.flatMap((county) => [
    `electrician hiring "${county} GA"`,
    `"electrical contractor" "now hiring" "${county} GA"`,
  ])
}

async function searchCSE(query: string): Promise<JobPosting[]> {
  const url =
    `https://www.googleapis.com/customsearch/v1` +
    `?key=${GOOGLE_CSE_API_KEY}&cx=${GOOGLE_CSE_ENGINE_ID}` +
    `&q=${encodeURIComponent(query)}&num=10`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const data = await res.json()

    return ((data.items ?? []) as Record<string, unknown>[]).map((item) => ({
      company: extractCompanyFromTitle(String(item.title ?? '')),
      title: String(item.title ?? ''),
      url: String(item.link ?? ''),
      snippet: String(item.snippet ?? ''),
    }))
  } catch {
    return []
  }
}

/**
 * Fetch job postings across all target counties using Google CSE.
 * Deduplicates by URL. Inserts a 200ms delay between queries to stay within rate limits.
 */
export async function fetchElectricianJobPostings(counties: string[]): Promise<JobPosting[]> {
  if (!isJobPostingsConfigured()) return []

  const queries = buildQueries(counties)
  const seen = new Set<string>()
  const results: JobPosting[] = []

  for (const query of queries) {
    const postings = await searchCSE(query)
    for (const p of postings) {
      if (!seen.has(p.url)) {
        seen.add(p.url)
        results.push(p)
      }
    }
    // Small delay between CSE calls to avoid hitting rate limits
    await new Promise((r) => setTimeout(r, 200))
  }

  return results
}
