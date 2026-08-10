import type { ReactNode } from "react"
import { CheckCircle2 } from "lucide-react"
import { BrandMark } from "@/components/complete-iq/brand-mark"

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <main className="min-h-[100dvh] bg-[var(--ciq-canvas)] lg:grid lg:grid-cols-[1.08fr_0.92fr]">
      <section className="relative hidden min-h-[100dvh] overflow-hidden bg-[var(--ciq-midnight)] px-12 py-10 text-white lg:flex lg:flex-col">
        <BrandMark inverse />
        <div className="my-auto max-w-xl">
          <span className="ciq-eyebrow">Controlled evidence workspace</span>
          <h1 className="font-[var(--ciq-font-serif)] text-5xl font-semibold leading-[1.04] tracking-[-0.035em]">
            Every carrier decision, tied back to evidence.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-[#c8c0cc]">
            Complete iQ organizes claim files, audit findings, and reviewer actions into one
            accountable ledger—without obscuring the source record.
          </p>
          <ul className="mt-10 grid gap-4 text-sm text-[#ddd6e0]">
            {[
              "Source-aware findings and confidence visibility",
              "Carrier-specific quality controls and scorecards",
              "Human review remains distinct from AI readiness",
            ].map((item) => (
              <li key={item} className="flex items-center gap-3">
                <CheckCircle2 className="h-4 w-4 text-[#68c8bf]" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-[#8f8794]">
          Authorized enterprise access only · Activity may be audited
        </p>
        <div
          className="absolute -bottom-24 -right-16 h-80 w-64 rotate-[-8deg] border border-white/10"
          aria-hidden="true"
        />
      </section>

      <section className="flex min-h-[100dvh] items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <BrandMark />
          </div>
          <div className="mb-7">
            <span className="ciq-eyebrow !text-[var(--ciq-financial)]">{eyebrow}</span>
            <h2 className="font-[var(--ciq-font-serif)] text-3xl font-semibold tracking-[-0.025em] text-[var(--ciq-ink)]">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ciq-ink-muted)]">
              {description}
            </p>
          </div>
          {children}
          {footer && (
            <div className="mt-6 text-center text-xs text-[var(--ciq-ink-faint)]">
              {footer}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
