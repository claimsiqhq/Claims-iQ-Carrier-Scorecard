import { z } from "zod";
import { AuthUser } from "./authUser";

export const AuthUserEnvelope = z.object({
  user: AuthUser.nullable(),
});

export type AuthUserEnvelope = z.infer<typeof AuthUserEnvelope>;

export const GetCurrentAuthUserResponse = AuthUserEnvelope;

export const ExchangeMobileAuthorizationCodeBody = z.object({
  code: z.string().min(1),
  code_verifier: z.string().min(1),
  redirect_uri: z.string().min(1),
  state: z.string().min(1),
  nonce: z.string().min(1).optional(),
});

export const ExchangeMobileAuthorizationCodeResponse = z.object({
  token: z.string(),
});

export const LogoutMobileSessionResponse = z.object({
  success: z.literal(true),
});
