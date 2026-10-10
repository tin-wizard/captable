import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// seed.ts writes the legacy company's ids here (workers inherit process.env)
const seedFile = path.join(import.meta.dirname, ".seed.json");
if (existsSync(seedFile)) {
  for (const [k, v] of Object.entries(
    JSON.parse(readFileSync(seedFile, "utf8")),
  )) {
    process.env[k] ??= String(v);
  }
}

// the full spec creates data: only local (.test) and staging, never production
{
  const h = new URL(process.env.E2E_ROOT ?? "https://dealroom.test").hostname;
  const allowed = h.endsWith(".test") || h === "dealroom-staging.tin.info";
  if (!allowed && process.env.E2E_SMOKE !== "1") {
    throw new Error(
      `refusing to run the full e2e spec against ${h}; use E2E_SMOKE=1`,
    );
  }
}

const staging =
  !!process.env.E2E_ROOT && !process.env.E2E_ROOT.endsWith(".test");

export default defineConfig({
  testDir: import.meta.dirname,
  // the smoke spec is the only one allowed against production
  testMatch: process.env.E2E_SMOKE ? "smoke.spec.ts" : "subdomains.spec.ts",
  // the scenario is one ordered story; tests share the seeded database
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "../playwright-report" }],
  ],
  outputDir: "../test-results",
  use: {
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // real DNS on staging; locally *.dealroom.test is mapped to the Caddy proxy
    launchOptions: staging
      ? {}
      : {
          args: [
            "--host-resolver-rules=MAP dealroom.test 127.0.0.1, MAP *.dealroom.test 127.0.0.1",
          ],
        },
  },
});
