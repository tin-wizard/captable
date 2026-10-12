import { db } from "@/server/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Tenant, callerFor, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  cleanupFixtures,
  seedTenantA,
  seedTenantB,
} from "../helpers/tenant-fixtures";

vi.mock("@/jobs/share-data-room-email", () => ({
  shareDataRoomEmailJob: { emit: vi.fn() },
}));
vi.mock("@/jobs/share-update-email", () => ({
  shareUpdateEmailJob: { emit: vi.fn() },
}));

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

const who = [{ value: "exp1@example.com", name: "E" }];
const room = () =>
  db.dataRoomRecipient.findFirstOrThrow({
    where: { dataRoomId: aIds.dataRoomId, email: "exp1@example.com" },
  });
const ms = (d: Date | null) => (d ? d.getTime() : Number.NaN);

describe("share expiry", () => {
  it("sets expiresAt from expiresInDays on a new recipient", async () => {
    await callerFor(a).dataRoom.share({
      dataRoomId: aIds.dataRoomId,
      others: who,
      selectedContacts: [],
      expiresInDays: 7,
    });
    const days = (ms((await room()).expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it("re-sharing renews an expired recipient", async () => {
    await db.dataRoomRecipient.updateMany({
      where: { dataRoomId: aIds.dataRoomId, email: "exp1@example.com" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await callerFor(a).dataRoom.share({
      dataRoomId: aIds.dataRoomId,
      others: who,
      selectedContacts: [],
    });
    expect(ms((await room()).expiresAt)).toBeGreaterThan(Date.now());
  });

  it("update.share sets expiresAt too, defaulting to 30 days", async () => {
    await callerFor(a).update.share({
      updateId: aIds.updateId,
      others: who,
      selectedContacts: [],
    });
    const rec = await db.updateRecipient.findFirstOrThrow({
      where: { updateId: aIds.updateId, email: "exp1@example.com" },
    });
    const days = (ms(rec.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it("rejects a length that is not offered", async () => {
    await expect(
      callerFor(a).dataRoom.share({
        dataRoomId: aIds.dataRoomId,
        others: who,
        selectedContacts: [],
        expiresInDays: 365 as never,
      }),
    ).rejects.toThrow();
  });
});
