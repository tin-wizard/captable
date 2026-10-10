import { generatePublicId } from "@/common/id";
import { db } from "@/server/db";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { backfillSubdomains } from "../../scripts/backfill-subdomains";

vi.mock("@/server/domains/config", () => ({
  domainConfig: () => ({
    enabled: false, // backfill must work with the flag off
    canonicalHost: "dealroom.tin.info",
    baseDomain: "dealroom.tin.info",
    scheme: "https",
  }),
}));

const run = nanoid(6)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "x");
const ids: string[] = [];

const mk = (name: string, createdAt: Date) =>
  db.company
    .create({
      data: {
        name,
        publicId: generatePublicId(),
        createdAt,
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
    })
    .then((c) => {
      ids.push(c.id);
      return c;
    });

const primaries = () =>
  db.companyDomain.findMany({
    where: { companyId: { in: ids }, isPrimary: true },
    orderBy: { createdAt: "asc" },
  });

describe("backfillSubdomains", () => {
  let older: { id: string };
  let newer: { id: string };

  beforeAll(async () => {
    older = await mk(`Acme ${run}`, new Date("2001-01-01"));
    newer = await mk(`Acme ${run}`, new Date("2001-01-02"));
  });

  afterAll(async () => {
    await db.company.deleteMany({ where: { id: { in: ids } } });
  });

  it("dry run creates no rows", async () => {
    const res = await backfillSubdomains({ apply: false, companyIds: ids });
    expect(res.map((r) => r.action)).toEqual(["would-assign", "would-assign"]);
    expect(await primaries()).toHaveLength(0);
  });

  it("apply assigns one primary per company, oldest gets the plain label", async () => {
    const res = await backfillSubdomains({ apply: true, companyIds: ids });
    expect(res.map((r) => [r.companyId, r.label, r.action])).toEqual([
      [older.id, `acme-${run}`, "assigned"],
      [newer.id, `acme-${run}-2`, "assigned"],
    ]);
    expect(await primaries()).toHaveLength(2);
  });

  it("second apply is idempotent", async () => {
    const res = await backfillSubdomains({ apply: true, companyIds: ids });
    expect(res.map((r) => r.action)).toEqual([
      "skipped-has-domain",
      "skipped-has-domain",
    ]);
    expect(await primaries()).toHaveLength(2);
  });
});
