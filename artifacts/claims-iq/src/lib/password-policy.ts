export const PASSWORD_MIN_CHARACTERS = 12
export const PASSWORD_MAX_UTF8_BYTES = 72

export function validateNewPassword(password: string): string | null {
  if (Array.from(password).length < PASSWORD_MIN_CHARACTERS) {
    return `Password must contain at least ${PASSWORD_MIN_CHARACTERS} characters.`
  }
  if (new TextEncoder().encode(password).byteLength > PASSWORD_MAX_UTF8_BYTES) {
    return `Password must not exceed ${PASSWORD_MAX_UTF8_BYTES} UTF-8 bytes.`
  }
  return null
}
