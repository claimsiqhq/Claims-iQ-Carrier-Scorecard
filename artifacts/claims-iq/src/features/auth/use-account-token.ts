import { useCallback, useState } from "react"

export function useAccountToken(): {
  token: string
  clearToken: () => void
} {
  const [token] = useState(() => {
    if (typeof window === "undefined") return ""
    return new URLSearchParams(window.location.hash.slice(1)).get("token") || ""
  })

  const clearToken = useCallback(() => {
    if (!window.location.hash) return
    window.history.replaceState(
      window.history.state,
      document.title,
      `${window.location.pathname}${window.location.search}`,
    )
  }, [])

  return { token, clearToken }
}
