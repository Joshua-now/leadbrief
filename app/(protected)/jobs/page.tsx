export default function JobsPage() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white" data-testid="text-page-title">
        Jobs
      </h1>
      <p className="mt-2 text-gray-600 dark:text-gray-400">
        Track your import job progress
      </p>
      <div className="mt-8">
        <p className="text-gray-500 dark:text-gray-400">No jobs found</p>
      </div>
    </div>
  )
}
