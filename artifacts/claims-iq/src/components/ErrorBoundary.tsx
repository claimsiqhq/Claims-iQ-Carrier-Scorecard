import React from "react"
import { BRAND, FONTS } from "@/lib/brand"

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
        <div className="h-screen flex items-center justify-center" style={{ backgroundColor: BRAND.offWhite }}>
          <div className="text-center max-w-md px-6">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: "#fef2f2" }}>
              <span className="text-2xl">!</span>
            </div>
            <h1 className="text-xl font-bold mb-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
              Something went wrong
            </h1>
            <p className="text-sm mb-6" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.body }}>
              An unexpected error occurred. Please refresh the page to try again.
            </p>
            <button
              className="px-6 py-2.5 rounded-lg text-white text-sm font-semibold"
              style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading }}
              onClick={() => window.location.reload()}
            >
              Refresh Page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
