export const metadata = { title: 'Settings — Electrical Leads Engine' }

export default function SettingsPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">App configuration and preferences</p>
      </div>
      <div className="bg-white border border-gray-200 rounded p-6">
        <p className="text-sm text-gray-500">Settings panel — coming later.</p>
        <p className="text-xs text-gray-400 mt-2">
          Planned: enrichment provider config, AI model selection, county/territory mapping, notification preferences.
        </p>
      </div>
    </div>
  )
}
