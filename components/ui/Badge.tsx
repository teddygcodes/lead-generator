import type { ReactNode } from 'react'

type BadgeVariant = 'default' | 'green' | 'yellow' | 'red' | 'blue' | 'gray' | 'orange'

const VARIANTS: Record<BadgeVariant, string> = {
  default: 'bg-gray-100 text-gray-700',
  green: 'bg-green-100 text-green-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-blue-100 text-blue-700',
  gray: 'bg-gray-100 text-gray-500',
  orange: 'bg-orange-100 text-orange-700',
}

interface BadgeProps {
  children: ReactNode
  variant?: BadgeVariant
  className?: string
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span className={`badge ${VARIANTS[variant]} ${className}`}>
      {children}
    </span>
  )
}

/** Score badge: green ≥70, yellow ≥40, red <40 */
export function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) {
    return <Badge variant="gray">—</Badge>
  }
  const variant = score >= 70 ? 'green' : score >= 40 ? 'yellow' : 'gray'
  return <Badge variant={variant}>{Math.round(score)}</Badge>
}

/** Status badge */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, BadgeVariant> = {
    NEW: 'blue',
    QUALIFYING: 'yellow',
    ACTIVE: 'green',
    INACTIVE: 'gray',
    DO_NOT_CONTACT: 'red',
  }
  const labels: Record<string, string> = {
    NEW: 'New',
    QUALIFYING: 'Qualifying',
    ACTIVE: 'Active',
    INACTIVE: 'Inactive',
    DO_NOT_CONTACT: 'DNC',
  }
  return <Badge variant={map[status] ?? 'default'}>{labels[status] ?? status}</Badge>
}

/** Job status badge */
export function JobStatusBadge({ status }: { status: string }) {
  const map: Record<string, BadgeVariant> = {
    PENDING: 'gray',
    RUNNING: 'blue',
    COMPLETED: 'green',
    FAILED: 'red',
  }
  return (
    <Badge variant={map[status] ?? 'default'}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  )
}
