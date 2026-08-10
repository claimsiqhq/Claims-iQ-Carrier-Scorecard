import { useEffect, useState } from "react"

export function useAccountToken(): string {
  const [token] = useState(() => {
    if (typeof window === "undefined") return ""
    return new URLSearchParams(window.location.hash.slice(1)).get("token") || ""
  })

  useEffect(() => {
    if (!window.location.hash) return
    window.history.replaceState(
      window.history.state,
      document.title,
      `${window.location.pathname}${window.location.search}`,
    )
  }, [])

  return token
}
