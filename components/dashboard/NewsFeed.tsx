'use client'

import { useState } from 'react'
import { ExternalLink, Newspaper } from 'lucide-react'
import type { NewsArticle } from '@/app/api/dashboard/news/route'

type Category = 'All' | 'Industrial' | 'Commercial' | 'Infrastructure' | 'Economic Development'

const CATEGORIES: Category[] = ['All', 'Industrial', 'Commercial', 'Infrastructure', 'Economic Development']

const CATEGORY_COLORS: Record<string, string> = {
  Industrial: 'bg-blue-100 text-blue-700',
  Commercial: 'bg-purple-100 text-purple-700',
  Infrastructure: 'bg-orange-100 text-orange-700',
  'Economic Development': 'bg-green-100 text-green-700',
}

function formatPubDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

interface NewsFeedProps {
  articles: NewsArticle[]
  feedsLoaded: number
  feedsFailed: number
}

export function NewsFeed({ articles, feedsLoaded, feedsFailed }: NewsFeedProps) {
  const [activeFilter, setActiveFilter] = useState<Category>('All')

  const filtered =
    activeFilter === 'All' ? articles : articles.filter((a) => a.category === activeFilter)

  return (
    <div className="card flex flex-col">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <span className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
          <Newspaper size={13} className="text-gray-400" />
          Georgia Construction News
        </span>
        {feedsFailed > 0 && (
          <span className="text-[10px] text-gray-400">
            {feedsLoaded}/{feedsLoaded + feedsFailed} feeds loaded
          </span>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1.5 border-b border-gray-100 px-4 py-2 overflow-x-auto">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveFilter(cat)}
            className={`flex-none rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
              activeFilter === cat
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Article list */}
      <div className="flex-1 divide-y divide-gray-50 overflow-y-auto" style={{ maxHeight: 420 }}>
        {articles.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-gray-500">No recent project news loaded.</p>
            <p className="text-xs text-gray-400 mt-1">
              Check server logs for feed errors — Google News RSS may be blocking server requests.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-gray-400">
            No {activeFilter} articles in current batch.
          </div>
        ) : (
          filtered.map((article, idx) => (
            <div key={idx} className="px-4 py-3">
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block group"
              >
                <p className="text-xs font-medium text-gray-900 line-clamp-2 group-hover:text-blue-600 leading-relaxed mb-1">
                  {article.title}
                </p>
              </a>
              <p className="text-[11px] text-gray-400 mb-1">
                {article.source} · {formatPubDate(article.publishedAt)}
              </p>
              {article.description && (
                <p className="text-[11px] text-gray-500 line-clamp-2 mb-1.5">{article.description}</p>
              )}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {article.county && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 leading-4">
                      {article.county}
                    </span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium leading-4 ${CATEGORY_COLORS[article.category] ?? 'bg-gray-100 text-gray-500'}`}
                  >
                    {article.category}
                  </span>
                </div>
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-0.5 text-[11px] text-blue-600 hover:underline flex-none"
                >
                  Read <ExternalLink size={10} />
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
