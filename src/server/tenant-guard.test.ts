import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  assertBucketUsable,
  assertTenantOwns,
  runSerializable,
} from "./tenant-guard";

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
  // bucket id -> owning company (null: legacy orphan)
  const owners: Record<string, string | null> = {
    own: "A",
    bBkt: "B",
    orphan: null,
  };
  const db = {
    bucket: {
      count: ({ where }: { where: { id: string; companyId: string } }) =>
        Promise.resolve(owners[where.id] === where.companyId ? 1 : 0),
    },
  } as never;

  it("allows the company's own bucket", async () => {
    await expect(assertBucketUsable(db, "A", "own")).resolves.toBeUndefined();
  });

  it.each(["bBkt", "orphan", "nope"])("rejects bucket %s", async (id) => {
    await expect(assertBucketUsable(db, "A", id)).rejects.toThrow(
      "Invalid reference",
    );
  });
});

describe("runSerializable", () => {
  const p2034 = () =>
    new Prisma.PrismaClientKnownRequestError("write conflict", {
      code: "P2034",
      clientVersion: "test",
    });

  it("runs at SERIALIZABLE and retries a serialization failure once", async () => {
    const tx = vi.fn().mockRejectedValueOnce(p2034()).mockResolvedValue("ok");
    await expect(runSerializable(tx)).resolves.toBe("ok");
    expect(tx).toHaveBeenCalledTimes(2);
    expect(tx).toHaveBeenCalledWith({ isolationLevel: "Serializable" });
  });

  it("reports a second serialization failure as CONFLICT", async () => {
    const tx = vi.fn().mockRejectedValue(p2034());
    await expect(runSerializable(tx)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/try again/i),
    });
    expect(tx).toHaveBeenCalledTimes(2);
  });

  it("rethrows any other error without retrying", async () => {
    const tx = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(runSerializable(tx)).rejects.toThrow("boom");
    expect(tx).toHaveBeenCalledTimes(1);
  });
});
