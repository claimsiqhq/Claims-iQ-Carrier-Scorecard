import { useEffect, useState, type ReactNode } from "react"
import { Link, useLocation } from "wouter"
import {
  BarChart3,
  Building2,
  ChevronDown,
  Files,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react"
import { BrandMark } from "@/components/complete-iq/brand-mark"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/lib/auth-context"
import { cn } from "@/lib/utils"

const NAV_COLLAPSED_KEY = "complete-iq-primary-nav-collapsed"

interface NavItem {
  href: string
  label: string
  icon: typeof LayoutDashboard
  admin?: boolean
}

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/claims", label: "Claims", icon: Files },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  { href: "/carriers", label: "Carriers", icon: Building2, admin: true },
  { href: "/settings", label: "Settings", icon: Settings, admin: true },
]

function isActive(location: string, href: string) {
  if (href === "/") return location === "/"
  return location === href || location.startsWith(`${href}/`)
}

export function PrimaryNav({ className }: { className?: string }) {
  const [location] = useLocation()
  const { isAdmin } = useAuth()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(NAV_COLLAPSED_KEY) === "true"
    } catch {
      return false
    }
  })

  const visibleItems = navItems.filter((item) => !item.admin || isAdmin)

  const toggle = () => {
    setCollapsed((current) => {
      const next = !current
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, String(next))
      } catch {
        // Navigation remains usable when storage is unavailable.
      }
      return next
    })
  }

  return (
    <aside
      className={cn("ciq-primary-nav", collapsed && "ciq-primary-nav--collapsed", className)}
      aria-label="Primary navigation"
    >
      <div className="ciq-primary-nav__brand">
        <BrandMark compact={collapsed} inverse />
      </div>
      <nav className="ciq-primary-nav__links">
        <span className="ciq-primary-nav__section">{collapsed ? "—" : "Workspace"}</span>
        {visibleItems.map((item) => {
          const Icon = item.icon
          const active = isActive(location, item.href)
          return (
            <Link
              href={item.href}
              key={item.href}
              className={cn("ciq-nav-link", active && "ciq-nav-link--active")}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
            >
              <Icon aria-hidden="true" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          )
        })}
      </nav>
      <div className="ciq-primary-nav__footer">
        {!collapsed && (
          <div className="ciq-primary-nav__assurance">
            <ShieldCheck aria-hidden="true" />
            <span>
              Evidence workspace
              <small>Session protected</small>
            </span>
          </div>
        )}
        <button
          type="button"
          className="ciq-nav-collapse"
          onClick={toggle}
          aria-label={collapsed ? "Expand primary navigation" : "Collapse primary navigation"}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          {!collapsed && <span>Collapse rail</span>}
        </button>
      </div>
    </aside>
  )
}

export function MobileNav() {
  const [location] = useLocation()
  const { isAdmin } = useAuth()
  const items = navItems.filter((item) => !item.admin || isAdmin)

  return (
    <nav className="ciq-mobile-nav" aria-label="Mobile navigation">
      {items.map((item) => {
        const Icon = item.icon
        const active = isActive(location, item.href)
        return (
          <Link
            href={item.href}
            key={item.href}
            className={cn("ciq-mobile-link", active && "ciq-mobile-link--active")}
            aria-current={active ? "page" : undefined}
          >
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

function pageName(location: string) {
  if (location.startsWith("/claims/")) return "Claim workbench"
  if (location.startsWith("/claims")) return "Claims queue"
  if (location.startsWith("/insights")) return "Insights"
  if (location.startsWith("/carriers/")) return "Carrier profile"
  if (location.startsWith("/carriers")) return "Carrier administration"
  if (location.startsWith("/settings")) return "Settings"
  return "Audit command center"
}

export function UtilityBar() {
  const [location, setLocation] = useLocation()
  const { user, organization, isAdmin, logout } = useAuth()
  const initials = `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}` || "U"

  return (
    <header className="ciq-utility-bar">
      <div className="ciq-utility-bar__mobile-brand">
        <BrandMark />
      </div>
      <div className="ciq-utility-bar__context">
        <span>Complete iQ Carrier Audit</span>
        <strong>{pageName(location)}</strong>
      </div>
      <div className="ciq-utility-bar__actions">
        {!location.startsWith("/claims/") && (
          <Button
            size="sm"
            className="hidden sm:inline-flex"
            onClick={() => setLocation("/claims?upload=1")}
          >
            <Plus aria-hidden="true" />
            New intake
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="ciq-account-trigger" aria-label="Open account menu">
              <span className="ciq-avatar" aria-hidden="true">
                {initials}
              </span>
              <span className="ciq-account-trigger__label">
                <strong>{user?.firstName || "Account"}</strong>
                <small>{user?.role || "reviewer"}</small>
              </span>
              <ChevronDown aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>
              <span className="block truncate">{user?.email || "Signed-in account"}</span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                {organization?.name || "Complete iQ tenant"}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {isAdmin && (
              <DropdownMenuItem onSelect={() => setLocation("/settings")}>
                <Settings aria-hidden="true" />
                Tenant settings
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => void logout()}>
              <LogOut aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [location] = useLocation()

  useEffect(() => setMobileMenuOpen(false), [location])

  return (
    <div className="ciq-app-shell">
      <a className="ciq-skip-link" href="#main-content">
        Skip to main content
      </a>
      <PrimaryNav />
      <div className="ciq-app-shell__workspace">
        <UtilityBar />
        <button
          type="button"
          className="ciq-mobile-menu-trigger"
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
        {mobileMenuOpen && (
          <div className="ciq-mobile-menu-panel">
            <PrimaryNav />
          </div>
        )}
        <main id="main-content" className="ciq-app-shell__main" tabIndex={-1}>
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  compact = false,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  meta?: ReactNode
  compact?: boolean
}) {
  return (
    <section className={cn("ciq-context-band", compact && "ciq-context-band--compact")}>
      <div className="ciq-context-band__copy">
        {eyebrow && <span className="ciq-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {meta && <div className="ciq-context-band__meta">{meta}</div>}
      </div>
      {actions && <div className="ciq-context-band__actions">{actions}</div>}
    </section>
  )
}

export function PageBody({
  children,
  className,
  overlap = false,
}: {
  children: ReactNode
  className?: string
  overlap?: boolean
}) {
  return (
    <div className={cn("ciq-page-body", overlap && "ciq-page-body--overlap", className)}>
      {children}
    </div>
  )
}
