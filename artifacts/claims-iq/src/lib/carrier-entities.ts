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

/**
 * Every entity in a tenant is audited under that tenant's single published
 * ruleset, so intake never has to force a choice: default to the tenant's
 * primary entity.
 */
export function defaultCarrierEntityId(
  options: readonly CarrierOption[],
): string {
  const preferred = options.find((option) => option.isPrimary) ?? options[0]
  return preferred?.id ?? ""
}
