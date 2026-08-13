import { useEffect, useState, type ReactNode } from "react"
import { Link, useLocation } from "wouter"
import {
  Building,
  Key,
  LogOut,
  Menu,
  MultiplePages,
  NavArrowDown,
  NavArrowRight,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  SidebarCollapse,
  SidebarExpand,
  StatsReport,
  ViewGrid,
} from "iconoir-react"
import { BrandMark } from "@/components/complete-iq/brand-mark"
import { BrandShapes } from "@/components/complete-iq/brand-shapes"
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
import { TenantSwitcher } from "@/components/complete-iq/tenant-switcher"
import { IntakeDialogProvider, useIntakeDialog } from "@/components/complete-iq/intake-dialog-context"
import { useAuth } from "@/lib/auth-context"
import { ChangePasswordDialog } from "@/features/account/change-password-dialog"
import { cn } from "@/lib/utils"

const NAV_COLLAPSED_KEY = "complete-iq-primary-nav-collapsed"

interface NavItem {
  href: string
  label: string
  icon: typeof ViewGrid
  settingsManager?: boolean
  platformAdmin?: boolean
}

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: ViewGrid },
  { href: "/claims", label: "Claims", icon: MultiplePages },
  { href: "/insights", label: "Insights", icon: StatsReport },
  {
    href: "/platform/carriers",
    label: "Platform administration",
    icon: Building,
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
            {isCollapsed ? <SidebarExpand aria-hidden="true" /> : <SidebarCollapse aria-hidden="true" />}
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
  const { openIntake } = useIntakeDialog()
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
            <NavArrowRight aria-hidden="true" />
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
          <TenantSwitcher />
          {canCreateClaims && !location.startsWith("/claims/") && (
            <Button
              size="sm"
              aria-label="New intake"
              onClick={openIntake}
            >
              <Plus aria-hidden="true" />
              <span className="ciq-utility-bar__intake-label">New intake</span>
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
                <NavArrowDown aria-hidden="true" />
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
                <Key aria-hidden="true" />
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
                onSelect={() => {
                  setCommandOpen(false)
                  openIntake()
                }}
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
    <IntakeDialogProvider>
      <div className="ciq-app-shell">
        <a className="ciq-skip-link" href="#main-content">
          Skip to main content
        </a>
        <PrimaryNav />
        <div className="ciq-app-shell__workspace">
          <UtilityBar />
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
    </IntakeDialogProvider>
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
      <BrandShapes className="ciq-context-band__shapes" />
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
