import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-gray-900">Electrical Leads Engine</h1>
          <p className="mt-1 text-sm text-gray-500">Atlanta metro & North Georgia contractor intelligence</p>
        </div>
        <SignIn />
      </div>
    </div>
  )
}
