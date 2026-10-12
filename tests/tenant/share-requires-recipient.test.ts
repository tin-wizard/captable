import { db } from "@/server/db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { type Tenant, callerFor, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  cleanupFixtures,
  seedTenantA,
  seedTenantB,
} from "../helpers/tenant-fixtures";

const roomEmit = vi.hoisted(() => vi.fn());
const updateEmit = vi.hoisted(() => vi.fn());
vi.mock("@/jobs/share-data-room-email", () => ({
  shareDataRoomEmailJob: { emit: roomEmit },
}));
vi.mock("@/jobs/share-update-email", () => ({
  shareUpdateEmailJob: { emit: updateEmit },
}));

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
let callerA: ReturnType<typeof callerFor>;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
  callerA = callerFor(a);
});

afterAll(async () => {
  await cleanupFixtures(aIds, bIds, [a, b]);
});

beforeEach(() => {
  roomEmit.mockClear();
  updateEmit.mockClear();
});

const roomRecipients = () =>
  db.dataRoomRecipient.count({ where: { dataRoomId: aIds.dataRoomId } });
const updateRecipients = () =>
  db.updateRecipient.count({ where: { updateId: aIds.updateId } });
const one = [{ value: "new-recipient@example.com", name: "New Person" }];

describe("share requires a recipient", () => {
  it("dataRoom.share rejects an empty recipient list", async () => {
    const before = await roomRecipients();
    await expect(
      callerA.dataRoom.share({
        dataRoomId: aIds.dataRoomId,
        others: [],
        selectedContacts: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await roomRecipients()).toBe(before);
    expect(roomEmit).not.toHaveBeenCalled();
  });

  it("update.share rejects an empty recipient list", async () => {
    const before = await updateRecipients();
    await expect(
      callerA.update.share({
        updateId: aIds.updateId,
        others: [],
        selectedContacts: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await updateRecipients()).toBe(before);
    expect(updateEmit).not.toHaveBeenCalled();
  });

  it("a valid dataRoom share still creates one recipient and one job", async () => {
    const before = await roomRecipients();
    await callerA.dataRoom.share({
      dataRoomId: aIds.dataRoomId,
      others: one,
      selectedContacts: [],
    });
    expect(await roomRecipients()).toBe(before + 1);
    expect(roomEmit).toHaveBeenCalledTimes(1);
  });

  it("a valid update share still creates one recipient and one job", async () => {
    const before = await updateRecipients();
    await callerA.update.share({
      updateId: aIds.updateId,
      others: one,
      selectedContacts: [],
    });
    expect(await updateRecipients()).toBe(before + 1);
    expect(updateEmit).toHaveBeenCalledTimes(1);
  });
});
