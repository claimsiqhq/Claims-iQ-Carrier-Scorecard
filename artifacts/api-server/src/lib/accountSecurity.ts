import crypto from "crypto";
import bcrypt from "bcryptjs";

const PASSWORD_MIN_LENGTH = 12;
const BCRYPT_MAX_BYTES = 72;
const BCRYPT_ROUNDS = 12;

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validatePassword(value: unknown): string | null {
  if (typeof value !== "string") return "A password is required";
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must contain at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (Buffer.byteLength(value, "utf8") > BCRYPT_MAX_BYTES) {
    return `Password must not exceed ${BCRYPT_MAX_BYTES} UTF-8 bytes`;
  }
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export function createAccountToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashAccountToken(raw) };
}

export function hashAccountToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function isAccountToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,60}$/.test(value);
}
