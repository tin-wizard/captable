import { describe, expect, it } from "vitest";
import { assertTenantOwns } from "./tenant-guard";

const tx = (owned: Record<string, string>) => {
  const count = ({ where }: { where: { id: string; companyId: string } }) =>
    Promise.resolve(owned[where.id] === where.companyId ? 1 : 0);
  return {
    stakeholder: { count },
    shareClass: { count },
    equityPlan: { count },
  } as never;
};

describe("assertTenantOwns", () => {
  const db = tx({ s1: "A", c1: "A", c2: "B" });

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
});
