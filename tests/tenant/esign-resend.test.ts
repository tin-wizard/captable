import { generatePublicId } from "@/common/id";
import { decode } from "@/lib/jwt";
import { queue } from "@/lib/queue";
import { db } from "@/server/db";
import { appRouter } from "@/trpc/api/root";
import {
  DecodeEmailToken,
  EncodeEmailToken,
} from "@/trpc/routers/template-field-router/procedures/add-fields";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Tenant, callerFor, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  cleanupFixtures,
  seedTenantA,
  seedTenantB,
  snapshotB,
} from "../helpers/tenant-fixtures";

/**
 * template.resendLink: e-sign links expire, so the sender can mint a fresh one
 * for the signer whose turn it is, and only for that signer.
 */

// @/env snapshots process.env at import; presigning is a local computation
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_BASE_URL ||= "http://localhost:3000";
  Object.assign(process.env, {
    UPLOAD_ENDPOINT: "https://s3.test.invalid",
    UPLOAD_REGION: "us-east-1",
    UPLOAD_BUCKET_PUBLIC: "public-test",
    UPLOAD_BUCKET_PRIVATE: "private-test",
    UPLOAD_ACCESS_KEY_ID: "test-key",
    UPLOAD_SECRET_ACCESS_KEY: "test-secret",
  });
});

type Status = "DRAFT" | "PENDING" | "COMPLETE" | "CANCELLED";
type RStatus = "SENT" | "SIGNED" | "PENDING";

let tenants: { a: Tenant; b: Tenant };
let a: AIds;
let b: BIds;

const anon = appRouter.createCaller({
  db,
  session: null,
  requestIp: "127.0.0.1",
  userAgent: "vitest",
  headers: new Headers(),
  host: { kind: "canonical" },
});

const code = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: { code?: string }) => e.code ?? String(e),
  );

async function envelope(status: Status, recipients: RStatus[]) {
  const template = await db.template.create({
    data: {
      companyId: a.companyId,
      uploaderId: a.memberId,
      bucketId: a.bucketId,
      publicId: generatePublicId(),
      name: `resend ${status}`,
      status,
      orderedDelivery: recipients.length > 1,
    },
  });
  const ids: string[] = [];
  for (const [i, s] of recipients.entries()) {
    const r = await db.esignRecipient.create({
      data: {
        templateId: template.id,
        email: `resend-${i}@example.com`,
        name: `signer ${i}`,
        status: s,
      },
    });
    ids.push(r.id);
  }
  return { templateId: template.id, recipientIds: ids };
}

// the e-sign email job is enqueued in pg-boss; nothing is sent from tests
const send = vi.spyOn(queue, "send");

beforeAll(async () => {
  // pg-boss send resolves the job id when queued, null when a singleton drops it
  send.mockResolvedValue("job-id");
  vi.spyOn(queue, "insert").mockResolvedValue(undefined as never);
  tenants = await seedTwoTenants();
  a = await seedTenantA(tenants.a);
  b = await seedTenantB(tenants.b);
});

afterAll(async () => {
  await cleanupFixtures(a, b, [tenants.a, tenants.b]);
  vi.restoreAllMocks();
});

describe("template.resendLink", () => {
  it("mints a working token for the current signer and emails it", async () => {
    const { templateId, recipientIds } = await envelope("PENDING", ["SENT"]);
    const recipientId = recipientIds[0] as string;
    send.mockClear();
    const auditsBefore = await db.audit.count({
      where: { companyId: a.companyId },
    });

    const res = await callerFor(tenants.a).template.resendLink({
      templateId,
      recipientId,
    });
    expect(res).toMatchObject({ success: true });

    // the same e-sign job as the original send, to that recipient
    expect(send).toHaveBeenCalledTimes(1);
    const [name, data] = send.mock.calls[0] as unknown as [
      string,
      { email: string; token: string; recipient: { id: string } },
    ];
    expect(name).toBe("email.esign-notification");
    expect(data.email).toBe("resend-0@example.com");
    expect(data.recipient.id).toBe(recipientId);

    // the token decodes to this recipient and opens the signing page
    expect(await DecodeEmailToken(data.token)).toEqual({
      id: templateId,
      rec: recipientId,
    });
    const { payload } = await decode(data.token);
    expect(payload.exp).toBeGreaterThan(Date.now() / 1000);
    const fields = await anon.template.getSigningFields({ token: data.token });
    expect(fields).toMatchObject({ templateId, recipientId });

    // audited; recipient status unchanged
    expect(await db.audit.count({ where: { companyId: a.companyId } })).toBe(
      auditsBefore + 1,
    );
    const r = await db.esignRecipient.findUnique({
      where: { id: recipientId },
    });
    expect(r?.status).toBe("SENT");
  });

  it("throttles per recipient: a send dropped by pg-boss is TOO_MANY_REQUESTS and not audited", async () => {
    const { templateId, recipientIds } = await envelope("PENDING", ["SENT"]);
    const recipientId = recipientIds[0] as string;
    send.mockClear();
    const audits = () => db.audit.count({ where: { companyId: a.companyId } });

    await callerFor(tenants.a).template.resendLink({ templateId, recipientId });
    expect(send.mock.calls[0]?.[2]).toMatchObject({
      singletonKey: `esign-resend-${recipientId}`,
      singletonSeconds: 60,
    });

    const before = await audits();
    send.mockResolvedValueOnce(null);
    const err = await callerFor(tenants.a)
      .template.resendLink({ templateId, recipientId })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: expect.stringMatching(/wait a minute/i),
    });
    expect(await audits()).toBe(before);
  });

  it.each(["DRAFT", "CANCELLED", "COMPLETE"] as const)(
    "is refused for a %s template",
    async (status) => {
      const { templateId, recipientIds } = await envelope(status, ["SENT"]);
      send.mockClear();
      expect(
        await code(
          callerFor(tenants.a).template.resendLink({
            templateId,
            recipientId: recipientIds[0] as string,
          }),
        ),
      ).toBe("BAD_REQUEST");
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("is refused for a recipient who already signed", async () => {
    const { templateId, recipientIds } = await envelope("PENDING", [
      "SIGNED",
      "SENT",
    ]);
    send.mockClear();
    expect(
      await code(
        callerFor(tenants.a).template.resendLink({
          templateId,
          recipientId: recipientIds[0] as string,
        }),
      ),
    ).toBe("BAD_REQUEST");
    expect(send).not.toHaveBeenCalled();
  });

  it("is refused for an ordered recipient whose turn has not come", async () => {
    const { templateId, recipientIds } = await envelope("PENDING", [
      "SENT",
      "PENDING",
    ]);
    send.mockClear();
    expect(
      await code(
        callerFor(tenants.a).template.resendLink({
          templateId,
          recipientId: recipientIds[1] as string,
        }),
      ),
    ).toBe("BAD_REQUEST");
    expect(send).not.toHaveBeenCalled();
  });

  it("is refused for a recipient of another template", async () => {
    const one = await envelope("PENDING", ["SENT"]);
    const two = await envelope("PENDING", ["SENT"]);
    expect(
      await code(
        callerFor(tenants.a).template.resendLink({
          templateId: one.templateId,
          recipientId: two.recipientIds[0] as string,
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("treats another company's live envelope as not found and leaves it untouched", async () => {
    // make B's envelope resendable for B, so only the tenant check can refuse
    await db.template.update({
      where: { id: b.templateId },
      data: { status: "PENDING" },
    });
    await db.esignRecipient.update({
      where: { id: b.recipientId },
      data: { status: "SENT" },
    });
    const before = await snapshotB(b);
    send.mockClear();

    expect(
      await code(
        callerFor(tenants.a).template.resendLink({
          templateId: b.templateId,
          recipientId: b.recipientId,
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(send).not.toHaveBeenCalled();
    expect(await snapshotB(b)).toEqual(before);
  });
});

describe("an old link to a cancelled envelope", () => {
  it("returns the status only: no fields and no document URL", async () => {
    const { templateId, recipientIds } = await envelope("CANCELLED", ["SENT"]);
    const token = await EncodeEmailToken({
      templateId,
      recipientId: recipientIds[0] as string,
    });
    const res = await anon.template.getSigningFields({ token });
    expect(res.status).toBe("CANCELLED");
    expect(res.fields).toEqual([]);
    expect(res.signableFields).toEqual([]);
    expect(res.url).toBe("");
  });
});
