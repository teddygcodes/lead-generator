import { db } from '@/lib/db'
import { Building2, Radio, Upload, Target, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { TerritoryMap } from '@/components/dashboard/TerritoryMap'
import { PermitSignals } from '@/components/dashboard/PermitSignals'
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
      'electrical+contractor+Georgia+construction',
      'construction+project+Georgia',
      'industrial+development+Georgia',
      'warehouse+distribution+center+Georgia',
      'data+center+Georgia+construction',
      'manufacturing+plant+Georgia',
      'commercial+construction+Georgia',
      'economic+development+Georgia+construction+project',
    ]

    // Statewide Georgia identifiers — used for both county tagging and Gate 2 relevance check
    const GEORGIA_IDENTIFIERS = [
      // Metro Atlanta
      'Atlanta', 'Fulton', 'Gwinnett', 'Cobb', 'DeKalb', 'Clayton', 'Fayette', 'Henry',
      'Cherokee', 'Forsyth', 'Douglas', 'Paulding', 'Rockdale', 'Newton', 'Barrow', 'Coweta',
      // North Georgia
      'Hall', 'Gainesville', 'Whitfield', 'Floyd', 'Bartow', 'Gordon', 'Murray', 'Walker',
      'Catoosa', 'Rome', 'Gilmer', 'Pickens', 'Dawson', 'Habersham', 'Stephens', 'Rabun',
      // Central / Middle Georgia
      'Bibb', 'Macon', 'Houston', 'Baldwin', 'Monroe', 'Putnam', 'Spalding', 'Griffin',
      // Augusta / East Georgia
      'Richmond', 'Augusta', 'Columbia', 'Burke', 'Jefferson', 'McDuffie',
      // Savannah / Coastal Georgia
      'Chatham', 'Savannah', 'Bryan', 'Effingham', 'Liberty', 'Glynn', 'Brunswick', 'Camden',
      // Columbus / West Georgia
      'Muscogee', 'Columbus', 'Harris', 'Peach', 'Taylor',
      // Albany / Southwest Georgia
      'Dougherty', 'Albany', 'Lowndes', 'Valdosta', 'Tift', 'Colquitt', 'Thomas', 'Grady',
      // Athens / Northeast Georgia
      'Clarke', 'Athens', 'Oconee', 'Madison', 'Elbert', 'Hart', 'Franklin',
      // Generic
      'Georgia', ' GA ',
    ]

    // Gate 1 — hard reject: irrelevant content types and neighboring-state collisions
    const BLOCKLIST = [
      'obituary', 'obit', 'funeral', 'passed away', 'in memoriam',
      'memorial service', 'visitation', 'interment', 'survivors include',
      'sports', 'quarterback', 'touchdown', 'playoff', 'standings',
      'lottery', 'jackpot', 'powerball', 'mega millions',
      'election', 'candidate', 'ballot', 'voter', 'campaign',
      'murder', 'shooting', 'arrested', 'indicted', 'sentenced',
      'missing person', 'amber alert',
      // Neighboring states — catches Forsyth/Columbus/Rome name collisions (e.g. Forsyth County NC)
      'north carolina', 'south carolina', 'tennessee', 'alabama', 'florida',
      ' nc ', ' sc ', ' tn ', ' al ', ' fl ',
    ]

    // Gate 3 — must contain a construction/industry signal
    const CONSTRUCTION_KEYWORDS = [
      'construction', 'development', 'project', 'build', 'building',
      'renovation', 'expansion', 'facility', 'plant', 'warehouse', 'center',
      'contractor', 'subcontractor', 'electrical', 'electric',
      'manufacturing', 'industrial', 'distribution', 'data center', 'logistics', 'fulfillment',
      'office', 'retail', 'mixed-use', 'multifamily', 'apartment', 'hotel',
      'headquarters', 'campus', 'investment', 'groundbreaking', 'ribbon cutting',
      'jobs', 'hiring', 'relocat', 'permit',
    ]

    const CATEGORY_RULES = [
      { category: 'Industrial', keywords: ['warehouse', 'manufacturing', 'plant', 'data center', 'datacenter', 'industrial', 'distribution', 'factory', 'logistics', 'fulfillment'] },
      { category: 'Commercial', keywords: ['retail', 'office', 'hotel', 'restaurant', 'mixed-use', 'shopping', 'commercial', 'multifamily', 'apartment'] },
      { category: 'Infrastructure', keywords: ['highway', 'transit', 'utility', 'school', 'hospital', 'road', 'bridge', 'water', 'sewer', 'airport', 'rail'] },
    ]

    function detectCounty(text: string): string | null {
      const lower = text.toLowerCase()
      for (const id of GEORGIA_IDENTIFIERS) {
        if (lower.includes(id.toLowerCase())) return id
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

    // Three-gate relevance filter
    const relevant = raw.filter((article) => {
      const text = `${article.title} ${article.description ?? ''}`
      const lower = text.toLowerCase()
      // Gate 1 — hard reject blocklisted content
      if (BLOCKLIST.some((b) => lower.includes(b))) return false
      // Gate 2 — must mention Georgia or a Georgia city/county
      if (!GEORGIA_IDENTIFIERS.some((id) => lower.includes(id.toLowerCase()))) return false
      // Gate 3 — must have a construction/industry signal
      if (!CONSTRUCTION_KEYWORDS.some((k) => lower.includes(k))) return false
      return true
    })

    const seen = new Set<string>()
    const deduped: NewsArticle[] = []
    for (const article of relevant) {
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

      {/* Permit signals — full width */}
      <PermitSignals />

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
