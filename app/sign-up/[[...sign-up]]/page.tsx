import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold text-white tracking-tight">Electrical Leads Engine</h1>
        <p className="text-sm text-gray-400 mt-1">Atlanta metro &amp; North Georgia</p>
      </div>
      <SignUp />
    </main>
  )
}
