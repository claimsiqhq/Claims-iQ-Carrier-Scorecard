import type { ReactNode } from "react"
import { CheckCircle } from "iconoir-react"
import { BrandMark } from "@/components/complete-iq/brand-mark"
import { BrandShapes } from "@/components/complete-iq/brand-shapes"

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
        <div className="relative z-10 my-auto max-w-xl">
          <span className="ciq-eyebrow">Human + intelligent</span>
          <h1 className="font-[var(--ciq-font-display)] text-5xl font-extrabold leading-[1.02] tracking-[-0.04em]">
            Claims faster. Decisions more human.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-[#cdbff7]">
            Complete iQ empowers adjusters and carriers by connecting people, platforms, and
            processes into one intelligent system.
          </p>
          <ul className="mt-10 grid gap-4 text-sm text-[#f0edf4]">
            {[
              "Adjusters stay in command of every carrier decision",
              "Evidence, findings, and actions live in one ledger",
              "Human review remains distinct from AI readiness",
            ].map((item) => (
              <li key={item} className="flex items-center gap-3">
                <CheckCircle className="h-4 w-4 text-[var(--ciq-gold)]" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 text-xs text-[#9d8bbf]">
          Authorized enterprise access only · Activity may be audited
        </p>
        <BrandShapes className="ciq-auth-shapes" />
      </section>

      <section className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-10 sm:px-8">
        <BrandShapes tone="light" className="pointer-events-none absolute -right-24 -top-16 w-[28rem] opacity-40 lg:hidden" />
        <div className="relative z-10 w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <BrandMark />
          </div>
          <div className="mb-7">
            <span className="ciq-eyebrow !text-[var(--ciq-financial-strong)]">{eyebrow}</span>
            <h2 className="font-[var(--ciq-font-display)] text-3xl font-extrabold tracking-[-0.03em] text-[var(--ciq-ink)]">
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
