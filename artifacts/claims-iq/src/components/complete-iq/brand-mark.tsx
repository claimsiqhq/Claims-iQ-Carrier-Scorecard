import { cn } from "@/lib/utils"

interface BrandMarkProps {
  compact?: boolean
  inverse?: boolean
  className?: string
}

export function BrandMark({ compact = false, inverse = false, className }: BrandMarkProps) {
  return (
    <span className={cn("ciq-wordmark", inverse && "ciq-wordmark--inverse", className)}>
      <span className="ciq-mark" aria-hidden="true">
        <span className="ciq-mark__rail" />
        <span className="ciq-mark__entry ciq-mark__entry--one" />
        <span className="ciq-mark__entry ciq-mark__entry--two" />
        <span className="ciq-mark__entry ciq-mark__entry--three" />
      </span>
      {!compact && (
        <span className="ciq-wordmark__text">
          <span>Complete iQ</span>
          <small>Carrier Audit</small>
        </span>
      )}
      <span className="sr-only">Complete iQ Carrier Audit</span>
    </span>
  )
}
