import { vi } from "vitest";

// Tests run against a throwaway local database only. Anything else (Neon, a
// shared dev DB) is refused so a test run can never touch real data.
export function assertLocalTestDb(url: string | undefined) {
  const host = url ? new URL(url).hostname : "";
  if (!["localhost", "127.0.0.1"].includes(host)) {
    throw new Error(
      "TEST_DATABASE_URL must point at a local database (never Neon)",
    );
  }
}

assertLocalTestDb(process.env.TEST_DATABASE_URL);

// Set before anything imports the Prisma client; a process env var takes
// precedence over .env, which on this machine points at Neon.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.SKIP_ENV_VALIDATION = "1";
process.env.NEXTAUTH_SECRET ??= "test-secret-test-secret-test-secret-test";
// set here, not per file: src/env.js captures it on first import (https => __Host- cookies)
process.env.NEXTAUTH_URL ??= "https://dealroom.tin.info";

// React's `cache` only exists in the server-components build of react
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));
