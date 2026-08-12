import { cn } from "@/lib/utils"

interface BrandMarkProps {
  compact?: boolean
  inverse?: boolean
  className?: string
}

export function BrandMark({ compact = false, inverse = false, className }: BrandMarkProps) {
  return (
    <span className={cn("ciq-wordmark", inverse && "ciq-wordmark--inverse", className)}>
      <img
        className="ciq-mark-image"
        src={`${import.meta.env.BASE_URL}images/complete-iq-mark.png?v=4`}
        alt=""
        aria-hidden="true"
      />
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
