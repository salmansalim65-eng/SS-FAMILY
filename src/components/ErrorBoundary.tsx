import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * React unmounts the entire root when an error escapes a render or an effect,
 * which shows the user a blank white page and tells them nothing. This catches
 * that and shows what actually broke instead.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center bg-sand-50 px-4">
        <div className="card w-full max-w-lg p-6">
          <div className="mb-3 flex items-center gap-3">
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-red-100 text-xl">
              ⚠️
            </span>
            <div>
              <h1 className="text-lg font-bold text-slate-800">Something broke</h1>
              <p className="text-sm text-slate-500">The page could not finish loading.</p>
            </div>
          </div>

          <pre className="mb-4 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-sand-50 p-3 text-xs text-slate-600">
            {error.message}
          </pre>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => window.location.reload()}
              className="rounded-xl bg-palm-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-palm-700"
            >
              Reload
            </button>
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-sand-200 transition hover:bg-sand-50"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }
}
