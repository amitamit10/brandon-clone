import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <main className="wrap report-stub">
      <h1>Page not found</h1>
      <p className="muted">That page does not exist.</p>
      <Link to="/" className="btn">
        Go home
      </Link>
    </main>
  )
}
