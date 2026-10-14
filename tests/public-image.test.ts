import { beforeEach, describe, expect, it, vi } from "vitest";

const getFileFromS3 = vi.fn();
vi.mock("@/server/file-uploads", () => ({ getFileFromS3 }));

const { GET } = await import("@/app/api/public-image/[...key]/route");

const get = (key: string) =>
  GET(new Request("http://x"), {
    params: Promise.resolve({ key: key.split("/") }),
  });

describe("public-image route", () => {
  beforeEach(() => getFileFromS3.mockReset());

  it("serves a logo with its image type", async () => {
    getFileFromS3.mockResolvedValue(new Uint8Array([1]));
    const res = await get("user1/company-logos-acme-abc123.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it.each([
    "cmp1/generic-documents-cap-table-abc.png",
    "user1/company-logos-x.pdf",
    "user1/company-logos-x.svg",
    "company-logos-x.png",
  ])("404s %s without touching the bucket", async (key) => {
    expect((await get(key)).status).toBe(404);
    expect(getFileFromS3).not.toHaveBeenCalled();
  });
});
