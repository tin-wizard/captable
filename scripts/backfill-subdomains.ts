// Assigns a platform subdomain to every company that has no primary domain.
// Dry run by default; pass --apply to write. Idempotent. Works with the
// subdomain feature flag OFF (reads/writes company_domain directly).
import { db } from "@/server/db";
import {
  DomainTakenError,
  assignPlatformSubdomain,
  suggestAvailableLabel,
} from "@/server/domains/registry";

type Row = {
  companyId: string;
  name: string;
  label: string | null;
  action: "assigned" | "would-assign" | "skipped-has-domain" | "failed";
};

// `companyIds` scopes the run; used only by tests, the CLI never sets it.
export async function backfillSubdomains(opts: {
  apply: boolean;
  companyIds?: string[];
}): Promise<Row[]> {
  const companies = await db.company.findMany({
    where: opts.companyIds ? { id: { in: opts.companyIds } } : undefined,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], // oldest wins name collisions
    select: { id: true, name: true, publicId: true },
  });
  const rows: Row[] = [];
  const reserved = new Set<string>(); // dry run only: labels chosen but not persisted

  for (const c of companies) {
    const base = { companyId: c.id, name: c.name };
    try {
      const has = await db.companyDomain.findFirst({
        where: { companyId: c.id, isPrimary: true },
        select: { id: true },
      });
      if (has) {
        rows.push({ ...base, label: null, action: "skipped-has-domain" });
        continue;
      }
      let label = await suggestAvailableLabel(db, c.name, c.publicId, {
        readonly: !opts.apply,
        extraTaken: reserved,
      });
      if (!label) throw new Error("no label available");
      if (!opts.apply) {
        reserved.add(label);
        rows.push({ ...base, label, action: "would-assign" });
        continue;
      }
      const admin = await db.member.findFirst({
        where: { companyId: c.id, role: "ADMIN", status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        select: { userId: true },
      });
      const assign = (l: string) =>
        db.$transaction((tx) =>
          assignPlatformSubdomain(tx, {
            companyId: c.id,
            label: l,
            createdById: admin?.userId ?? null,
          }),
        );
      try {
        await assign(label);
      } catch (e) {
        if (!(e instanceof DomainTakenError) || !e.suggestion) throw e;
        label = e.suggestion; // lost a race: retry once
        await assign(label);
      }
      rows.push({ ...base, label, action: "assigned" });
    } catch (e) {
      console.error(`failed ${c.id}:`, e instanceof Error ? e.message : e);
      rows.push({ ...base, label: null, action: "failed" });
    }
  }
  return rows;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set; refusing to run.");
    process.exit(1);
  }
  try {
    const url = new URL(process.env.DATABASE_URL);
    console.log(`Database host: ${url.host}${url.pathname}`);
  } catch {
    console.error("DATABASE_URL is not a valid URL; refusing to run.");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  console.log(apply ? "Mode: APPLY" : "Mode: dry run (pass --apply to write)");
  const rows = await backfillSubdomains({ apply });
  console.table(rows);
  if (rows.some((r) => r.action === "failed")) process.exitCode = 1;
  await db.$disconnect();
}

if (process.argv[1]?.endsWith("backfill-subdomains.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
