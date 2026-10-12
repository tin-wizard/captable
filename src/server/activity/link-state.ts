// The signed link itself lives 30 days (LINK_TTL in src/lib/jwt.ts); these
// choices are all at or below that, so no token change is needed.
export const EXPIRY_DAYS = [7, 14, 30] as const;
export type ExpiryDays = (typeof EXPIRY_DAYS)[number];

export const expiryFromDays = (days: ExpiryDays, now = new Date()) =>
  new Date(now.getTime() + days * 86_400_000);

// null = a link sent before expiry existed: only the token lifetime applies
export const isExpired = (expiresAt: Date | null, now = new Date()) =>
  expiresAt !== null && expiresAt.getTime() <= now.getTime();
