// The signed link itself lives 30 days (LINK_TTL in src/lib/jwt.ts); these
// choices are all at or below that, so no token change is needed.
export const EXPIRY_DAYS = [7, 14, 30] as const;
export type ExpiryDays = (typeof EXPIRY_DAYS)[number];

export const expiryFromDays = (days: ExpiryDays, now = new Date()) =>
  new Date(now.getTime() + days * 86_400_000);

// null = a link sent before expiry existed: only the token lifetime applies
export const isExpired = (expiresAt: Date | null, now = new Date()) =>
  expiresAt !== null && expiresAt.getTime() <= now.getTime();

// LINK_TTL in src/lib/jwt.ts; a null expiresAt row dies with its token
export const LINK_TTL_MS = 30 * 86_400_000;

// for server-side decisions (unopened list, nudge) that must not revive a dead
// legacy link; the public pages keep isExpired(expiresAt), the JWT enforces the rest
export const effectiveExpiry = (expiresAt: Date | null, updatedAt: Date) =>
  expiresAt ?? new Date(updatedAt.getTime() + LINK_TTL_MS);
