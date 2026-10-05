import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PARENT_SCOPED } from "@/server/tenant-db";
import { describe, expect, it } from "vitest";

// Static scan (no DB). Guards the tenant architecture from regressing.
const ROOTS = ["src/trpc/routers", "src/server/api/routes"];
const R = "src/trpc/routers/";

// Rule (a) exceptions: tenantless by design (no company in scope).
const ALLOWLIST_TENANTLESS: Record<string, string> = {
  [`${R}onboarding-router/router.ts`]: "creates the company; no tenant yet",
  [`${R}passkey-router/router.ts`]: "user-level credentials, not tenant data",
  [`${R}company-router/procedures/switch-company.ts`]:
    "reads the caller's own membership in another company",
  [`${R}member-router/procedures/get-profile.ts`]: "user's own profile",
  [`${R}member-router/procedures/update-profile.ts`]: "user's own profile",
  [`${R}member-router/procedures/accept-member.ts`]:
    "invitee has no active membership until accepting",
  [`${R}security-router/procedures/update-password.tsx`]:
    "user-level password change",
  [`${R}billing-router/procedures/get-products.ts`]:
    "global billing catalogue; BillingCustomer is global on purpose",
};

// Rule (c) exceptions: each verified to establish the parent first.
const ALLOWLIST_CHILD_CREATE: Record<string, string> = {
  [`${R}template-field-router/procedures/add-fields.ts`]:
    "template found with findFirstOrThrow({ publicId, companyId })",
  [`${R}template-router/procedures/create-template.ts`]:
    "children attach to the template created moments earlier in the same handler",
  [`${R}document-share-router/procedures/create-document-share.ts`]:
    "document verified with count({ id, companyId }) before the share is created",
  [`${R}data-room-router/router.ts`]:
    "room is created with companyId or updated by { publicId, companyId }",
};

// Rule (a) migration to-do list (Tasks 6-7): shrink to zero. Must stay exact.
const CURRENT_OFFENDERS: string[] = [];

const RAW_SQL = /\$(queryRaw|executeRaw)(Unsafe)?\b/;
// ctx.db, `ctx: { ..., db }` or `const { db } = ctx` (not ctx.tenant, not a
// `db: tx` literal handed to a helper, not `ctx: { tenant: { db } }`)
const CTX_DB =
  /ctx\.db\b|ctx\s*:\s*\{(?:(?!tenant)[^}])*\bdb\b(?!\s*:)|\{[^}]*\bdb\b[^}]*\}\s*=\s*ctx\b(?!\.)/;
const CHILD_MODELS = Object.keys(PARENT_SCOPED).map(
  (m) => m[0]?.toLowerCase() + m.slice(1),
);
const CHILD_CREATE = new RegExp(
  `\\b(?:tx|ctx\\.db|ctx\\.tenant\\.db|db)\\.(?:${CHILD_MODELS.join(
    "|",
  )})\\.create(?:Many)?\\(`,
);

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

const violatesA = (src: string) => {
  const s = stripComments(src);
  return (
    /\b(withAuth|withTenant|withAccessControl)\b/.test(s) && CTX_DB.test(s)
  );
};
const violatesB = (src: string) => RAW_SQL.test(stripComments(src));
const violatesC = (src: string) => CHILD_CREATE.test(stripComments(src));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const files = ROOTS.flatMap((r) => walk(path.resolve(process.cwd(), r)))
  .map((f) => path.relative(process.cwd(), f).split(path.sep).join("/"))
  .sort();
const src = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const hits = (pred: (s: string) => boolean) =>
  files.filter((f) => pred(src.get(f) ?? ""));

describe("tenant architecture guard", () => {
  it("scans a plausible number of files and the allowlists exist", () => {
    expect(files.length).toBeGreaterThan(50);
    for (const f of [
      ...Object.keys(ALLOWLIST_TENANTLESS),
      ...Object.keys(ALLOWLIST_CHILD_CREATE),
      ...CURRENT_OFFENDERS,
    ])
      expect(files, `allowlisted file missing: ${f}`).toContain(f);
  });

  it("(a) withAuth/withTenant/withAccessControl + ctx.db only in CURRENT_OFFENDERS or tenantless allowlist", () => {
    const bad = hits(violatesA).filter(
      (f) => !(f in ALLOWLIST_TENANTLESS) && !CURRENT_OFFENDERS.includes(f),
    );
    expect(
      bad,
      `use withTenant + ctx.tenant.db instead of withAuth + ctx.db:\n${bad.join(
        "\n",
      )}`,
    ).toEqual([]);
  });

  it("(a) CURRENT_OFFENDERS only lists files that still violate", () => {
    const now = new Set(hits(violatesA));
    const fixed = CURRENT_OFFENDERS.filter((f) => !now.has(f));
    expect(
      fixed,
      fixed.map((f) => `remove ${f} from CURRENT_OFFENDERS`).join("\n"),
    ).toEqual([]);
  });

  it("(a) tenantless allowlist entries are not also offenders", () => {
    expect(CURRENT_OFFENDERS.filter((f) => f in ALLOWLIST_TENANTLESS)).toEqual(
      [],
    );
  });

  it("(b) no raw SQL in routers or REST routes", () => {
    const bad = hits(violatesB);
    expect(bad, `raw SQL bypasses tenant scoping:\n${bad.join("\n")}`).toEqual(
      [],
    );
  });

  it("(c) no create/createMany on parent-scoped children without a verified parent", () => {
    const bad = hits(violatesC).filter((f) => !(f in ALLOWLIST_CHILD_CREATE));
    expect(
      bad,
      `check parent ownership first (then allowlist):\n${bad.join("\n")}`,
    ).toEqual([]);
  });

  it("scanner detects each rule on in-memory strings (not vacuous)", () => {
    expect(
      violatesA("export const p = withAuth.query(({ ctx }) => ctx.db.x)"),
    ).toBe(true);
    expect(
      violatesA("withAuth.query(async ({ ctx: { db, session } }) => 1)"),
    ).toBe(true);
    expect(violatesA("const { db } = ctx; withAuth")).toBe(true);
    expect(violatesA("withTenant.query(({ ctx }) => ctx.tenant.db.x)")).toBe(
      false,
    );
    expect(violatesA("// withAuth ctx.db")).toBe(false);
    expect(
      violatesA("withTenant.query(({ ctx }) => ctx.db.member.findMany())"),
    ).toBe(true);
    expect(
      violatesA("withAccessControl.mutation(async ({ ctx: { db } }) => 1)"),
    ).toBe(true);
    expect(
      violatesA("withAccessControl.query(({ ctx }) => ctx.tenant.db.x)"),
    ).toBe(false);
    expect(
      violatesA("withTenant.query(({ ctx: { tenant: { db } } }) => 1)"),
    ).toBe(false);
    expect(
      violatesA("withTenant.query(({ ctx }) => h({ ctx: { db: tx } }))"),
    ).toBe(false);
    expect(
      violatesA("withTenant.query(({ ctx }) => { const { db } = ctx.tenant })"),
    ).toBe(false);
    expect(violatesB("await db.$queryRaw`select 1`")).toBe(true);
    expect(violatesB("db.$executeRawUnsafe('x')")).toBe(true);
    expect(violatesB("db.user.findMany()")).toBe(false);
    expect(violatesC("await tx.templateField.createMany({})")).toBe(true);
    expect(violatesC("await ctx.tenant.db.documentShare.create({})")).toBe(
      true,
    );
    expect(violatesC("await tx.template.create({})")).toBe(false);
    expect(violatesC("await tx.templateField.deleteMany({})")).toBe(false);
  });
});
