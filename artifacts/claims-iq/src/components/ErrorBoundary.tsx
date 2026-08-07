import React from "react"
import { BrandMark } from "@/components/complete-iq/brand-mark"
import { Button } from "@/components/ui/button"

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-[100dvh] items-center justify-center bg-[var(--ciq-canvas)] p-6">
          <div className="ciq-panel max-w-md border-t-[3px] border-t-[var(--ciq-critical)] p-8 text-center">
            <BrandMark className="mb-6 justify-center" />
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ciq-critical-soft)] text-[var(--ciq-critical)]">
              <span className="text-xl font-bold" aria-hidden="true">!</span>
            </div>
            <h1 className="font-[var(--ciq-font-serif)] text-2xl font-semibold text-[var(--ciq-ink)]">
              The evidence workspace stopped unexpectedly
            </h1>
            <p className="mb-6 mt-2 text-sm leading-6 text-[var(--ciq-ink-muted)]">
              No claim data was changed by this screen error. Refresh to reopen your protected
              session.
            </p>
            <Button onClick={() => window.location.reload()}>Refresh workspace</Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
