import React, { useState, useEffect } from "react"
import {
  DashboardDots,
  Settings as SettingsIcon,
  Menu,
  Xmark,
  LogOut,
  NavArrowLeft,
  NavArrowRight,
  MoreHoriz,
  Building,
} from "iconoir-react"
import { BRAND, FONTS } from "@/lib/brand"
import { useLocation } from "wouter"
import { useIsMobile } from "@/hooks/use-mobile"
import { useAuth } from "@/lib/auth-context"

const STORAGE_KEY = "sidebar-collapsed"

export function Sidebar() {
  const [location, setLocation] = useLocation()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "true" } catch { return false }
  })
  const { user, logout } = useAuth()

  useEffect(() => {
    if (!isMobile) setOpen(false)
  }, [isMobile])

  useEffect(() => {
    setOpen(false)
  }, [location])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      try { localStorage.setItem(STORAGE_KEY, String(next)) } catch {}
      return next
    })
  }

  if (isMobile) {
    const nav = (
      <>
        <SidebarItem icon={<DashboardDots width={20} height={20} />} label="Dashboard" active={location === "/" || location.startsWith("/claims")} onClick={() => setLocation("/")} />
        <SidebarItem icon={<Building width={20} height={20} />} label="Carriers" active={location.startsWith("/carriers")} onClick={() => setLocation("/carriers")} />
        <SidebarItem icon={<SettingsIcon width={20} height={20} />} label="Settings" active={location === "/settings"} onClick={() => setLocation("/settings")} />
      </>
    )

    return (
      <>
        <div
          className="fixed top-0 left-0 right-0 z-40 h-14 flex items-center px-4 gap-3"
          style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}`, paddingTop: "env(safe-area-inset-top)" }}
        >
          <button
            onClick={() => setOpen(!open)}
            className="p-2 -ml-2 rounded-lg transition-colors"
            style={{ color: BRAND.deepPurple }}
            aria-label="Toggle navigation menu"
          >
            {open ? <Xmark width={24} height={24} /> : <Menu width={24} height={24} />}
          </button>
          <img src={`${import.meta.env.BASE_URL}images/claims-iq-logo.png`} alt="Claims iQ" className="h-7 w-7" />
          <span className="text-base tracking-tight" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading, fontWeight: 700 }}>
            Claims<span style={{ color: BRAND.purple }}>iQ</span>
          </span>
        </div>

        {open && (
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)}>
            <div className="absolute inset-0 bg-black/20" />
            <div
              className="absolute top-14 left-0 bottom-0 w-64 overflow-y-auto shadow-xl"
              style={{ backgroundColor: BRAND.white, paddingTop: "env(safe-area-inset-top)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <nav className="py-4 px-3 space-y-1">
                {nav}
              </nav>
              <div className="p-4" style={{ borderTop: `1px solid ${BRAND.greyLavender}` }}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold text-white" style={{ backgroundColor: BRAND.purple }}>
                    {user?.firstName?.[0] ?? "U"}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-semibold truncate" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>{user?.firstName ?? "User"}</p>
                    <p className="text-xs truncate" style={{ color: BRAND.purpleSecondary }}>{user?.email ?? ""}</p>
                  </div>
                  <button onClick={logout} className="p-1.5 rounded-lg transition-colors" style={{ color: BRAND.purpleSecondary }} aria-label="Sign out">
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
    <aside
      className="flex flex-col shrink-0 overflow-hidden"
      style={{
        backgroundColor: BRAND.white,
        width: collapsed ? 64 : 240,
        transition: "width 200ms ease",
        borderRight: `1px solid ${BRAND.greyLavender}`,
      }}
    >
      <div
        className="h-16 flex items-center shrink-0"
        style={{
          borderBottom: `1px solid ${BRAND.greyLavender}`,
          padding: collapsed ? "0 0 0 16px" : "0 20px",
          gap: collapsed ? 0 : 10,
        }}
      >
        <img
          src={`${import.meta.env.BASE_URL}images/claims-iq-logo.png`}
          alt="Claims iQ"
          className="h-8 w-8 shrink-0 cursor-pointer"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        />
        {!collapsed && (
          <span className="text-lg tracking-tight whitespace-nowrap" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading, fontWeight: 700 }}>
            Claims<span style={{ color: BRAND.purple }}>iQ</span>
          </span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden" style={{ padding: collapsed ? "16px 8px" : "16px 12px" }}>
        <div className="space-y-1">
          <SidebarItem icon={<DashboardDots width={20} height={20} />} label="Dashboard" active={location === "/" || location.startsWith("/claims")} onClick={() => setLocation("/")} collapsed={collapsed} />
          <SidebarItem icon={<Building width={20} height={20} />} label="Carriers" active={location.startsWith("/carriers")} onClick={() => setLocation("/carriers")} collapsed={collapsed} />
          <SidebarItem icon={<SettingsIcon width={20} height={20} />} label="Settings" active={location === "/settings"} onClick={() => setLocation("/settings")} collapsed={collapsed} />
        </div>
      </nav>

      <div style={{ borderTop: `1px solid ${BRAND.greyLavender}` }}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2 py-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold text-white cursor-pointer"
              style={{ backgroundColor: BRAND.purple }}
              onClick={logout}
              title="Sign out"
            >
              {user?.firstName?.[0] ?? "U"}
            </div>
          </div>
        ) : (
          <div className="p-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold text-white shrink-0" style={{ backgroundColor: BRAND.purple }}>
                {user?.firstName?.[0] ?? "U"}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-semibold truncate" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>{user?.firstName ?? "User"}</p>
                <p className="text-xs truncate" style={{ color: BRAND.purpleSecondary }}>{user?.email ?? ""}</p>
              </div>
              <button onClick={logout} className="p-1.5 rounded-lg transition-colors hover:bg-black/5" style={{ color: BRAND.purpleSecondary }} aria-label="Sign out" title="Sign out">
                <MoreHoriz width={18} height={18} />
              </button>
            </div>
          </div>
        )}

        <button
          onClick={toggleCollapsed}
          className="w-full flex items-center justify-center py-2.5 transition-colors hover:bg-black/[0.03]"
          style={{ color: BRAND.purpleSecondary, borderTop: `1px solid ${BRAND.greyLavender}` }}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <NavArrowRight width={16} height={16} /> : <NavArrowLeft width={16} height={16} />}
        </button>
      </div>
    </aside>
  )
}

function SidebarItem({ icon, label, active = false, onClick, collapsed = false }: { icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void; collapsed?: boolean }) {
  return (
    <div
      className="flex items-center rounded-lg cursor-pointer transition-all active:opacity-80"
      style={{
        backgroundColor: active ? BRAND.lightPurpleGrey : "transparent",
        padding: collapsed ? "10px 0" : "10px 12px",
        gap: collapsed ? 0 : 12,
        justifyContent: collapsed ? "center" : "flex-start",
        borderLeft: active && !collapsed ? `3px solid ${BRAND.purple}` : active && collapsed ? "none" : "3px solid transparent",
      }}
      onClick={onClick}
      title={collapsed ? label : undefined}
    >
      <div className="shrink-0" style={{ color: active ? BRAND.purple : BRAND.purpleSecondary }}>{icon}</div>
      {!collapsed && (
        <span className="text-sm whitespace-nowrap overflow-hidden" style={{ color: active ? BRAND.deepPurple : BRAND.purpleSecondary, fontFamily: FONTS.body, fontWeight: active ? 600 : 400 }}>{label}</span>
      )}
    </div>
  )
}
