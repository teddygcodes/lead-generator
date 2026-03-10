/**
 * Google Custom Search JSON API — website finder.
 * Searches for a company's website using up to 3 query variations.
 * Requires GOOGLE_CSE_API_KEY and GOOGLE_CSE_ENGINE_ID env vars.
 * Free tier: 100 queries/day.
 */

const GOOGLE_CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY ?? ''
const GOOGLE_CSE_ENGINE_ID = process.env.GOOGLE_CSE_ENGINE_ID ?? ''

const SKIP_DOMAINS = new Set([
  'yelp.com', 'yellowpages.com', 'bbb.org', 'angi.com', 'angieslist.com',
  'homeadvisor.com', 'thumbtack.com', 'facebook.com', 'instagram.com',
  'linkedin.com', 'twitter.com', 'x.com', 'google.com',
  'whitepages.com', 'manta.com', 'superpages.com', 'indeed.com',
  'mapquest.com', 'bizapedia.com', 'opencorporates.com',
  'youtube.com', 'tiktok.com', 'nextdoor.com',
  'chamberofcommerce.com', 'zoominfo.com', 'dnb.com', 'alignable.com',
])

const SKIP_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx']

export function isGoogleCSEConfigured(): boolean {
  return Boolean(GOOGLE_CSE_API_KEY && GOOGLE_CSE_ENGINE_ID)
}

function isSkipped(link: string): boolean {
  try {
    const parsed = new URL(link)
    const hostname = parsed.hostname.replace(/^www\./, '')
    if (SKIP_DOMAINS.has(hostname)) return true
    const lower = link.toLowerCase()
    if (SKIP_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true
    return false
  } catch {
    return true
  }
}

async function searchCSE(query: string): Promise<string | null> {
  const url =
    `https://www.googleapis.com/customsearch/v1` +
    `?key=${GOOGLE_CSE_API_KEY}` +
    `&cx=${GOOGLE_CSE_ENGINE_ID}` +
    `&q=${encodeURIComponent(query)}` +
    `&num=5`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const data = await res.json()
    for (const item of data.items ?? []) {
      const link: string = item.link ?? ''
      if (isSkipped(link)) continue
      try {
        const parsed = new URL(link)
        return `${parsed.protocol}//${parsed.host}`
      } catch {
        continue
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Find a company's website using Google CSE with a fallback query chain.
 * Returns root origin (e.g. https://example.com) or null if not found.
 */
export async function findWebsiteForCompany(
  name: string,
  city: string | null,
  state: string | null,
): Promise<string | null> {
  if (!isGoogleCSEConfigured()) return null

  const loc = [city, state].filter(Boolean).join(' ')

  const queries = loc
    ? [
        `"${name}" ${loc} electrical`,
        `"${name}" ${loc}`,
        `"${name}" electrical contractor`,
      ]
    : [`"${name}" electrical contractor`]

  for (const query of queries) {
    const result = await searchCSE(query)
    if (result) return result
  }

  return null
}
