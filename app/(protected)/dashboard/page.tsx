import { db } from '@/lib/db'
import { Building2, Radio, Upload, Target, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { TerritoryMap } from '@/components/dashboard/TerritoryMap'
import { TopLeads } from '@/components/dashboard/TopLeads'
import { NewsFeed } from '@/components/dashboard/NewsFeed'
import type { NewsArticle } from '@/app/api/dashboard/news/route'

export const metadata = { title: 'Dashboard — Electrical Leads Engine' }

// Fetch RSS news inline (avoids internal HTTP call, shares Next.js revalidate cache)
async function getNews(): Promise<{ articles: NewsArticle[]; feedsLoaded: number; feedsFailed: number }> {
  try {
    // Dynamic import so rss-parser (CJS) only runs server-side
    const Parser = (await import('rss-parser')).default
    const parser = new Parser({ timeout: 5000 })

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

    const CATEGORY_RULES = [
      { category: 'Industrial', keywords: ['warehouse', 'manufacturing', 'plant', 'data center', 'datacenter', 'industrial', 'distribution', 'factory', 'logistics', 'fulfillment'] },
      { category: 'Commercial', keywords: ['retail', 'office', 'hotel', 'restaurant', 'mixed-use', 'shopping', 'commercial', 'multifamily', 'apartment'] },
      { category: 'Infrastructure', keywords: ['highway', 'transit', 'utility', 'school', 'hospital', 'road', 'bridge', 'water', 'sewer', 'airport', 'rail'] },
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

    const raw: NewsArticle[] = []
    for (const result of feedResults) {
      if (result.status !== 'fulfilled') continue
      const { items, feedTitle } = result.value
      for (const item of items) {
        if (!item.title || !item.link) continue
        const title = item.title.replace(/\s*-\s*[^-]+$/, '').trim()
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

    const seen = new Set<string>()
    const deduped: NewsArticle[] = []
    for (const article of raw) {
      const norm = article.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().slice(0, 60)
      if (seen.has(norm)) continue
      seen.add(norm)
      deduped.push(article)
    }

    const articles = deduped
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, 15)

    return { articles, feedsLoaded, feedsFailed }
  } catch (err) {
    console.error('[news] getNews failed:', err)
    return { articles: [], feedsLoaded: 0, feedsFailed: 8 }
  }
}

async function getDashboardData() {
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  const realOnly = { recordOrigin: { not: 'DEMO' as const } }

  const [totalCompanies, signalsThisWeek, recentImports, uncontactedHighScore, failedEnrichments] =
    await Promise.all([
      db.company.count({ where: realOnly }),
      db.signal.count({ where: { createdAt: { gte: weekAgo }, company: realOnly } }),
      db.crawlJob.count({ where: { sourceType: 'CSV_IMPORT', createdAt: { gte: weekAgo } } }),
      db.company.count({ where: { leadScore: { gte: 60 }, status: 'NEW', ...realOnly } }),
      db.company.count({ where: { lastEnrichedAt: null, ...realOnly } }),
    ])

  return { totalCompanies, signalsThisWeek, recentImports, uncontactedHighScore, failedEnrichments }
}

export default async function DashboardPage() {
  const [stats, news] = await Promise.all([getDashboardData(), getNews()])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-semibold text-gray-900">Dashboard</h1>
        <p className="text-xs text-gray-500 mt-0.5">Atlanta metro &amp; North Georgia contractor intelligence</p>
      </div>

      {stats.totalCompanies === 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          No real leads yet — run a Company Discovery job or import via CSV to populate your pipeline.
        </div>
      )}

      {/* 5-card stats row */}
      <div className="grid grid-cols-5 gap-3">
        <SummaryCard
          label="Companies"
          value={stats.totalCompanies}
          icon={<Building2 size={14} />}
          href="/companies"
        />
        <SummaryCard
          label="Signals this week"
          value={stats.signalsThisWeek}
          icon={<Radio size={14} />}
          href="/companies"
        />
        <SummaryCard
          label="Imports this week"
          value={stats.recentImports}
          icon={<Upload size={14} />}
          href="/import"
        />
        <SummaryCard
          label="Uncontacted 60+"
          value={stats.uncontactedHighScore}
          icon={<Target size={14} />}
          href="/companies?minScore=60&status=NEW"
          highlight={stats.uncontactedHighScore > 0}
        />
        <SummaryCard
          label="Need enrichment"
          value={stats.failedEnrichments}
          icon={<AlertCircle size={14} />}
          href="/companies"
        />
      </div>

      {/* Territory map — full width */}
      <TerritoryMap />

      {/* Two-column: top leads + news feed */}
      <div className="grid grid-cols-2 gap-4">
        <TopLeads />
        <NewsFeed
          articles={news.articles}
          feedsLoaded={news.feedsLoaded}
          feedsFailed={news.feedsFailed}
        />
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  icon,
  href,
  highlight = false,
}: {
  label: string
  value: number
  icon: React.ReactNode
  href: string
  highlight?: boolean
}) {
  return (
    <Link
      href={href}
      className="card flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
    >
      <div className={highlight ? 'text-blue-500' : 'text-gray-400'}>{icon}</div>
      <div>
        <p className="text-xl font-semibold text-gray-900 leading-none">{value.toLocaleString()}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </div>
    </Link>
  )
}
