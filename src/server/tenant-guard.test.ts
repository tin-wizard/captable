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
  // bucket id -> companies whose documents/templates reference it
  const refs: Record<string, string[]> = { fresh: [], own: ["A"], b: ["B"] };
  const foreign = ({
    where,
  }: { where: { bucketId: string; companyId: { not: string } } }) =>
    Promise.resolve(
      (refs[where.bucketId] ?? []).filter((c) => c !== where.companyId.not)
        .length,
    );
  const db = {
    bucket: {
      count: ({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id in refs ? 1 : 0),
    },
    document: { count: foreign },
    template: { count: foreign },
  } as never;

  it("allows a fresh bucket or one only this company references", async () => {
    await expect(assertBucketUsable(db, "A", "fresh")).resolves.toBeUndefined();
    await expect(assertBucketUsable(db, "A", "own")).resolves.toBeUndefined();
  });

  it("rejects a missing bucket or one another company references", async () => {
    await expect(assertBucketUsable(db, "A", "nope")).rejects.toThrow();
    await expect(assertBucketUsable(db, "A", "b")).rejects.toThrow();
  });
});
