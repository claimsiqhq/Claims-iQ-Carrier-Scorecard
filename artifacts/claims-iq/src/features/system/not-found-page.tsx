import { Link } from "wouter"
import { ArrowLeft, FileQuestion } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function NotFoundPage() {
  return (
    <div className="ciq-page">
      <div className="flex min-h-full items-center justify-center p-6">
        <section className="ciq-panel max-w-lg border-t-[3px] border-t-[var(--ciq-aubergine)] p-8 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ciq-info-soft)] text-[var(--ciq-info)]">
            <FileQuestion aria-hidden="true" />
          </span>
          <span className="ciq-eyebrow !text-[var(--ciq-financial)]">Ledger entry 404</span>
          <h1 className="font-[var(--ciq-font-serif)] text-2xl font-semibold text-[var(--ciq-ink)]">
            This workspace could not be found
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--ciq-ink-muted)]">
            The route may have moved, or your account may not have access to this record.
          </p>
          <Button asChild className="mt-6">
            <Link href="/">
              <ArrowLeft aria-hidden="true" />
              Return to dashboard
            </Link>
          </Button>
        </section>
      </div>
    </div>
  )
}
