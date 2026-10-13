import { describe, expect, it } from "vitest";
import { workspaceLoginUrl } from "./workspace-url";

const cfg = {
  baseDomain: "dealroom.tin.info",
  scheme: "https" as const,
  port: "",
};

describe("workspaceLoginUrl", () => {
  it("builds the company login url from a label", () => {
    expect(workspaceLoginUrl({ ...cfg, label: "konnect" })).toEqual({
      ok: true,
      url: "https://konnect.dealroom.tin.info/login",
    });
  });
  it("trims, lowercases and accepts a pasted full address", () => {
    expect(workspaceLoginUrl({ ...cfg, label: "  Konnect " })).toMatchObject({
      ok: true,
    });
    expect(
      workspaceLoginUrl({
        ...cfg,
        label: "https://konnect.dealroom.tin.info/x",
      }),
    ).toEqual({ ok: true, url: "https://konnect.dealroom.tin.info/login" });
    expect(
      workspaceLoginUrl({ ...cfg, label: "konnect.dealroom.tin.info" }),
    ).toEqual({ ok: true, url: "https://konnect.dealroom.tin.info/login" });
  });
  it("keeps a reserved label that is a real company (tin)", () => {
    expect(workspaceLoginUrl({ ...cfg, label: "tin" })).toEqual({
      ok: true,
      url: "https://tin.dealroom.tin.info/login",
    });
  });
  it("rejects empty and badly formed labels, never a host of another domain", () => {
    expect(workspaceLoginUrl({ ...cfg, label: "" })).toEqual({
      ok: false,
      reason: "empty",
    });
    for (const bad of [
      "a",
      "-ab",
      "ab-",
      "a--b",
      "a b",
      "evil.com",
      "a.b.dealroom.tin.info",
      "//evil.com",
      "x@y",
    ]) {
      expect(workspaceLoginUrl({ ...cfg, label: bad })).toEqual({
        ok: false,
        reason: "format",
      });
    }
  });
  it("passes the next path through safeNextPath only", () => {
    expect(
      workspaceLoginUrl({
        ...cfg,
        label: "konnect",
        next: "/abc/stakeholders",
      }),
    ).toEqual({
      ok: true,
      url: "https://konnect.dealroom.tin.info/login?callbackUrl=%2Fabc%2Fstakeholders",
    });
    expect(
      workspaceLoginUrl({ ...cfg, label: "konnect", next: "https://evil.com" }),
    ).toEqual({ ok: true, url: "https://konnect.dealroom.tin.info/login" });
  });
  it("includes the dev port", () => {
    expect(
      workspaceLoginUrl({
        baseDomain: "lvh.me",
        scheme: "http",
        port: "3000",
        label: "acme",
      }),
    ).toEqual({ ok: true, url: "http://acme.lvh.me:3000/login" });
  });
});
