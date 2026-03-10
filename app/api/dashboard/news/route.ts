import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import Parser from 'rss-parser'

export const revalidate = 1800 // 30-minute Next.js cache

const FEED_QUERIES = [
  'electrical+contractor+Atlanta+Georgia',
  'construction+project+Gwinnett+County+Georgia',
  'industrial+project+Hall+County+Georgia',
  'warehouse+distribution+center+Atlanta+metro',
  'data+center+Georgia+construction',
  'manufacturing+plant+North+Georgia',
  'commercial+construction+Forsyth+County+Georgia',
  'economic+development+North+Georgia',
]

const COUNTY_KEYWORDS = [
  'Fulton', 'Gwinnett', 'Cobb', 'Forsyth', 'Hall', 'Cherokee',
  'Barrow', 'Jackson', 'DeKalb', 'Paulding', 'Henry', 'Douglas', 'Atlanta',
]

const CATEGORY_RULES: { category: string; keywords: string[] }[] = [
  {
    category: 'Industrial',
    keywords: ['warehouse', 'manufacturing', 'plant', 'data center', 'datacenter', 'industrial', 'distribution', 'factory', 'logistics', 'fulfillment'],
  },
  {
    category: 'Commercial',
    keywords: ['retail', 'office', 'hotel', 'restaurant', 'mixed-use', 'shopping', 'commercial', 'multifamily', 'apartment'],
  },
  {
    category: 'Infrastructure',
    keywords: ['highway', 'transit', 'utility', 'school', 'hospital', 'road', 'bridge', 'water', 'sewer', 'airport', 'rail'],
  },
]

function detectCounty(text: string): string | null {
  const lower = text.toLowerCase()
  for (const county of COUNTY_KEYWORDS) {
    if (lower.includes(county.toLowerCase())) return county
  }
  return null
}

function classifyCategory(text: string): string {
  const lower = text.toLowerCase()
  for (const { category, keywords } of CATEGORY_RULES) {
    if (keywords.some((k) => lower.includes(k))) return category
  }
  return 'Economic Development'
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
}

export interface NewsArticle {
  title: string
  source: string
  url: string
  publishedAt: string
  description: string | null
  county: string | null
  category: string
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parser = new Parser({ timeout: 5000 })

  const feedResults = await Promise.allSettled(
    FEED_QUERIES.map(async (query) => {
      const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      try {
        const feed = await parser.parseURL(url)
        clearTimeout(timer)
        console.log(`[news] feed "${query}": ok — ${feed.items.length} items`)
        return { query, items: feed.items, feedTitle: feed.title ?? query }
      } catch (err) {
        clearTimeout(timer)
        console.log(`[news] feed "${query}": FAILED — ${err instanceof Error ? err.message : String(err)}`)
        throw err
      }
    }),
  )

  const feedsLoaded = feedResults.filter((r) => r.status === 'fulfilled').length
  const feedsFailed = feedResults.filter((r) => r.status === 'rejected').length
  console.log(`[news] ${feedsLoaded} feeds loaded, ${feedsFailed} failed`)

  // Collect all articles
  const raw: NewsArticle[] = []
  for (const result of feedResults) {
    if (result.status !== 'fulfilled') continue
    const { items, feedTitle } = result.value
    for (const item of items) {
      if (!item.title || !item.link) continue
      const title = item.title.replace(/\s*-\s*[^-]+$/, '').trim() // strip "- Source Name" suffix Google adds
      const description = item.contentSnippet ?? item.content ?? null
      const combined = `${title} ${description ?? ''}`
      raw.push({
        title,
        source: item.creator ?? feedTitle ?? 'Unknown',
        url: item.link,
        publishedAt: item.pubDate ?? item.isoDate ?? new Date().toISOString(),
        description: description ? description.slice(0, 300) : null,
        county: detectCounty(combined),
        category: classifyCategory(combined),
      })
    }
  }

  // Dedupe by normalized title similarity
  const seen = new Set<string>()
  const deduped: NewsArticle[] = []
  for (const article of raw) {
    const norm = normalizeTitle(article.title).slice(0, 60)
    if (seen.has(norm)) continue
    seen.add(norm)
    deduped.push(article)
  }

  // Sort by date desc, take 15
  const articles = deduped
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 15)

  return NextResponse.json({ articles, feedsLoaded, feedsFailed })
}
