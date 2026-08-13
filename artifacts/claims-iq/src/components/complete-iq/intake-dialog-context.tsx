import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useLocation } from "wouter"
import { UploadClaimsDialog } from "@/components/complete-iq/upload-claims-dialog"

interface IntakeDialogContextValue {
  openIntake: () => void
}

const IntakeDialogContext = createContext<IntakeDialogContextValue | null>(null)

function hasUploadQuery(location: string) {
  if (location.includes("upload=1")) return true
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("upload") === "1"
}

function pathWithoutUpload(location: string) {
  const [pathname, search = ""] = location.split("?")
  const params = new URLSearchParams(search || window.location.search)
  params.delete("upload")
  const nextSearch = params.toString()
  return nextSearch ? `${pathname}?${nextSearch}` : pathname || "/"
}

export function useIntakeDialog() {
  const value = useContext(IntakeDialogContext)
  if (!value) {
    throw new Error("useIntakeDialog must be used within IntakeDialogProvider")
  }
  return value
}

export function IntakeDialogProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation()
  const [open, setOpen] = useState(() => hasUploadQuery(location))

  useEffect(() => {
    if (hasUploadQuery(location)) setOpen(true)
  }, [location])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (!next && hasUploadQuery(location)) {
        setLocation(pathWithoutUpload(location), { replace: true })
      }
    },
    [location, setLocation],
  )

  const openIntake = useCallback(() => setOpen(true), [])
  const value = useMemo(() => ({ openIntake }), [openIntake])

  return (
    <IntakeDialogContext.Provider value={value}>
      {children}
      <UploadClaimsDialog open={open} onOpenChange={handleOpenChange} />
    </IntakeDialogContext.Provider>
  )
}
