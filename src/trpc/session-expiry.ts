export const RELOAD_FLAG = "dr-unauthorized-reload";

type Deps = {
  storage: () => Storage;
  fetchSession: () => Promise<unknown>;
  reload: () => void;
};

const browserDeps: Deps = {
  storage: () => window.sessionStorage,
  fetchSession: () => fetch("/api/auth/session").then((r) => r.json()),
  reload: () => window.location.reload(),
};

// UNAUTHORIZED also means RBAC/membership denial, so reload only when the
// company-host session endpoint says the session is really gone ({}).
export async function reloadIfSessionGone(deps: Deps = browserDeps) {
  try {
    const storage = deps.storage();
    if (storage.getItem(RELOAD_FLAG)) return false;
    const s = (await deps.fetchSession()) as { user?: unknown } | null;
    if (s?.user) return false;
    storage.setItem(RELOAD_FLAG, "1");
  } catch {
    return false; // storage unavailable or fetch failed: never risk a loop
  }
  deps.reload();
  return true;
}

export function clearReloadFlag(storage: () => Storage = browserDeps.storage) {
  try {
    storage().removeItem(RELOAD_FLAG);
  } catch {}
}
