import { ImportFlow } from '@/components/import/ImportFlow'

export const metadata = { title: 'Import — Electrical Leads Engine' }

export default function ImportPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Import Companies</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload a CSV file. Preview and map fields before committing to the database.
        </p>
      </div>
      <ImportFlow />
    </div>
  )
}
