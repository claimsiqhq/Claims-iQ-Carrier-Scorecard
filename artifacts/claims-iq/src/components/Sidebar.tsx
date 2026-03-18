import React, { useState, useEffect } from "react"
import {
  DashboardDots,
  PageEdit,
  Upload as UploadIcon,
  ClipboardCheck,
  Settings as SettingsIcon,
  Menu,
  Xmark,
  LogOut,
} from "iconoir-react"
import { BRAND, FONTS } from "@/lib/brand"
import { useLocation } from "wouter"
import { useIsMobile } from "@/hooks/use-mobile"
import { useAuth } from "@/lib/auth-context"
import type { Claim } from "@workspace/api-client-react"

interface SidebarProps {
  claims?: Claim[]
  selectedClaimId?: string
  onSelectClaim?: (id: string) => void
}

export function Sidebar({ claims, selectedClaimId, onSelectClaim }: SidebarProps) {
  const [location, setLocation] = useLocation()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const { user, logout } = useAuth()

  useEffect(() => {
    if (!isMobile) setOpen(false)
  }, [isMobile])

  useEffect(() => {
    setOpen(false)
  }, [location])

  const nav = (
    <>
      <SidebarItem
        icon={<DashboardDots width={20} height={20} />}
        label="Dashboard"
        active={location === "/"}
        onClick={() => setLocation("/")}
      />
      <SidebarItem
        icon={<PageEdit width={20} height={20} />}
        label="Claims"
        active={location.startsWith("/claims")}
        onClick={() => setLocation("/claims")}
      />
      <SidebarItem
        icon={<UploadIcon width={20} height={20} />}
        label="Upload / Ingest"
        active={location === "/upload"}
        onClick={() => setLocation("/upload")}
      />
      <SidebarItem
        icon={<ClipboardCheck width={20} height={20} />}
        label="Audit Results"
        active={location === "/audit-results"}
        onClick={() => setLocation("/audit-results")}
      />
      <SidebarItem
        icon={<SettingsIcon width={20} height={20} />}
        label="Settings"
        active={location === "/settings"}
        onClick={() => setLocation("/settings")}
      />

      {claims && claims.length > 0 && (
        <div className="pt-4">
          <p className="text-xs uppercase tracking-wider px-3 mb-2" style={{ color: "rgba(255,255,255,0.3)", fontFamily: FONTS.heading }}>
            Recent Claims
          </p>
          {claims.slice(0, 5).map((c) => (
            <button
              key={c.id}
              className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors"
              style={{
                backgroundColor: selectedClaimId === c.id ? "rgba(119, 99, 183, 0.15)" : "transparent",
                color: selectedClaimId === c.id ? BRAND.purpleLight : "rgba(255,255,255,0.5)",
              }}
              onClick={() => onSelectClaim?.(c.id)}
            >
              <span className="text-xs truncate" style={{ fontFamily: FONTS.mono }}>{c.claimNumber}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )

  if (isMobile) {
    return (
      <>
        <div
          className="fixed top-0 left-0 right-0 z-40 h-14 flex items-center px-4 gap-3"
          style={{ backgroundColor: BRAND.deepPurple, paddingTop: "env(safe-area-inset-top)" }}
        >
          <button
            onClick={() => setOpen(!open)}
            className="p-2 -ml-2 rounded-lg transition-colors"
            style={{ color: "#FFFFFF" }}
            aria-label="Toggle navigation menu"
          >
            {open ? <Xmark width={24} height={24} /> : <Menu width={24} height={24} />}
          </button>
          <img src={`${import.meta.env.BASE_URL}images/claims-iq-logo.png`} alt="Claims iQ" className="h-7 w-7" />
          <span className="text-white text-base tracking-tight" style={{ fontFamily: FONTS.heading, fontWeight: 700 }}>
            Claims iQ
          </span>
        </div>

        {open && (
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <div
              className="absolute top-14 left-0 bottom-0 w-64 overflow-y-auto"
              style={{ backgroundColor: BRAND.deepPurple, paddingTop: "env(safe-area-inset-top)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <nav className="py-4 px-3 space-y-1">
                {nav}
              </nav>
              <div className="p-4" style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold text-white" style={{ backgroundColor: BRAND.purple }}>
                    {user?.firstName?.[0] ?? "U"}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-semibold text-white truncate" style={{ fontFamily: FONTS.heading }}>{user?.firstName ?? "User"}</p>
                    <p className="text-xs truncate" style={{ color: BRAND.purpleSecondary }}>{user?.email ?? ""}</p>
                  </div>
                  <button onClick={logout} className="p-1.5 rounded-lg transition-colors" style={{ color: "rgba(255,255,255,0.4)" }} aria-label="Sign out">
                    <LogOut width={18} height={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <aside className="w-64 flex flex-col shrink-0" style={{ backgroundColor: BRAND.deepPurple }}>
      <div className="h-16 flex items-center px-5 gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <img src={`${import.meta.env.BASE_URL}images/claims-iq-logo.png`} alt="Claims iQ" className="h-8 w-8" />
        <span className="text-white text-lg tracking-tight" style={{ fontFamily: FONTS.heading, fontWeight: 700 }}>
          Claims iQ
        </span>
      </div>

      <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
        {nav}
      </nav>

      <div className="p-4" style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold text-white" style={{ backgroundColor: BRAND.purple }}>
            {user?.firstName?.[0] ?? "U"}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-sm font-semibold text-white truncate" style={{ fontFamily: FONTS.heading }}>{user?.firstName ?? "User"}</p>
            <p className="text-xs truncate" style={{ color: BRAND.purpleSecondary }}>{user?.email ?? ""}</p>
          </div>
          <button onClick={logout} className="p-1.5 rounded-lg transition-colors" style={{ color: "rgba(255,255,255,0.4)" }} aria-label="Sign out">
            <LogOut width={18} height={18} />
          </button>
        </div>
      </div>
    </aside>
  )
}

function SidebarItem({ icon, label, active = false, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors active:opacity-80"
      style={{
        backgroundColor: active ? "rgba(119, 99, 183, 0.15)" : "transparent",
        color: active ? BRAND.purpleLight : "rgba(255,255,255,0.5)",
      }}
      onClick={onClick}
    >
      <div style={{ color: active ? BRAND.purpleLight : "rgba(255,255,255,0.4)" }}>{icon}</div>
      <span className="text-sm" style={{ fontFamily: FONTS.body, fontWeight: active ? 600 : 400 }}>{label}</span>
    </div>
  )
}
