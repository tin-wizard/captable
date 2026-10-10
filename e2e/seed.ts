// Seeds the e2e database (local/CI Postgres only, never Neon):
//   admin@e2e.test (member of "Seed Co" and "Legacy Co"), outsider@e2e.test ("Outsider Co").
// "Legacy Co" starts with no subdomain and gets one from the production backfill.
import { writeFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { backfillSubdomains } from "../scripts/backfill-subdomains";
import { db } from "../src/server/db";

const PASSWORD = process.env.E2E_PASSWORD ?? "E2e-password-1!";
const host = new URL(process.env.DATABASE_URL ?? "postgres://x@invalid/")
  .hostname;
if (!["localhost", "127.0.0.1", "postgres"].includes(host)) {
  throw new Error("e2e seed refuses a non-local DATABASE_URL (never Neon)");
}

async function user(email: string, name: string) {
  const password = await bcrypt.hash(PASSWORD, 10);
  return db.user.upsert({
    where: { email },
    update: { password, emailVerified: new Date() },
    create: { email, name, password, emailVerified: new Date() },
  });
}

async function company(name: string, publicId: string, userId: string) {
  const c = await db.company.upsert({
    where: { publicId },
    update: {},
    create: {
      name,
      publicId,
      incorporationType: "c-corp",
      incorporationDate: new Date("2020-01-01"),
      incorporationCountry: "US",
      incorporationState: "DE",
      streetAddress: "1 Main St",
      city: "Wilmington",
      state: "DE",
      zipcode: "19801",
      country: "US",
    },
  });
  await db.member.upsert({
    where: { companyId_userId: { companyId: c.id, userId } },
    update: { status: "ACTIVE", isOnboarded: true, role: "ADMIN" },
    create: {
      companyId: c.id,
      userId,
      title: "CEO",
      status: "ACTIVE",
      isOnboarded: true,
      role: "ADMIN",
    },
  });
  return c;
}

async function main() {
  const admin = await user("admin@e2e.test", "E2E Admin");
  const outsider = await user("outsider@e2e.test", "E2E Outsider");
  await company("Seed Co", "e2eseedco001", admin.id);
  await company("Outsider Co", "e2eoutsider1", outsider.id);
  const legacy = await company("Legacy Co", "e2elegacyco1", admin.id);

  // simulate the production backfill for the legacy company only
  await backfillSubdomains({ apply: true, companyIds: [legacy.id] });
  const dom = await db.companyDomain.findFirstOrThrow({
    where: { companyId: legacy.id, isPrimary: true },
  });
  const out = {
    E2E_LEGACY_PUBLIC_ID: legacy.publicId,
    E2E_LEGACY_LABEL: dom.hostname.split(".")[0],
  };
  writeFileSync(
    path.join(import.meta.dirname, ".seed.json"),
    JSON.stringify(out),
  );
  console.log(JSON.stringify(out));
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
