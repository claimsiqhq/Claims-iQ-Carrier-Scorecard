import { cn } from "@/lib/utils"

export function BrandShapes({
  className,
  tone = "dark",
}: {
  className?: string
  tone?: "dark" | "light"
}) {
  const gold = tone === "dark" ? "#C6A54E" : "#7763B7"
  const wash = tone === "dark" ? "#CDBFF7" : "#9D8BBF"
  const ink = tone === "dark" ? "#FFFFFF" : "#342A4F"

  return (
    <svg
      className={cn("ciq-brand-shapes", `ciq-brand-shapes--${tone}`, className)}
      viewBox="0 0 640 360"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g className="ciq-brand-shapes__orbit">
        <circle cx="470" cy="118" r="92" stroke={gold} strokeWidth="1.5" opacity="0.85" />
        <circle cx="470" cy="118" r="54" fill={gold} opacity="0.16" />
        <circle cx="534" cy="78" r="18" fill={gold} />
      </g>
      <g className="ciq-brand-shapes__drift">
        <path
          d="M92 214c38-62 118-78 168-38 50 40 48 118-8 154-56 36-138 22-176-28-28-38-22-64 16-88Z"
          fill={wash}
          opacity="0.28"
        />
        <rect
          x="318"
          y="168"
          width="132"
          height="132"
          rx="28"
          transform="rotate(-18 384 234)"
          stroke={ink}
          strokeWidth="1.25"
          opacity="0.28"
        />
      </g>
      <g className="ciq-brand-shapes__pulse">
        <path d="M214 72 246 128 174 128Z" fill={gold} opacity="0.9" />
        <circle cx="88" cy="86" r="36" stroke={wash} strokeWidth="10" opacity="0.45" />
        <circle cx="88" cy="86" r="8" fill={ink} opacity="0.55" />
      </g>
      <path
        d="M560 248c28 8 48 34 40 62-8 28-42 38-70 24s-40-48-18-70c14-14 32-20 48-16Z"
        fill={gold}
        opacity="0.55"
      />
    </svg>
  )
}
