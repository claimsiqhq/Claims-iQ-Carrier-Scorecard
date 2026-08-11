const INTAKE_RECOVERY_PREFIX = "complete-iq:intake-recovery:v2"
const LEGACY_INTAKE_RECOVERY_KEY = "complete-iq-intake-recovery-v1"
const LEGACY_SELECTED_ORGANIZATION_KEY = "complete-iq:selected-organization"

function storagePart(value: string) {
  return encodeURIComponent(value)
}

export function intakeRecoveryKey(
  userId: string | null | undefined,
  organizationId: string | null | undefined,
): string | null {
  if (!userId || !organizationId) return null
  return `${INTAKE_RECOVERY_PREFIX}:${storagePart(userId)}:${storagePart(organizationId)}`
}

export function clearUploadRecoveryState(): void {
  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    )
    keys.forEach((key) => {
      if (key?.startsWith(INTAKE_RECOVERY_PREFIX)) {
        window.localStorage.removeItem(key)
      }
    })
    window.localStorage.removeItem(LEGACY_INTAKE_RECOVERY_KEY)
  } catch {
    // Tenant transitions remain server-owned when storage is unavailable.
  }
}

export function clearLegacyOrganizationSelection(): void {
  try {
    window.localStorage.removeItem(LEGACY_SELECTED_ORGANIZATION_KEY)
  } catch {
    // The authenticated session remains the only tenant source of truth.
  }
}
