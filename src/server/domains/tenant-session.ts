import { env } from "@/env";
import { decode, encode } from "next-auth/jwt";
import { domainConfig } from "./config";

export const TENANT_SESSION_SECONDS = 12 * 60 * 60;
export const tenantCookieName = () =>
  domainConfig().scheme === "https" ? "__Host-dr-tenant" : "dr-tenant";
// The salt feeds the HKDF key derivation, so a token minted for one host cannot decrypt on another.
const salt = (host: string) => `dr-tenant:${host}`;

export type TenantClaims = {
  sub: string;
  cid: string;
  mid: string;
  pid: string;
  hst: string;
  sv: number;
  name?: string | null;
  email?: string | null;
  picture?: string | null;
};

export function mintTenantSession(c: TenantClaims) {
  return encode({
    token: c,
    secret: env.NEXTAUTH_SECRET,
    salt: salt(c.hst),
    maxAge: TENANT_SESSION_SECONDS,
  });
}

export async function readTenantSession(
  token: string | undefined,
  host: string,
): Promise<TenantClaims | null> {
  if (!token) return null;
  try {
    const c = (await decode({
      token,
      secret: env.NEXTAUTH_SECRET,
      salt: salt(host),
    })) as TenantClaims | null;
    return c && c.hst === host && c.sub && c.cid && c.mid ? c : null;
  } catch {
    return null;
  }
}
