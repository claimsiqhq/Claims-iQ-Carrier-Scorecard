import { cn } from "@/lib/utils"

interface BrandMarkProps {
  compact?: boolean
  inverse?: boolean
  className?: string
}

export function BrandMark({ compact = false, inverse = false, className }: BrandMarkProps) {
  const iconAsset = inverse ? "complete-iq-icon-light.png" : "complete-iq-icon-dark.png"
  const lockupAsset = inverse ? "complete-iq-lockup-light.png" : "complete-iq-lockup-dark.png"

  return (
    <span className={cn("ciq-wordmark", inverse && "ciq-wordmark--inverse", className)}>
      {compact ? (
        <img
          className="ciq-brand-asset ciq-brand-asset--icon"
          src={`${import.meta.env.BASE_URL}images/${iconAsset}?v=5`}
          alt=""
          aria-hidden="true"
        />
      ) : (
        <>
          <img
            className="ciq-brand-asset ciq-brand-asset--lockup"
            src={`${import.meta.env.BASE_URL}images/${lockupAsset}?v=5`}
            alt=""
            aria-hidden="true"
          />
          <img
            className="ciq-brand-asset ciq-brand-asset--icon ciq-brand-asset--responsive-icon"
            src={`${import.meta.env.BASE_URL}images/${iconAsset}?v=5`}
            alt=""
            aria-hidden="true"
          />
        </>
      )}
      <span className="sr-only">Complete iQ Carrier Audit</span>
    </span>
  )
}
