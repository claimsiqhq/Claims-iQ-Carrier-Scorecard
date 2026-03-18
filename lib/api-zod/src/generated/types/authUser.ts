import { z } from "zod";

export const AuthUser = z.object({
  id: z.string(),
  email: z.string().email().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  profileImageUrl: z.string().nullable().optional(),
});

export type AuthUser = z.infer<typeof AuthUser>;
