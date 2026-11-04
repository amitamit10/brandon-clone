import { Link, useParams } from 'react-router-dom'

/** Stand-in until the report page lands in Task 11. */
export function ReportPlaceholder() {
  const { chatId, reportId } = useParams()
  return (
    <main className="wrap report-stub">
      <h1>Report page coming in Task 11</h1>
      <p className="muted small">
        Chat {chatId ?? 'unknown'}, report {reportId ?? 'unknown'}
      </p>
      <Link to="/" className="btn btn-ghost">
        Back home
      </Link>
    </main>
  )
}
