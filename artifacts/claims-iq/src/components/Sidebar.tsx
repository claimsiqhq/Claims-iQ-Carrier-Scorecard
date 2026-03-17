import React from "react"
import {
  DashboardDots,
  PageEdit,
  Upload as UploadIcon,
  ClipboardCheck,
  Settings as SettingsIcon,
} from "iconoir-react"
import { BRAND, FONTS } from "@/lib/brand"
import { useLocation } from "wouter"
import type { Claim } from "@workspace/api-client-react"

interface SidebarProps {
  claims?: Claim[]
  selectedClaimId?: string
  onSelectClaim?: (id: string) => void
}

export function Sidebar({ claims, selectedClaimId, onSelectClaim }: SidebarProps) {
  const [location, setLocation] = useLocation()

  return (
    <aside className="w-64 flex flex-col shrink-0" style={{ backgroundColor: BRAND.deepPurple }}>
      <div className="h-16 flex items-center px-5 gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <img src={`${import.meta.env.BASE_URL}images/claims-iq-logo.png`} alt="Claims iQ" className="h-8 w-8" />
        <span className="text-white text-lg tracking-tight" style={{ fontFamily: FONTS.heading, fontWeight: 700 }}>
          Claims iQ
        </span>
      </div>

      <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
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
      </nav>

      <div className="p-4" style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold text-white" style={{ backgroundColor: BRAND.purple }}>
            JD
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-sm font-semibold text-white truncate" style={{ fontFamily: FONTS.heading }}>John Doe</p>
            <p className="text-xs truncate" style={{ color: BRAND.purpleSecondary }}>Senior Auditor</p>
          </div>
        </div>
      </div>
    </aside>
  )
}

function SidebarItem({ icon, label, active = false, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
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
