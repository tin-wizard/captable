import { generatePublicId } from "@/common/id";
import { encode } from "@/lib/jwt";
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
import { type Tenant, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  cleanupFixtures,
  seedTenantA,
  seedTenantB,
} from "../helpers/tenant-fixtures";

const getPresignedGetUrl = vi.hoisted(() =>
  vi.fn(async (key: string) => ({ key, url: `https://signed.test/${key}` })),
);
vi.mock("@/server/file-uploads", async (orig) => ({
  ...(await orig<typeof import("@/server/file-uploads")>()),
  getPresignedGetUrl,
}));

import { POST } from "@/app/api/activity/download/route";
import { attachmentFilename } from "@/server/file-uploads";

const DAY = 86_400_000;
let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
// a second room of company A holding its own bucket
let otherRoomId: string;
let otherBucketId: string;
let bucketKey: string;
let bucketName: string;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
  await db.dataRoomDocument.create({
    data: { dataRoomId: aIds.dataRoomId, documentId: aIds.documentId },
  });
  const bucket = await db.bucket.findUniqueOrThrow({
    where: { id: aIds.bucketId },
  });
  bucketKey = bucket.key;
  bucketName = bucket.name;

  const otherBucket = await db.bucket.create({
    data: {
      companyId: a.companyId,
      name: "other",
      key: `other/${generatePublicId()}.pdf`,
      mimeType: "application/pdf",
      size: 1,
      tags: [],
    },
  });
  otherBucketId = otherBucket.id;
  const otherDoc = await db.document.create({
    data: {
      companyId: a.companyId,
      uploaderId: a.memberId,
      publicId: generatePublicId(),
      name: "other doc",
      bucketId: otherBucket.id,
    },
  });
  const otherRoom = await db.dataRoom.create({
    data: {
      companyId: a.companyId,
      name: "other room",
      publicId: generatePublicId(),
      allowDownload: true,
    },
  });
  otherRoomId = otherRoom.id;
  await db.dataRoomDocument.create({
    data: { dataRoomId: otherRoom.id, documentId: otherDoc.id },
  });
});
afterAll(async () => {
  const companyId = { in: [a.companyId, b.companyId] };
  await db.downloadEvent.deleteMany({ where: { companyId } });
  await db.ndaAcceptance.deleteMany({ where: { companyId } });
  await db.dataRoom.deleteMany({ where: { id: otherRoomId } });
  await cleanupFixtures(aIds, bIds, [a, b]);
  await db.bucket.deleteMany({ where: { id: otherBucketId } });
});
beforeEach(async () => {
  getPresignedGetUrl.mockClear();
  await db.dataRoom.update({
    where: { id: aIds.dataRoomId },
    data: { allowDownload: true, requireNda: false },
  });
});

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/activity/download", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-real-ip": "203.0.113.77",
        "user-agent": `Mozilla/5.0 ${"x".repeat(600)}`,
      },
      body: JSON.stringify(body),
    }),
  );

const room = async (email: string, extra: object = {}) => {
  const r = await db.dataRoomRecipient.create({
    data: { dataRoomId: aIds.dataRoomId, email, ...extra },
  });
  const token = await encode({
    companyId: a.companyId,
    dataRoomId: aIds.dataRoomId,
    recipientId: r.id,
  });
  return { r, token };
};

const total = () => db.downloadEvent.count();

describe("download route", () => {
  it("records one event with a truncated IP and mints an attachment URL, no-store", async () => {
    const x = await room("dl-ok@example.com");
    const res = await post({ token: x.token, bucketId: aIds.bucketId });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      url: `https://signed.test/${bucketKey}`,
    });
    expect(getPresignedGetUrl).toHaveBeenCalledWith(bucketKey, {
      attachmentName: bucketName,
    });

    const rows = await db.downloadEvent.findMany({
      where: { recipientId: x.r.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyId: a.companyId,
      kind: "DATA_ROOM",
      targetId: aIds.dataRoomId,
      bucketId: aIds.bucketId,
      ip: "203.0.113.0",
    });
    expect(rows[0]?.userAgent).toHaveLength(512);
  });

  it("downloads off: 403, nothing recorded, no URL", async () => {
    await db.dataRoom.update({
      where: { id: aIds.dataRoomId },
      data: { allowDownload: false },
    });
    const x = await room("dl-off@example.com");
    const before = await total();
    expect(
      (await post({ token: x.token, bucketId: aIds.bucketId })).status,
    ).toBe(403);
    expect(await total()).toBe(before);
    expect(getPresignedGetUrl).not.toHaveBeenCalled();
  });

  it("a bucket of another room (same company) or another company: 404, nothing recorded", async () => {
    const x = await room("dl-wrong@example.com");
    const before = await total();
    expect(
      (await post({ token: x.token, bucketId: otherBucketId })).status,
    ).toBe(404);
    expect(
      (await post({ token: x.token, bucketId: bIds.bucketId })).status,
    ).toBe(404);
    expect(await total()).toBe(before);
    expect(getPresignedGetUrl).not.toHaveBeenCalled();
  });

  it("another company's recipient against this company's room: 404", async () => {
    const forged = await encode({
      companyId: a.companyId,
      dataRoomId: aIds.dataRoomId,
      recipientId: bIds.dataRoomRecipientId,
    });
    const crossed = await encode({
      companyId: b.companyId,
      dataRoomId: aIds.dataRoomId,
      recipientId: bIds.dataRoomRecipientId,
    });
    const before = await total();
    for (const token of [forged, crossed])
      expect((await post({ token, bucketId: aIds.bucketId })).status).toBe(404);
    expect(await total()).toBe(before);
  });

  it("NDA required: 403 before acceptance, 200 after", async () => {
    await db.dataRoom.update({
      where: { id: aIds.dataRoomId },
      data: { requireNda: true },
    });
    const x = await room("dl-nda@example.com");
    const before = await total();
    expect(
      (await post({ token: x.token, bucketId: aIds.bucketId })).status,
    ).toBe(403);
    expect(await total()).toBe(before);
    expect(getPresignedGetUrl).not.toHaveBeenCalled();

    await db.ndaAcceptance.create({
      data: {
        kind: "DATA_ROOM",
        targetId: aIds.dataRoomId,
        recipientId: x.r.id,
        companyId: a.companyId,
        text: "t",
        ip: "",
        userAgent: "",
      },
    });
    expect(
      (await post({ token: x.token, bucketId: aIds.bucketId })).status,
    ).toBe(200);
    expect(await total()).toBe(before + 1);
  });

  it("unknown, expired and revoked links: 404, nothing recorded", async () => {
    const before = await total();
    expect(
      (await post({ token: "nope", bucketId: aIds.bucketId })).status,
    ).toBe(404);
    const expired = await room("dl-exp@example.com", {
      expiresAt: new Date(Date.now() - DAY),
    });
    expect(
      (await post({ token: expired.token, bucketId: aIds.bucketId })).status,
    ).toBe(404);
    const gone = await room("dl-gone@example.com");
    await db.dataRoomRecipient.delete({ where: { id: gone.r.id } });
    expect(
      (await post({ token: gone.token, bucketId: aIds.bucketId })).status,
    ).toBe(404);
    expect(await total()).toBe(before);
    expect(getPresignedGetUrl).not.toHaveBeenCalled();
  });

  it("UPDATE kind and malformed bodies: 400", async () => {
    const x = await room("dl-bad@example.com");
    const before = await total();
    expect(
      (await post({ kind: "UPDATE", token: x.token, bucketId: aIds.bucketId }))
        .status,
    ).toBe(400);
    expect((await post({ token: x.token })).status).toBe(400);
    expect(
      (await post({ token: "x".repeat(5000), bucketId: aIds.bucketId })).status,
    ).toBe(400);
    expect(
      (await post({ token: x.token, bucketId: "b".repeat(65) })).status,
    ).toBe(400);
    expect(await total()).toBe(before);
  });
});

describe("attachmentFilename", () => {
  it("strips quotes, control characters, backslashes and path separators", () => {
    expect(attachmentFilename('a"b\\c/d\r\ne\u0000f.pdf')).toBe("abcdef.pdf");
    expect(attachmentFilename("report 2026.pdf")).toBe("report 2026.pdf");
  });
  it("falls back to download when nothing is left", () => {
    expect(attachmentFilename('"/\\\n')).toBe("download");
    expect(attachmentFilename("")).toBe("download");
  });
});
