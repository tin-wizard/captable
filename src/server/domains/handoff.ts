import { createHash, randomBytes } from "node:crypto";
import { db } from "@/server/db";
import { NextResponse } from "next/server";
import { domainConfig } from "./config";

const CODE_SECONDS = 60;
const PURGE_AFTER_MS = 3_600_000;

export const sha256 = (v: string) =>
  createHash("sha256").update(v).digest("base64url");
export const randomToken = () => randomBytes(32).toString("base64url");

const activeMember = (
  where: { companyId: string } & ({ userId: string } | { id: string }),
) =>
  db.member.findFirst({
    where: { ...where, status: "ACTIVE", isOnboarded: true },
    select: { id: true },
  });

export async function issueHandoff(input: {
  userId: string;
  companyId: string;
  targetHost: string;
  stateHash: string;
  next: string;
}): Promise<{ code: string } | { error: "no-membership" }> {
  const now = new Date();
  // cleanup without a scheduler
  await db.authHandoff.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - PURGE_AFTER_MS) } },
  });
  const member = await activeMember({
    userId: input.userId,
    companyId: input.companyId,
  });
  if (!member) return { error: "no-membership" };
  await db.member.update({
    where: { id: member.id },
    data: { lastAccessed: now },
  });
  const code = randomToken();
  await db.authHandoff.create({
    data: {
      codeHash: sha256(code),
      stateHash: input.stateHash,
      userId: input.userId,
      companyId: input.companyId,
      memberId: member.id,
      targetHost: input.targetHost,
      next: input.next,
      expiresAt: new Date(now.getTime() + CODE_SECONDS * 1000),
    },
  });
  return { code };
}

export async function consumeHandoff(input: {
  code: string;
  state: string;
  host: string;
}): Promise<{
  userId: string;
  companyId: string;
  memberId: string;
  next: string;
} | null> {
  const codeHash = sha256(input.code);
  const now = new Date();
  // single conditional UPDATE: concurrent consumers race on one row, only one wins
  const { count } = await db.authHandoff.updateMany({
    where: {
      codeHash,
      consumedAt: null,
      expiresAt: { gt: now },
      targetHost: input.host,
      stateHash: sha256(input.state),
    },
    data: { consumedAt: now },
  });
  if (count !== 1) return null;
  const row = await db.authHandoff.findUnique({ where: { codeHash } });
  if (!row) return null;
  if (!(await activeMember({ id: row.memberId, companyId: row.companyId })))
    return null;
  return {
    userId: row.userId,
    companyId: row.companyId,
    memberId: row.memberId,
    next: row.next,
  };
}

// --- HTTP helpers shared by the /auth/handoff route handlers ---

export const handoffCookieName = (n: string) =>
  domainConfig().scheme === "https"
    ? `__Host-dr-handoff-${n}`
    : `dr-handoff-${n}`;

export const cookieBase = () => ({
  httpOnly: true,
  secure: domainConfig().scheme === "https",
  sameSite: "lax" as const,
  path: "/",
});

const NO_STORE = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

export const retryCount = (v: string | null) => {
  const r = Number.parseInt(v ?? "0", 10);
  return Number.isFinite(r) && r > 0 ? Math.min(r, 10) : 0;
};

// Location may be relative: the browser resolves it against the public host,
// whereas request.url behind the proxy is internal.
export const redirectTo = (location: string, status: 303 | 307) =>
  new NextResponse(null, {
    status,
    headers: { ...NO_STORE, Location: location },
  });

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const htmlPage = (
  status: number,
  title: string,
  text: string,
  link: { href: string; label: string },
) =>
  new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(
      title,
    )}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><main><h1>${escapeHtml(
      title,
    )}</h1><p>${escapeHtml(text)}</p><p><a href="${escapeHtml(
      link.href,
    )}">${escapeHtml(link.label)}</a></p></main></body></html>`,
    {
      status,
      headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8" },
    },
  );

export const notFound = () =>
  htmlPage(404, "Page not found", "This page doesn't exist.", {
    href: "/",
    label: "Go to the home page",
  });
