import { encode } from "@/lib/jwt";
import { expiryFromDays, isExpired } from "@/server/activity/link-state";
import { resolveRecipient } from "@/server/activity/resolve-recipient";
import { db } from "@/server/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tenant, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  cleanupFixtures,
  seedTenantA,
  seedTenantB,
} from "../helpers/tenant-fixtures";

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
});
afterAll(async () => {
  await cleanupFixtures(aIds, bIds, [a, b]);
});

describe("link-state", () => {
  it("null never expires; past expires; future does not", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired(new Date("2026-10-14T00:00:00Z"), now)).toBe(true);
    expect(isExpired(new Date("2026-10-16T00:00:00Z"), now)).toBe(false);
    expect(isExpired(now, now)).toBe(true); // the boundary instant is expired
  });
  it("expiryFromDays adds whole days", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    expect(expiryFromDays(7, now).toISOString()).toBe(
      "2026-10-22T00:00:00.000Z",
    );
  });
});

describe("resolveRecipient honours expiresAt", () => {
  const make = async (expiresAt: Date | null) => {
    const rec = await db.dataRoomRecipient.create({
      data: {
        dataRoomId: aIds.dataRoomId,
        email: `exp-${Date.now()}-${Math.random()}@example.com`,
        expiresAt,
      },
    });
    const token = await encode({
      companyId: a.companyId,
      dataRoomId: aIds.dataRoomId,
      recipientId: rec.id,
    });
    return { rec, token };
  };

  it("resolves a live link and a legacy (null) link", async () => {
    const live = await make(new Date(Date.now() + 86_400_000));
    const legacy = await make(null);
    expect(await resolveRecipient("DATA_ROOM", live.token)).not.toBeNull();
    expect(await resolveRecipient("DATA_ROOM", legacy.token)).not.toBeNull();
  });

  it("returns null for an expired link", async () => {
    const dead = await make(new Date(Date.now() - 1000));
    expect(await resolveRecipient("DATA_ROOM", dead.token)).toBeNull();
  });

  it("returns null for a revoked (deleted) recipient", async () => {
    const { rec, token } = await make(null);
    await db.dataRoomRecipient.delete({ where: { id: rec.id } });
    expect(await resolveRecipient("DATA_ROOM", token)).toBeNull();
  });
});
