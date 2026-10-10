import {
  RELOAD_FLAG,
  clearReloadFlag,
  reloadIfSessionGone,
} from "@/trpc/session-expiry";
import { describe, expect, it, vi } from "vitest";

const memStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  } as Storage;
};
const deps = (session: unknown, storage = memStorage()) => ({
  storage: () => storage,
  fetchSession: vi.fn(async () => session),
  reload: vi.fn(),
});

describe("reloadIfSessionGone", () => {
  it("does not reload while the session is present (RBAC denial)", async () => {
    const d = deps({ user: { id: "u" } });
    expect(await reloadIfSessionGone(d)).toBe(false);
    expect(await reloadIfSessionGone(d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
    expect(d.storage().getItem(RELOAD_FLAG)).toBeNull();
  });

  it("reloads once when the session is missing", async () => {
    const d = deps({});
    expect(await reloadIfSessionGone(d)).toBe(true);
    expect(await reloadIfSessionGone(d)).toBe(false);
    expect(d.reload).toHaveBeenCalledTimes(1);
    expect(d.fetchSession).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the flag is already set, until cleared", async () => {
    const d = deps({});
    d.storage().setItem(RELOAD_FLAG, "1");
    expect(await reloadIfSessionGone(d)).toBe(false);
    expect(d.fetchSession).not.toHaveBeenCalled();
    clearReloadFlag(d.storage);
    expect(await reloadIfSessionGone(d)).toBe(true);
  });

  it("skips the reload when storage is unavailable or the fetch fails", async () => {
    const d = deps({});
    d.storage = () => {
      throw new Error("SecurityError");
    };
    expect(await reloadIfSessionGone(d)).toBe(false);
    const f = deps({});
    f.fetchSession.mockRejectedValueOnce(new Error("offline"));
    expect(await reloadIfSessionGone(f)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
    expect(f.reload).not.toHaveBeenCalled();
    expect(() => clearReloadFlag(d.storage)).not.toThrow();
  });
});
