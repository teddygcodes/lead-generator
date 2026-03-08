import { db } from '@/lib/db'
import { JobStatusBadge } from '@/components/ui/Badge'
import { Building2, Radio, Briefcase, Upload } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from '@/lib/format'

export const metadata = { title: 'Dashboard — Electrical Leads Engine' }

async function getDashboardData() {
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)

  const [
    totalCompanies,
    signalsThisWeek,
    recentJobs,
    recentSignals,
    recentImports,
  ] = await Promise.all([
    db.company.count(),
    db.signal.count({ where: { createdAt: { gte: weekAgo } } }),
    db.crawlJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    db.signal.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { company: { select: { id: true, name: true } } },
    }),
    db.crawlJob.count({ where: { sourceType: 'CSV_IMPORT', createdAt: { gte: weekAgo } } }),
  ])

  return { totalCompanies, signalsThisWeek, recentJobs, recentSignals, recentImports }
}

export default async function DashboardPage() {
  const { totalCompanies, signalsThisWeek, recentJobs, recentSignals, recentImports } =
    await getDashboardData()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-base font-semibold text-gray-900">Dashboard</h1>
        <p className="text-xs text-gray-500 mt-0.5">Atlanta metro &amp; North Georgia contractor intelligence</p>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard
          label="Companies"
          value={totalCompanies}
          icon={<Building2 size={14} />}
          href="/companies"
        />
        <SummaryCard
          label="Signals this week"
          value={signalsThisWeek}
          icon={<Radio size={14} />}
          href="/companies"
        />
        <SummaryCard
          label="Imports this week"
          value={recentImports}
          icon={<Upload size={14} />}
          href="/import"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Recent jobs */}
        <div className="card">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
            <span className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
              <Briefcase size={13} className="text-gray-400" />
              Recent Jobs
            </span>
            <Link href="/jobs" className="text-xs text-blue-600 hover:underline">
              View all
            </Link>
          </div>
          {recentJobs.length === 0 ? (
            <div className="px-4 py-6 text-xs text-gray-400 text-center">No jobs yet</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {recentJobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between px-4 py-2">
                  <div>
                    <span className="text-xs text-gray-700">{job.sourceType}</span>
                    {job.errorMessage && (
                      <p className="text-xs text-red-500 truncate max-w-[180px]">{job.errorMessage}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <JobStatusBadge status={job.status} />
                    <span className="text-xs text-gray-400">{formatDistanceToNow(job.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent signals */}
        <div className="card">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
            <span className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
              <Radio size={13} className="text-gray-400" />
              Recent Signals
            </span>
          </div>
          {recentSignals.length === 0 ? (
            <div className="px-4 py-6 text-xs text-gray-400 text-center">No signals yet</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {recentSignals.map((signal) => (
                <div key={signal.id} className="px-4 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/companies/${signal.companyId}`}
                        className="text-xs font-medium text-gray-800 hover:text-blue-600 truncate block"
                      >
                        {signal.company.name}
                      </Link>
                      <p className="text-xs text-gray-500 truncate">
                        {signal.title ?? signal.signalType}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400 flex-none">
                      {formatDistanceToNow(signal.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  icon,
  href,
}: {
  label: string
  value: number
  icon: React.ReactNode
  href: string
}) {
  return (
    <Link href={href} className="card flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
      <div className="text-gray-400">{icon}</div>
      <div>
        <p className="text-xl font-semibold text-gray-900 leading-none">{value.toLocaleString()}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </div>
    </Link>
  )
}
