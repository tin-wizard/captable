import { describe, expect, it } from "vitest";
import { assertBucketUsable, assertTenantOwns } from "./tenant-guard";

const tx = (owned: Record<string, string>) => {
  const count = ({ where }: { where: { id: string; companyId: string } }) =>
    Promise.resolve(owned[where.id] === where.companyId ? 1 : 0);
  return {
    stakeholder: { count },
    shareClass: { count },
    equityPlan: { count },
    member: { count },
    customRole: { count },
    document: { count },
  } as never;
};

describe("assertTenantOwns", () => {
  const db = tx({ s1: "A", c1: "A", c2: "B", m2: "B", r2: "B", d2: "B" });

  it("accepts references owned by the company and ignores empty ones", async () => {
    await expect(
      assertTenantOwns(db, "A", {
        stakeholderId: "s1",
        shareClassId: "c1",
        equityPlanId: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a reference owned by another company", async () => {
    await expect(
      assertTenantOwns(db, "A", { shareClassId: "c2" }),
    ).rejects.toThrow("Invalid reference");
  });

  it.each([{ memberId: "m2" }, { customRoleId: "r2" }, { documentId: "d2" }])(
    "rejects another company's %o",
    async (ref) => {
      await expect(assertTenantOwns(db, "A", ref)).rejects.toThrow(
        "Invalid reference",
      );
    },
  );
});

describe("assertBucketUsable", () => {
  // bucket id -> companies whose documents / templates reference it
  const docs: Record<string, string[]> = { own: ["A"], bDoc: ["B"] };
  const templates: Record<string, string[]> = { own: ["A"], bTpl: ["B"] };
  const known = ["fresh", "own", "bDoc", "bTpl"];
  type Clause = { some: { companyId: { not: string } } };
  type Where = {
    id: string;
    NOT: { documents?: Clause; templates?: Clause }[];
  };
  // mirrors the relation-filter query: bucket exists and NEITHER relation
  // has a row from another company (evaluates every NOT entry)
  const db = {
    bucket: {
      count: ({ where }: { where: Where }) => {
        const foreign = (refs: Record<string, string[]>, c?: Clause) =>
          c
            ? (refs[where.id] ?? []).some((x) => x !== c.some.companyId.not)
            : false;
        const blocked = where.NOT.some(
          (n) => foreign(docs, n.documents) || foreign(templates, n.templates),
        );
        return Promise.resolve(known.includes(where.id) && !blocked ? 1 : 0);
      },
    },
  } as never;

  it("allows a fresh bucket or one only this company references", async () => {
    await expect(assertBucketUsable(db, "A", "fresh")).resolves.toBeUndefined();
    await expect(assertBucketUsable(db, "A", "own")).resolves.toBeUndefined();
  });

  it("rejects a missing bucket", async () => {
    await expect(assertBucketUsable(db, "A", "nope")).rejects.toThrow();
  });

  it.each(["bDoc", "bTpl"])(
    "rejects a bucket only another company's %s references",
    async (id) => {
      await expect(assertBucketUsable(db, "A", id)).rejects.toThrow();
    },
  );
});
