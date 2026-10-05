import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { generatePublicId } from "@/common/id";
import { db } from "@/server/db";
import { getPresignedPutUrl, uploadFile } from "@/server/file-uploads";
import { tenantDb } from "@/server/tenant-db";
import { assertBucketUsable } from "@/server/tenant-guard";
import {
  MAX_PRIVATE_UPLOAD_BYTES,
  MAX_PUBLIC_UPLOAD_BYTES,
} from "@/trpc/routers/bucket-router/schema";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Tenant, callerFor, seedTwoTenants } from "../helpers/seed";
import {
  type AIds,
  type BIds,
  B_SECRET,
  cleanupFixtures,
  seedTenantA,
  seedTenantB,
} from "../helpers/tenant-fixtures";

// Presigning is a local computation (no network); fake bucket config only.
vi.hoisted(() => {
  Object.assign(process.env, {
    UPLOAD_ENDPOINT: "https://s3.test.invalid",
    UPLOAD_REGION: "us-east-1",
    UPLOAD_BUCKET_PUBLIC: "public-test",
    UPLOAD_BUCKET_PRIVATE: "private-test",
    UPLOAD_ACCESS_KEY_ID: "test-key",
    UPLOAD_SECRET_ACCESS_KEY: "test-secret",
  });
});

let a: Tenant;
let b: Tenant;
let aIds: AIds;
let bIds: BIds;
let aPub: string;
let bPub: string;
let callerA: ReturnType<typeof callerFor>;
const createdKeys: string[] = [];
const createdBucketIds: string[] = [];

// a bucket row straight through Prisma; companyId omitted = no owner
async function rawBucket(key: string, companyId?: string) {
  const bucket = await db.bucket.create({
    data: { ...bucketInput(key), companyId },
  });
  createdBucketIds.push(bucket.id);
  return bucket;
}
const rawDocument = (t: Tenant, bucketId: string) =>
  db.document.create({
    data: {
      companyId: t.companyId,
      uploaderId: t.memberId,
      publicId: generatePublicId(),
      name: "raw doc",
      bucketId,
    },
  });
const rawTemplate = (t: Tenant, bucketId: string) =>
  db.template.create({
    data: {
      companyId: t.companyId,
      uploaderId: t.memberId,
      publicId: generatePublicId(),
      name: "raw template",
      status: "DRAFT",
      bucketId,
    },
  });

const file = {
  fileName: "Board Minutes.pdf",
  contentType: "application/pdf",
  size: 1,
};
const bucketInput = (key: string) => ({
  name: "doc.pdf",
  key,
  mimeType: "application/pdf",
  size: 1,
  tags: [],
});

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants());
  aIds = await seedTenantA(a);
  bIds = await seedTenantB(b);
  aPub = a.session.user.companyPublicId;
  bPub = b.session.user.companyPublicId;
  callerA = callerFor(a);
});

afterAll(async () => {
  await db.bucket.deleteMany({
    where: {
      OR: [{ key: { in: createdKeys } }, { id: { in: createdBucketIds } }],
    },
  });
  await cleanupFixtures(aIds, bIds, [a, b]);
});

describe("bucket.presignUpload", () => {
  it("puts company files under the caller's company publicId", async () => {
    const res = await callerA.bucket.presignUpload({
      ...file,
      keyPrefix: "generic-documents",
    });
    expect(res.key.startsWith(`${aPub}/generic-documents-`)).toBe(true);
    expect(res.key).not.toContain(bPub);
    expect(res.url).toContain("X-Amz-Signature");
    expect(res.bucketUrl).not.toContain("?");
  });

  it("rejects a client-chosen identifier", async () => {
    await expect(
      callerA.bucket.presignUpload({
        ...file,
        keyPrefix: "generic-documents",
        identifier: bPub,
        companyPublicId: bPub,
      } as never),
    ).rejects.toThrow();
  });

  it("accepts a data-room prefix but not a path-like one", async () => {
    const res = await callerA.bucket.presignUpload({
      ...file,
      keyPrefix: "data-room/abc123",
    });
    expect(res.key.startsWith(`${aPub}/data-room/abc123-`)).toBe(true);
    await expect(
      callerA.bucket.presignUpload({ ...file, keyPrefix: "data-room/../x" }),
    ).rejects.toThrow();
  });

  it("rejects public prefixes and a malformed content type", async () => {
    await expect(
      callerA.bucket.presignUpload({
        ...file,
        keyPrefix: "profile-avatars" as never,
      }),
    ).rejects.toThrow();
    await expect(
      callerA.bucket.presignUpload({
        ...file,
        contentType: "not a type",
        keyPrefix: "generic-documents",
      }),
    ).rejects.toThrow();
  });
});

describe("bucket.presignPublicUpload", () => {
  it.each(["profile-avatars", "company-logos"] as const)(
    "puts %s under the session user's id",
    async (keyPrefix) => {
      const res = await callerA.bucket.presignPublicUpload({
        fileName: "me.png",
        contentType: "image/png",
        size: 1,
        keyPrefix,
      });
      expect(res.key.startsWith(`${a.userId}/${keyPrefix}-`)).toBe(true);
    },
  );

  it("rejects private prefixes", async () => {
    await expect(
      callerA.bucket.presignPublicUpload({
        fileName: "me.png",
        contentType: "image/png",
        size: 1,
        keyPrefix: "generic-documents" as never,
      }),
    ).rejects.toThrow();
  });

  it.each(["text/html", "image/svg+xml"])(
    "rejects %s (served publicly from the upload domain)",
    async (contentType) => {
      await expect(
        callerA.bucket.presignPublicUpload({
          fileName: "x.png",
          contentType: contentType as never,
          size: 1,
          keyPrefix: "profile-avatars",
        }),
      ).rejects.toThrow();
    },
  );
});

// The declared size is signed as content-length, so S3 refuses a PUT of any
// other length; the schemas cap what may be declared.
describe("upload size limit", () => {
  // a zod issue on `size` itself (not .strict() refusing an unknown key)
  const sizeIssue = /"path": \[\s*"size"\s*\]/;
  const signedHeaders = (url: string) =>
    new URL(url).searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [];
  const privatePresign = (size: number) =>
    callerA.bucket.presignUpload({
      ...file,
      size,
      keyPrefix: "generic-documents",
    });
  const publicPresign = (size: number) =>
    callerA.bucket.presignPublicUpload({
      fileName: "me.png",
      contentType: "image/png",
      size,
      keyPrefix: "profile-avatars",
    });

  it("private files: 25 MiB, public images: 5 MiB", () => {
    expect(MAX_PRIVATE_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_PUBLIC_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["over the private max", MAX_PRIVATE_UPLOAD_BYTES + 1],
  ])("presignUpload rejects size: %s", async (_label, size) => {
    await expect(privatePresign(size)).rejects.toThrow(sizeIssue);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["over the public max", MAX_PUBLIC_UPLOAD_BYTES + 1],
  ])("presignPublicUpload rejects size: %s", async (_label, size) => {
    await expect(publicPresign(size)).rejects.toThrow(sizeIssue);
  });

  it("both presigns reject a missing size", async () => {
    const { size: _size, ...noSize } = file;
    await expect(
      callerA.bucket.presignUpload({
        ...noSize,
        keyPrefix: "generic-documents",
      } as never),
    ).rejects.toThrow(sizeIssue);
    await expect(
      callerA.bucket.presignPublicUpload({
        fileName: "me.png",
        contentType: "image/png",
        keyPrefix: "profile-avatars",
      } as never),
    ).rejects.toThrow(sizeIssue);
  });

  it("accepts each max exactly and signs content-length", async () => {
    const priv = await privatePresign(MAX_PRIVATE_UPLOAD_BYTES);
    const pub = await publicPresign(MAX_PUBLIC_UPLOAD_BYTES);
    for (const { url } of [priv, pub]) {
      expect(signedHeaders(url)).toContain("content-length");
    }
  });

  it("getPresignedPutUrl signs content-length for server-side uploads", async () => {
    const { url } = await getPresignedPutUrl({
      fileName: "x.pdf",
      contentType: "application/pdf",
      size: 10,
      keyPrefix: "signed-esign-doc",
      identifier: "someone",
      bucketMode: "privateBucket",
    });
    expect(signedHeaders(url)).toContain("content-length");
  });

  it("bucket.create rejects a size over the private max", async () => {
    const { key } = await privatePresign(1);
    createdKeys.push(key);
    await expect(
      callerA.bucket.create({
        ...bucketInput(key),
        size: MAX_PRIVATE_UPLOAD_BYTES + 1,
      }),
    ).rejects.toThrow(sizeIssue);
    expect(await db.bucket.count({ where: { key } })).toBe(0);
  });
});

describe("getPresignedPutUrl extension", () => {
  it.each([
    ["a b#?.pñg", /\/generic-documents-a-b-[a-z0-9]{12}$/],
    ["x.exe?evil", /\/generic-documents-x-[a-z0-9]{12}$/],
    ["Report.PDF", /\/generic-documents-report-[a-z0-9]{12}\.PDF$/],
  ])("keeps only a plain extension for %s", async (fileName, shape) => {
    const { key, bucketUrl } = await getPresignedPutUrl({
      fileName,
      contentType: "application/pdf",
      size: 1,
      keyPrefix: "generic-documents",
      identifier: "someone",
      bucketMode: "publicBucket",
    });
    expect(key).toMatch(shape);
    expect(bucketUrl).toMatch(/generic-documents-[\w-]+(\.PDF)?$/);
  });
});

describe("bucket.getUrl", () => {
  it("signs A's own bucket by id and by key", async () => {
    const own = await db.bucket.findUniqueOrThrow({
      where: { id: aIds.bucketId },
    });
    const byId = await callerA.bucket.getUrl({ bucketId: own.id });
    const byKey = await callerA.bucket.getUrl({ key: own.key });
    expect(byId.key).toBe(own.key);
    expect(byKey.url).toContain("X-Amz-Signature");
  });

  it("refuses B's bucket by id and by key, returning no URL", async () => {
    const bKey = (
      await db.bucket.findUniqueOrThrow({ where: { id: bIds.bucketId } })
    ).key;
    for (const input of [{ bucketId: bIds.bucketId }, { key: bKey }]) {
      const err = await callerA.bucket
        .getUrl(input)
        .then((r) => r)
        .catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(String((err as Error).message)).not.toContain(B_SECRET);
    }
  });

  it("refuses a bucket with no owner", async () => {
    const orphan = await rawBucket(`${aPub}/generic-documents-null-owner.pdf`);
    await expect(
      callerA.bucket.getUrl({ bucketId: orphan.id }),
    ).rejects.toThrow();
    await expect(callerA.bucket.getUrl({ key: orphan.key })).rejects.toThrow();
  });
});

// document.get / template.get presign through the bucket relation, which the
// tenant client does not scope: A's own row pointing at a bucket A does not
// own must not yield a URL.
describe("document.get and template.get", () => {
  it("sign A's own document and template", async () => {
    const own = await db.document.findUniqueOrThrow({
      where: { id: aIds.documentId },
    });
    const doc = await callerA.document.get({ publicId: own.publicId });
    expect(doc.url).toContain("X-Amz-Signature");
    const tpl = await callerA.template.get({
      publicId: aIds.templatePublicId,
      isDraftOnly: false,
    });
    expect(tpl.url).toContain("X-Amz-Signature");
  });

  it.each([
    ["no owner", () => rawBucket(`${aPub}/generic-documents-n.pdf`)],
    [
      "B as owner",
      async () => db.bucket.findUniqueOrThrow({ where: { id: bIds.bucketId } }),
    ],
  ])("return no URL when the bucket has %s", async (_label, bucket) => {
    const { id } = await bucket();
    const doc = await rawDocument(a, id);
    const tpl = await rawTemplate(a, id);
    try {
      await expect(
        callerA.document.get({ publicId: doc.publicId }),
      ).rejects.toThrow();
      await expect(
        callerA.template.get({ publicId: tpl.publicId, isDraftOnly: false }),
      ).rejects.toThrow();
    } finally {
      await db.template.delete({ where: { id: tpl.id } });
      await db.document.delete({ where: { id: doc.id } });
    }
  });
});

describe("bucket.create", () => {
  it("stamps the caller's company and ignores a client companyId", async () => {
    const { key } = await callerA.bucket.presignUpload({
      ...file,
      keyPrefix: "generic-documents",
    });
    createdKeys.push(key);
    const bucket = await callerA.bucket.create({
      ...bucketInput(key),
      companyId: b.companyId,
    } as never);
    expect(bucket.companyId).toBe(a.companyId);
  });

  it.each([
    ["another company's prefix", () => `${bPub}/generic-documents-x.pdf`],
    ["no company prefix", () => "generic-documents-x.pdf"],
    ["a prefix that only starts like A's", () => `${aPub}x/doc.pdf`],
    [
      "a path that climbs out of A's",
      () => `${aPub}/../${bPub}/x-abcdefghijkl`,
    ],
    ["A's prefix with a wrong suffix", () => `${aPub}/generic-documents-x.pdf`],
    ["a suffix one char short", () => `${aPub}/generic-documents-abcdefghijk`],
  ])("rejects a key under %s", async (_label, key) => {
    createdKeys.push(key());
    await expect(callerA.bucket.create(bucketInput(key()))).rejects.toThrow();
    expect(await db.bucket.count({ where: { key: key() } })).toBe(0);
  });
});

describe("bucket.create with an issued key", () => {
  it.each(["generic-documents", "data-room/abc123"] as const)(
    "accepts the %s key presignUpload returned",
    async (keyPrefix) => {
      for (const fileName of [
        "Board Minutes.pdf",
        "no-extension",
        "#?.PDF",
        "Ünïcödé 数据 v2.final.docx",
      ]) {
        const { key } = await callerA.bucket.presignUpload({
          fileName,
          contentType: "application/pdf",
          size: 1,
          keyPrefix,
        });
        createdKeys.push(key);
        const bucket = await callerA.bucket.create(bucketInput(key));
        expect(bucket.key).toBe(key);
      }
    },
  );
});

describe("assertBucketUsable", () => {
  it("accepts A's bucket and rejects B's and unowned buckets", async () => {
    const ta = tenantDb(db, a.companyId);
    await expect(
      assertBucketUsable(ta, a.companyId, aIds.bucketId),
    ).resolves.toBeUndefined();
    await expect(
      assertBucketUsable(ta, a.companyId, bIds.bucketId),
    ).rejects.toThrow();
    await expect(
      assertBucketUsable(db, a.companyId, bIds.bucketId),
    ).rejects.toThrow();

    const orphan = await db.bucket.create({
      data: { ...bucketInput(`orphan-${Date.now()}.pdf`) },
    });
    createdKeys.push(orphan.key);
    await expect(
      assertBucketUsable(db, a.companyId, orphan.id),
    ).rejects.toThrow();
  });
});

describe("file-uploads module", () => {
  it("is not a server-action module", () => {
    const src = readFileSync("src/server/file-uploads.ts", "utf8");
    expect(src).not.toMatch(/["']use server["']/);
  });

  it("is never imported by value from a client module", () => {
    const out = execSync(
      "grep -rl '@/server/file-uploads' src || true",
    ).toString();
    const byValue =
      /import\s+(?!type\b)[^;]*from\s+["']@\/server\/file-uploads["']/;
    const clientImporters = out
      .split("\n")
      .filter(Boolean)
      .filter((f) => {
        const s = readFileSync(f, "utf8");
        return /^["']use client["']/m.test(s) && byValue.test(s);
      });
    expect(clientImporters).toEqual([]);
  });
});

// The migration's backfill, run for real against the local test DB inside a
// transaction that is rolled back, so other buckets are left as they were.
describe("Bucket.companyId backfill", () => {
  const MIGRATION =
    "prisma/migrations/20261005123250_bucket_company_owner/migration.sql";
  const REPORT = "docs/bucket-owner-backfill-report.sql";
  const statements = (file: string) =>
    readFileSync(file, "utf8")
      .replace(/--.*$/gm, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

  it("assigns an owner only when the key's first segment agrees", async () => {
    const aRow = await db.company.findUniqueOrThrow({
      where: { id: a.companyId },
    });
    const bRow = await db.company.findUniqueOrThrow({
      where: { id: b.companyId },
    });
    const n = Date.now();
    const seed = {
      pubOwned: [`${aRow.publicId}/generic-documents-p${n}`, [a], a.companyId],
      idOwned: [`${aRow.id}/signed-esign-doc-i${n}`, [a], a.companyId],
      templates: [`templates/new-safes-t${n}`, ["tpl"], a.companyId],
      foreign: [`${bRow.publicId}/generic-documents-f${n}`, [a], null],
      orphan: [`${aRow.publicId}/generic-documents-o${n}`, [], null],
      multiOne: [
        `${bRow.publicId}/generic-documents-m${n}`,
        [a, b],
        b.companyId,
      ],
      multiNone: [`zzz/generic-documents-z${n}`, [a, b], null],
    } as const;

    const ids: Record<string, string> = {};
    for (const [name, [key, refs]] of Object.entries(seed)) {
      const bucket = await rawBucket(key);
      ids[name] = bucket.id;
      for (const ref of refs) {
        if (ref === "tpl") await rawTemplate(a, bucket.id);
        else await rawDocument(ref, bucket.id);
      }
    }

    // the pre-deploy report names exactly the buckets that will stay NULL
    const report = await db.$queryRawUnsafe<
      { reason: string; bucket_ids: string[] }[]
    >(statements(REPORT)[0] as string);
    const reasonOf = (id: string) =>
      report.find((r) => r.bucket_ids.includes(id))?.reason ?? null;
    expect({
      foreign: reasonOf(ids.foreign as string),
      orphan: reasonOf(ids.orphan as string),
      multiNone: reasonOf(ids.multiNone as string),
      owned: ["pubOwned", "idOwned", "templates", "multiOne"].map((k) =>
        reasonOf(ids[k] as string),
      ),
    }).toEqual({
      foreign: "key-prefix mismatch",
      orphan: "orphan",
      multiNone: "multi-company",
      owned: [null, null, null, null],
    });

    const updates = statements(MIGRATION).filter((s) => /^UPDATE/i.test(s));
    expect(updates.length).toBeGreaterThan(0);
    const ROLLBACK = new Error("rollback");
    let owners: Record<string, string | null> = {};
    await db
      .$transaction(async (tx) => {
        for (const sql of updates) await tx.$executeRawUnsafe(sql);
        // running it twice changes nothing (idempotent)
        for (const sql of updates) await tx.$executeRawUnsafe(sql);
        const rows = await tx.bucket.findMany({
          where: { id: { in: Object.values(ids) } },
          select: { id: true, companyId: true },
        });
        owners = Object.fromEntries(
          Object.entries(ids).map(([name, id]) => [
            name,
            rows.find((r) => r.id === id)?.companyId ?? null,
          ]),
        );
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });

    expect(owners).toEqual(
      Object.fromEntries(
        Object.entries(seed).map(([name, [, , owner]]) => [name, owner]),
      ),
    );
  });
});

// The type a client declares must be the type S3 stores: without `content-type`
// in the signed headers a caller could PUT any type (text/html to a public key)
// whatever the presign said.
describe("upload content type is signed", () => {
  const signed = (url: string) =>
    new URL(url).searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [];

  it("presignUpload signs content-type together with content-length", async () => {
    const { url } = await callerA.bucket.presignUpload({
      ...file,
      size: 10,
      keyPrefix: "generic-documents",
    });
    expect(signed(url)).toEqual(["content-length", "content-type", "host"]);
  });

  it("presignPublicUpload signs content-type", async () => {
    const { url } = await callerA.bucket.presignPublicUpload({
      fileName: "me.png",
      contentType: "image/png",
      size: 10,
      keyPrefix: "profile-avatars",
    });
    expect(signed(url)).toEqual(["content-length", "content-type", "host"]);
  });

  it("getPresignedPutUrl signs content-type for server-side uploads", async () => {
    const { url } = await getPresignedPutUrl({
      contentType: "application/pdf",
      size: 10,
      fileName: "a.pdf",
      keyPrefix: "generic-documents",
      identifier: "srv",
      bucketMode: "privateBucket",
    });
    expect(signed(url)).toContain("content-type");
  });

  describe("server-side uploadFile sends exactly the type it signed", () => {
    const put = () =>
      vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 200 }));
    const options = {
      keyPrefix: "generic-documents",
      identifier: "srv",
    } as const;

    it("the file's own type", async () => {
      const fetchSpy = put();
      await uploadFile(
        new File(["%PDF"], "a.pdf", { type: "application/pdf" }),
        options,
      );
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(signed(url)).toContain("content-type");
      expect(init.headers).toMatchObject({ "Content-Type": "application/pdf" });
      fetchSpy.mockRestore();
    });

    it("application/octet-stream when the file has no type", async () => {
      const fetchSpy = put();
      await uploadFile(new File(["x"], "b.bin"), options);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(signed(url)).toContain("content-type");
      expect(init.headers).toMatchObject({
        "Content-Type": "application/octet-stream",
      });
      fetchSpy.mockRestore();
    });
  });
});
