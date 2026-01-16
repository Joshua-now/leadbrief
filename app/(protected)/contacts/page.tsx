export default function ContactsPage() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white" data-testid="text-page-title">
        Contacts
      </h1>
      <p className="mt-2 text-gray-600 dark:text-gray-400">
        View and manage enriched contacts
      </p>
      <div className="mt-8">
        <p className="text-gray-500 dark:text-gray-400">No contacts found</p>
      </div>
    </div>
  )
}
