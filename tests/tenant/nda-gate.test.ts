import { encode } from "@/lib/jwt";
import { db } from "@/server/db";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

const SIGNED = "signed.test";
const h = vi.hoisted(() => ({
  getPresignedGetUrl: vi.fn(async (key: string) => ({
    key,
    url: `https://signed.test/${key}?X-Amz-Signature=sig`,
  })),
}));
vi.mock("@/server/file-uploads", async (orig) => ({
  ...(await orig<typeof import("@/server/file-uploads")>()),
  getPresignedGetUrl: h.getPresignedGetUrl,
}));
vi.mock("@/server/domains/request-host", () => ({
  getRequestHost: async () => ({ kind: "canonical" }),
}));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => undefined }),
}));
// markers so the output shows whether the beacon / preview were mounted
vi.mock("@/components/share/view-beacon", () => ({
  ViewBeacon: () => createElement("i", { "data-beacon": "1" }),
  ViewNotice: () => null,
}));
vi.mock("@/components/file/preview", () => ({
  default: ({ url, name }: { url: string; name: string }) =>
    createElement("a", { href: url }, name),
}));

import BucketPage from "@/app/(documents)/data-rooms/[publicId]/[bucketId]/page";
import RoomPage from "@/app/(documents)/data-rooms/[publicId]/page";
import UpdatePage from "@/app/updates/[publicId]/page";

const DAY = 86_400_000;
const NDA = "Confidential: do not share <b>this</b> & keep it safe.";
let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
let roomPublicId: string;
let updatePublicId: string;
let bucketName: string;
let updateTitle: string;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
  roomPublicId = aIds.dataRoomPublicId;
  await db.dataRoomDocument.create({
    data: { dataRoomId: aIds.dataRoomId, documentId: aIds.documentId },
  });
  bucketName = (
    await db.bucket.findUniqueOrThrow({ where: { id: aIds.bucketId } })
  ).name;
  const u = await db.update.update({
    where: { id: aIds.updateId },
    data: { status: "PUBLIC", public: true, html: "<p>secret-update-body</p>" },
  });
  updatePublicId = u.publicId;
  updateTitle = u.title;
  await db.company.update({
    where: { id: a.companyId },
    data: { ndaText: NDA },
  });
});
afterAll(async () => {
  const companyId = { in: [a.companyId, b.companyId] };
  await db.ndaAcceptance.deleteMany({ where: { companyId } });
  await cleanupFixtures(aIds, bIds, [a, b]);
});
beforeEach(() => {
  h.getPresignedGetUrl.mockClear();
});

const setNda = async (on: boolean) => {
  await db.dataRoom.update({
    where: { id: aIds.dataRoomId },
    data: { requireNda: on },
  });
  await db.update.update({
    where: { id: aIds.updateId },
    data: { requireNda: on },
  });
};

const roomRecipient = async (expiresAt: Date | null = null) => {
  const r = await db.dataRoomRecipient.create({
    data: {
      dataRoomId: aIds.dataRoomId,
      email: `gate-${Date.now()}-${Math.random()}@example.com`,
      expiresAt,
    },
  });
  const token = await encode({
    companyId: a.companyId,
    dataRoomId: aIds.dataRoomId,
    recipientId: r.id,
  });
  return { id: r.id, token };
};

const updateRecipient = async () => {
  const r = await db.updateRecipient.create({
    data: {
      updateId: aIds.updateId,
      name: "gate",
      email: `gate-u-${Date.now()}-${Math.random()}@example.com`,
    },
  });
  const token = await encode({
    publicId: updatePublicId,
    companyId: a.companyId,
    recipientId: r.id,
  });
  return { id: r.id, token };
};

const accept = (
  kind: "DATA_ROOM" | "UPDATE",
  targetId: string,
  recipientId: string,
) =>
  db.ndaAcceptance.create({
    data: {
      companyId: a.companyId,
      kind,
      targetId,
      recipientId,
      text: NDA,
      ip: "203.0.113.0",
      userAgent: "test",
    },
  });

const html = async (el: Promise<unknown>) =>
  renderToStaticMarkup((await el) as React.ReactElement);

const room = (token: string) =>
  html(
    RoomPage({
      params: Promise.resolve({ publicId: roomPublicId }),
      searchParams: Promise.resolve({ token }),
    }),
  );
const bucket = (token: string) =>
  html(
    BucketPage({
      params: Promise.resolve({
        publicId: roomPublicId,
        bucketId: aIds.bucketId,
      }),
      searchParams: Promise.resolve({ token }),
    }),
  );
const update = (token: string) =>
  html(
    UpdatePage({
      params: Promise.resolve({ publicId: updatePublicId }),
      searchParams: Promise.resolve({ token }),
    }),
  );

// the NDA text is rendered as escaped plain text, never as HTML
const GATE =
  "Confidential: do not share &lt;b&gt;this&lt;/b&gt; &amp; keep it safe.";

const expectGate = (out: string) => {
  expect(out).toContain(GATE);
  expect(out).toContain("I have read and accept this notice");
  expect(out).not.toContain(SIGNED);
  expect(out).not.toContain("X-Amz-Signature");
  expect(out).not.toContain("data-beacon");
  expect(out).not.toContain(bucketName);
};

describe("NDA gate on the data room page", () => {
  it("requireNda on and not accepted: gate only, no file list, no beacon", async () => {
    await setNda(true);
    const { token } = await roomRecipient();
    const out = await room(token);
    expectGate(out);
    expect(out).not.toContain(aIds.bucketId);
    expect(h.getPresignedGetUrl).not.toHaveBeenCalled();
  });

  it("after acceptance: the normal room with its files and the beacon", async () => {
    await setNda(true);
    const r = await roomRecipient();
    await accept("DATA_ROOM", aIds.dataRoomId, r.id);
    const out = await room(r.token);
    expect(out).not.toContain(GATE);
    expect(out).toContain(bucketName);
    expect(out).toContain("data-beacon");
  });

  it("requireNda off: unchanged, no gate", async () => {
    await setNda(false);
    const { token } = await roomRecipient();
    const out = await room(token);
    expect(out).not.toContain(GATE);
    expect(out).toContain(bucketName);
    expect(out).toContain("data-beacon");
  });

  it("expired link after acceptance: the expired page, no gate, no files", async () => {
    await setNda(true);
    const r = await roomRecipient(new Date(Date.now() - DAY));
    await accept("DATA_ROOM", aIds.dataRoomId, r.id);
    const out = await room(r.token);
    expect(out).toContain("This link has expired");
    expect(out).not.toContain(GATE);
    expect(out).not.toContain(bucketName);
  });
});

describe("NDA gate on the bucket page (direct URL)", () => {
  it("not accepted: gate, no presigned URL is minted", async () => {
    await setNda(true);
    const { token } = await roomRecipient();
    const out = await bucket(token);
    expectGate(out);
    expect(h.getPresignedGetUrl).not.toHaveBeenCalled();
  });

  it("after acceptance: the file preview with its URL", async () => {
    await setNda(true);
    const r = await roomRecipient();
    await accept("DATA_ROOM", aIds.dataRoomId, r.id);
    const out = await bucket(r.token);
    expect(h.getPresignedGetUrl).toHaveBeenCalledOnce();
    expect(out).toContain(SIGNED);
    expect(out).toContain("data-beacon");
  });

  it("requireNda off: unchanged", async () => {
    await setNda(false);
    const { token } = await roomRecipient();
    const out = await bucket(token);
    expect(out).not.toContain(GATE);
    expect(out).toContain(SIGNED);
  });

  it("expired link after acceptance: the expired page, no URL", async () => {
    await setNda(true);
    const r = await roomRecipient(new Date(Date.now() - DAY));
    await accept("DATA_ROOM", aIds.dataRoomId, r.id);
    const out = await bucket(r.token);
    expect(out).toContain("This link has expired");
    expect(out).not.toContain(SIGNED);
    expect(h.getPresignedGetUrl).not.toHaveBeenCalled();
  });
});

describe("NDA gate on the update page", () => {
  it("not accepted: gate, no update body, no beacon; accepted: the update", async () => {
    await setNda(true);
    const r = await updateRecipient();
    const gated = await update(r.token);
    expect(gated).toContain(GATE);
    expect(gated).not.toContain("secret-update-body");
    expect(gated).not.toContain(updateTitle);
    expect(gated).not.toContain("data-beacon");

    await accept("UPDATE", aIds.updateId, r.id);
    const open = await update(r.token);
    expect(open).not.toContain(GATE);
    expect(open).toContain("secret-update-body");
    expect(open).toContain("data-beacon");
  });

  it("requireNda off: unchanged", async () => {
    await setNda(false);
    const r = await updateRecipient();
    const out = await update(r.token);
    expect(out).not.toContain(GATE);
    expect(out).toContain("secret-update-body");
  });
});
