import type { CarrierOption } from "@/lib/types"

export function carrierEntitiesForOrganization(
  options: CarrierOption[] | undefined,
  organizationId: string | null | undefined,
): CarrierOption[] {
  if (!organizationId) return []

  return (options || []).filter(
    (option) => option.active && option.organizationId === organizationId,
  )
}
