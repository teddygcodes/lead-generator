import Link from 'next/link'
import { NavLink } from './NavLink'
import { UserButton } from '@clerk/nextjs'
import { LayoutDashboard, Building2, Briefcase, Upload, Settings, Zap, Search, FileText } from 'lucide-react'

export function Sidebar() {
  return (
    <aside className="flex h-screen w-52 flex-none flex-col border-r border-gray-200 bg-white">
      {/* Logo */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
        <Zap size={16} className="text-blue-600 flex-none" />
        <span className="text-sm font-semibold text-gray-900 leading-tight">
          Electrical Leads Engine
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        <NavLink href="/dashboard" icon={<LayoutDashboard size={15} />}>
          Dashboard
        </NavLink>
        <NavLink href="/companies" icon={<Building2 size={15} />}>
          Companies
        </NavLink>
        <NavLink href="/jobs" icon={<Briefcase size={15} />}>
          Jobs
        </NavLink>
        <NavLink href="/permits" icon={<FileText size={15} />}>
          Permits
        </NavLink>
        <NavLink href="/prospecting" icon={<Search size={15} />}>
          Prospecting
        </NavLink>
        <NavLink href="/import" icon={<Upload size={15} />}>
          Import
        </NavLink>
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <UserButton
            appearance={{
              elements: {
                avatarBox: 'w-7 h-7',
              },
            }}
          />
          <Link
            href="/settings"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <Settings size={15} />
          </Link>
        </div>
      </div>
    </aside>
  )
}
