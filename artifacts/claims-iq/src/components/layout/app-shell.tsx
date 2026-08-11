import { useEffect, useState, type ReactNode } from "react"
import { Link, useLocation } from "wouter"
import {
  BarChart3,
  Building2,
  ChevronDown,
  ChevronRight,
  Files,
  LayoutDashboard,
  KeyRound,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react"
import { BrandMark } from "@/components/complete-iq/brand-mark"
import { Button } from "@/components/ui/button"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import {
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useAuth } from "@/lib/auth-context"
import { ChangePasswordDialog } from "@/features/account/change-password-dialog"
import { cn } from "@/lib/utils"

const NAV_COLLAPSED_KEY = "complete-iq-primary-nav-collapsed"

interface NavItem {
  href: string
  label: string
  icon: typeof LayoutDashboard
  settingsManager?: boolean
  platformAdmin?: boolean
}

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/claims", label: "Claims", icon: Files },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  {
    href: "/platform/carriers",
    label: "Platform administration",
    icon: Building2,
    platformAdmin: true,
  },
  { href: "/settings", label: "Settings", icon: Settings, settingsManager: true },
]

function isActive(location: string, href: string) {
  if (href === "/") return location === "/"
  return location === href || location.startsWith(`${href}/`)
}

export function PrimaryNav({
  className,
  collapsible = true,
}: {
  className?: string
  collapsible?: boolean
}) {
  const [location] = useLocation()
  const { isPlatformAdmin, canManageSettings } = useAuth()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(NAV_COLLAPSED_KEY) === "true"
    } catch {
      return false
    }
  })
  const isCollapsed = collapsible && collapsed

  const visibleItems = navItems.filter(
    (item) =>
      (!item.settingsManager || canManageSettings)
      && (!item.platformAdmin || isPlatformAdmin),
  )

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
      className={cn("ciq-primary-nav", isCollapsed && "ciq-primary-nav--collapsed", className)}
      aria-label="Primary navigation"
    >
      <div className="ciq-primary-nav__brand">
        <BrandMark compact={isCollapsed} inverse />
      </div>
      <nav className="ciq-primary-nav__links">
        <span className="ciq-primary-nav__section">{isCollapsed ? "—" : "Workspace"}</span>
        {visibleItems.map((item) => {
          const Icon = item.icon
          const active = isActive(location, item.href)
          return (
            <Link
              href={item.href}
              key={item.href}
              className={cn("ciq-nav-link", active && "ciq-nav-link--active")}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              title={isCollapsed ? item.label : undefined}
            >
              <Icon aria-hidden="true" />
              {!isCollapsed && <span>{item.label}</span>}
            </Link>
          )
        })}
      </nav>
      <div className="ciq-primary-nav__footer">
        {!isCollapsed && (
          <div className="ciq-primary-nav__assurance">
            <ShieldCheck aria-hidden="true" />
            <span>
              Evidence workspace
              <small>Session protected</small>
            </span>
          </div>
        )}
        {collapsible && (
          <button
            type="button"
            className="ciq-nav-collapse"
            onClick={toggle}
            aria-label={isCollapsed ? "Expand primary navigation" : "Collapse primary navigation"}
          >
            {isCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
            {!isCollapsed && <span>Collapse rail</span>}
          </button>
        )}
      </div>
    </aside>
  )
}

export function MobileNav() {
  const [location] = useLocation()
  const { isPlatformAdmin, canManageSettings } = useAuth()
  const items = navItems.filter(
    (item) =>
      (!item.settingsManager || canManageSettings)
      && (!item.platformAdmin || isPlatformAdmin),
  )

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
  if (location.startsWith("/platform/carriers/")) return "Carrier ruleset"
  if (location.startsWith("/platform/carriers")) return "Platform administration"
  if (location.startsWith("/settings")) return "Settings"
  return "Audit command center"
}

export function UtilityBar() {
  const [location, setLocation] = useLocation()
  const {
    user,
    organization,
    isPlatformAdmin,
    canManageSettings,
    canCreateClaims,
    logout,
  } = useAuth()
  const [commandOpen, setCommandOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const initials = `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}` || "U"
  const visibleItems = navItems.filter(
    (item) =>
      (!item.settingsManager || canManageSettings)
      && (!item.platformAdmin || isPlatformAdmin),
  )

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setCommandOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [])

  const navigateFromCommand = (href: string) => {
    setCommandOpen(false)
    setLocation(href)
  }

  return (
    <>
      <header className="ciq-utility-bar">
        <div className="ciq-utility-bar__mobile-brand">
          <BrandMark />
        </div>
        <nav className="ciq-utility-bar__context" aria-label="Breadcrumb">
          <span>Complete iQ Carrier Audit</span>
          <div>
            <Link href="/">Workspace</Link>
            <ChevronRight aria-hidden="true" />
            <strong>{pageName(location)}</strong>
          </div>
        </nav>
        <div className="ciq-utility-bar__actions">
          <button
            type="button"
            className="ciq-command-trigger"
            onClick={() => setCommandOpen(true)}
            aria-label="Search and navigate"
          >
            <Search aria-hidden="true" />
            <span>Search or jump</span>
            <kbd>⌘K</kbd>
          </button>
          <span className="ciq-tenant-chip" title={organization?.name || "Complete iQ tenant"}>
            <Building2 aria-hidden="true" />
            <span>{organization?.name || "Complete iQ tenant"}</span>
          </span>
          {canCreateClaims && !location.startsWith("/claims/") && (
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
                  <small>{organization?.role || user?.role || "reviewer"}</small>
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
              {canManageSettings && (
                <DropdownMenuItem onSelect={() => setLocation("/settings")}>
                  <Settings aria-hidden="true" />
                  Tenant settings
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
                <KeyRound aria-hidden="true" />
                Change password
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void logout()}>
                <LogOut aria-hidden="true" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <DialogTitle className="sr-only">Search Complete iQ Carrier Audit</DialogTitle>
        <DialogDescription className="sr-only">
          Navigate to a workspace or start a new claim intake.
        </DialogDescription>
        <CommandInput placeholder="Search pages and actions…" />
        <CommandList>
          <CommandEmpty>No matching workspace or action.</CommandEmpty>
          <CommandGroup heading="Workspaces">
            {visibleItems.map((item) => {
              const Icon = item.icon
              return (
                <CommandItem
                  key={item.href}
                  value={`${item.label} ${item.href}`}
                  onSelect={() => navigateFromCommand(item.href)}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                  {isActive(location, item.href) && (
                    <CommandShortcut>Current</CommandShortcut>
                  )}
                </CommandItem>
              )
            })}
          </CommandGroup>
          {canCreateClaims && (
            <CommandGroup heading="Actions">
              <CommandItem
                value="new intake upload claim"
                onSelect={() => navigateFromCommand("/claims?upload=1")}
              >
                <Plus aria-hidden="true" />
                <span>Start new intake</span>
                <CommandShortcut>Upload</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  )
}

function PlatformAccessBanner() {
  const { organization, isPlatformAccessActive, exitTenant } = useAuth()
  const [, setLocation] = useLocation()
  const [exiting, setExiting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isPlatformAccessActive || !organization) return null

  const expiresAt = organization.accessExpiresAt
    ? formatAccessExpiration(organization.accessExpiresAt)
    : null

  const leaveTenant = async () => {
    setExiting(true)
    setError(null)
    try {
      await exitTenant()
      setLocation("/tenant-access", { replace: true })
    } catch (exitError) {
      setError(exitError instanceof Error ? exitError.message : "Tenant access could not be exited.")
      setExiting(false)
    }
  }

  return (
    <section
      className="flex flex-wrap items-center gap-3 border-b border-[#d0a64f] bg-[var(--ciq-warning-soft)] px-4 py-2.5 text-[var(--ciq-ink)] sm:px-5"
      aria-label="Active platform tenant access"
    >
      <ShieldAlert className="h-5 w-5 shrink-0 text-[var(--ciq-warning)]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <strong className="block text-sm">
          Viewing {organization.name} as platform administrator
        </strong>
        <span className="block text-xs text-[var(--ciq-ink-muted)]">
          {expiresAt ? `Temporary access expires ${expiresAt}` : "Temporary audited access is active"}
        </span>
        {error && (
          <span className="mt-1 block text-xs font-semibold text-[var(--ciq-critical)]" role="alert">
            {error}
          </span>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={() => void leaveTenant()} disabled={exiting}>
        <LogOut aria-hidden="true" />
        {exiting ? "Exiting…" : "Exit tenant"}
      </Button>
    </section>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [location] = useLocation()

  useEffect(() => setMobileMenuOpen(false), [location])
  useEffect(() => {
    const closeAtDesktop = () => {
      if (window.innerWidth >= 768) setMobileMenuOpen(false)
    }
    window.addEventListener("resize", closeAtDesktop)
    return () => window.removeEventListener("resize", closeAtDesktop)
  }, [])

  return (
    <div className="ciq-app-shell">
      <a className="ciq-skip-link" href="#main-content">
        Skip to main content
      </a>
      <PrimaryNav />
      <div className="ciq-app-shell__workspace">
        <UtilityBar />
        <PlatformAccessBanner />
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className="ciq-mobile-menu-trigger"
              aria-label="Open navigation menu"
            >
              <Menu aria-hidden="true" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="ciq-mobile-menu-sheet">
            <SheetTitle className="sr-only">Complete iQ navigation</SheetTitle>
            <SheetDescription className="sr-only">
              Navigate between carrier-audit workspaces.
            </SheetDescription>
            <PrimaryNav collapsible={false} />
          </SheetContent>
        </Sheet>
        <main id="main-content" className="ciq-app-shell__main" tabIndex={-1}>
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  )
}

function formatAccessExpiration(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
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
