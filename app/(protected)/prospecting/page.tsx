import { ProspectingView } from '@/components/prospecting/ProspectingView'

export const dynamic = 'force-dynamic'

export default function ProspectingPage() {
  // Break out of the layout's px-6 py-4 padding so the map panel can fill the full viewport
  // height. The right scroll panel re-applies its own padding internally.
  return (
    <div className="-mx-6 -my-4 flex overflow-hidden" style={{ height: '100vh' }}>
      <ProspectingView />
    </div>
  )
}
