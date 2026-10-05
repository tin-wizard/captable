import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PARENT_SCOPED } from "@/server/tenant-db";
import { describe, expect, it } from "vitest";

// Static scan (no DB). Guards the tenant architecture from regressing.
const ROOTS = ["src/trpc/routers", "src/server/api/routes"];
const R = "src/trpc/routers/";
// Rule (f) only: pages/layouts must not touch the global db at all
const PAGES_ROOT = "src/app/(authenticated)";

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

// Rule (d) exceptions: REST routes that keep the global services db.
const API = "src/server/api/routes/";
const ALLOWLIST_REST_GLOBAL: Record<string, string> = {
  [`${API}company/getMany.ts`]:
    "lists every company the caller is a member of (cross-company)",
  [`${API}company/getOne.ts`]:
    "checks the caller's membership in the requested company itself",
  [`${API}_example.ts`]: "example route, not registered",
};

// Rule (a) migration to-do list (Tasks 6-7): shrink to zero. Must stay exact.
const CURRENT_OFFENDERS: string[] = [];

const RAW_SQL = /\$(queryRaw|executeRaw)(Unsafe)?\b/;
// ctx.db, `ctx: { ..., db }` or `const { db } = ctx` (not ctx.tenant, not a
// `db: tx` literal handed to a helper, not `ctx: { tenant: { db } }`)
const CTX_DB_SIMPLE = /ctx\.db\b|ctx\s*:\s*\{(?:(?!tenant)[^}])*\bdb\b(?!\s*:)/;

// `const { db, membership: { companyId } } = ctx`: a regex stops at the first
// nested `}`, so walk back to the matching `{` and look at the top level only
// (`tenant: { db }` is nested and therefore fine).
function destructuresCtxDb(s: string) {
  for (const m of s.matchAll(/\}\s*=\s*ctx\b(?!\.)/g)) {
    let depth = 0;
    let i = m.index ?? 0;
    for (; i >= 0; i--) {
      if (s[i] === "}") depth++;
      else if (s[i] === "{" && --depth === 0) break;
    }
    let body = s.slice(i + 1, m.index);
    let prev: string;
    do {
      prev = body;
      body = body.replace(/\{[^{}]*\}/g, "");
    } while (body !== prev);
    if (/\bdb\b(?!\s*:)/.test(body)) return true;
  }
  return false;
}
const CTX_DB = {
  test: (s: string) => CTX_DB_SIMPLE.test(s) || destructuresCtxDb(s),
};
const CHILD_MODELS = Object.keys(PARENT_SCOPED).map(
  (m) => m[0]?.toLowerCase() + m.slice(1),
);
const CHILD_CREATE = new RegExp(
  `\\b(?:tx|ctx\\.db|ctx\\.tenant\\.db|db)\\.(?:${CHILD_MODELS.join(
    "|",
  )})\\.create(?:Many)?\\(`,
);

// a router that imports the global client by value can bypass ctx.tenant.db
const IMPORTS_GLOBAL_DB =
  /^import\s+(?!type\b)[^;]*from\s+["']@\/server\/db["']/m;

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

const violatesA = (src: string) => {
  const s = stripComments(src);
  return (
    /\b(withAuth|withTenant|withAccessControl)\b/.test(s) && CTX_DB.test(s)
  );
};
// `c.get("services").db` or `const { db } = c.get("services")`
const SERVICES_DB =
  /c\.get\(\s*["']services["']\s*\)\.db\b|\{[^}]*\bdb\b[^}]*\}\s*=\s*c\.get\(\s*["']services["']\s*\)/;
const violatesD = (src: string) => SERVICES_DB.test(stripComments(src));
// pages: use getServerTenant().db (src/server/tenant.ts), never the global db
const violatesF = (src: string) => IMPORTS_GLOBAL_DB.test(stripComments(src));
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
// Rule (f) exceptions: pages that legitimately need the global db (none yet).
const ALLOWLIST_PAGES_GLOBAL: Record<string, string> = {};
const pageFiles = walk(path.resolve(process.cwd(), PAGES_ROOT))
  .map((f) => path.relative(process.cwd(), f).split(path.sep).join("/"))
  .sort();
const hits = (pred: (s: string) => boolean) =>
  files.filter((f) => pred(src.get(f) ?? ""));

describe("tenant architecture guard", () => {
  it("scans a plausible number of files and the allowlists exist", () => {
    expect(files.length).toBeGreaterThan(50);
    for (const f of [
      ...Object.keys(ALLOWLIST_TENANTLESS),
      ...Object.keys(ALLOWLIST_CHILD_CREATE),
      ...Object.keys(ALLOWLIST_REST_GLOBAL),
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

  it("(e) routers never import the global db client by value", () => {
    const bad = hits((s) => IMPORTS_GLOBAL_DB.test(stripComments(s))).filter(
      (f) => !(f in ALLOWLIST_TENANTLESS),
    );
    expect(
      bad,
      `import type only; use ctx.tenant.db (or allowlist as tenantless):\n${bad.join(
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

  it('(d) REST routes use the tenant-scoped c.get("tenantDb"), not the services db', () => {
    const bad = hits(violatesD).filter(
      (f) => f.startsWith(API) && !(f in ALLOWLIST_REST_GLOBAL),
    );
    expect(
      bad,
      `use c.get("tenantDb") instead of the global services db:\n${bad.join(
        "\n",
      )}`,
    ).toEqual([]);
  });

  it("(f) authenticated pages never import the global db client by value", () => {
    const bad = pageFiles.filter(
      (f) =>
        violatesF(readFileSync(f, "utf8")) && !(f in ALLOWLIST_PAGES_GLOBAL),
    );
    expect(
      bad,
      `use getServerTenant().db from "@/server/tenant":\n${bad.join("\n")}`,
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
    expect(
      violatesA(
        "withAccessControl; const { db, membership: { companyId } } = ctx",
      ),
    ).toBe(true);
    expect(
      violatesA(
        "withAccessControl; const { tenant: { db }, membership: { companyId } } = ctx",
      ),
    ).toBe(false);
    expect(IMPORTS_GLOBAL_DB.test('import { db } from "@/server/db";')).toBe(
      true,
    );
    expect(
      IMPORTS_GLOBAL_DB.test('import type { TPrisma } from "@/server/db";'),
    ).toBe(false);
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
    expect(violatesD('const { db, audit } = c.get("services");')).toBe(true);
    expect(
      violatesD("const x = await c.get('services').db.share.findMany()"),
    ).toBe(true);
    expect(violatesD('const { audit, client } = c.get("services");')).toBe(
      false,
    );
    expect(violatesD('const db = c.get("tenantDb");')).toBe(false);
    expect(violatesF('import { db } from "@/server/db";')).toBe(true);
    expect(violatesF('import type { TPrisma } from "@/server/db";')).toBe(
      false,
    );
    expect(violatesF('// import { db } from "@/server/db";')).toBe(false);
  });
});
