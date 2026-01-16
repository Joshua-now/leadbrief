import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white" data-testid="text-page-title">
          Dashboard
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Welcome back, {user?.email}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Link href="/import" className="block p-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow" data-testid="link-import">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Import Data</h3>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Upload CSV, JSON, or XLSX files</p>
        </Link>

        <Link href="/jobs" className="block p-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow" data-testid="link-jobs">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Jobs</h3>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Track import progress</p>
        </Link>

        <Link href="/contacts" className="block p-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow" data-testid="link-contacts">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Contacts</h3>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">View enriched contacts</p>
        </Link>

        <Link href="/reports" className="block p-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow" data-testid="link-reports">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Reports</h3>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Analytics and insights</p>
        </Link>
      </div>
    </div>
  )
}
