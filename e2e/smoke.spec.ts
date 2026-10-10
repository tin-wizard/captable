import { expect, test } from "@playwright/test";

// Production smoke: minimal and non-destructive. Never run subdomains.spec.ts against production.
// Run with E2E_SMOKE=1. Needs E2E_ROOT, E2E_SMOKE_EMAIL/PASSWORD (dedicated smoke admin) and E2E_OUTSIDER_EMAIL/PASSWORD.
// Cleanup: the smoke admin deletes "Smoke <RUN>" afterwards (settings), or the orchestrator runs the
// documented SQL cleanup.
const ROOT = process.env.E2E_ROOT as string;
const BASE = new URL(ROOT).hostname;
const RUN = process.env.E2E_RUN ?? Date.now().toString(36);

test("smoke: create a company and land on its subdomain", async ({
  browser,
}) => {
  const label = `smoke-${RUN}`;
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${ROOT}/login`);
  await page.getByLabel("Email").fill(process.env.E2E_SMOKE_EMAIL as string);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.E2E_SMOKE_PASSWORD as string);
  await page.getByRole("button", { name: "Log in with email" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));

  await page.goto(`${ROOT}/company/new`);
  await page.getByLabel("Company name").fill(`Smoke ${RUN}`);
  await expect(page.getByLabel("Company address")).toHaveValue(label);
  await page.getByLabel("Website").fill("https://example.com");
  await page.getByLabel("Your job title").fill("CEO");
  await page.getByLabel("Street address").fill("1 Main St");
  await page.getByLabel("City").fill("Wilmington");
  await page.getByLabel("State", { exact: true }).fill("DE");
  await page.getByLabel("Postal code").fill("19801");
  for (const l of ["Country", "Incorporation type", "Incorporation country"]) {
    const item = page
      .locator("div")
      .filter({ has: page.getByText(l, { exact: true }) })
      .last();
    await item
      .getByRole("combobox")
      .or(item.getByRole("button", { name: "Select option" }))
      .first()
      .click();
    await page.getByRole("option").first().click();
  }
  await page.getByLabel("Incorporation date").fill("2024-01-01");
  await page.getByLabel("Incorporation state").fill("DE");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(
    new RegExp(`^https://${label}\\.${BASE.replace(/\./g, "\\.")}/`),
  );
  const url = page.url();

  const op = await (await browser.newContext()).newPage();
  await op.goto(`${ROOT}/login`);
  await op.getByLabel("Email").fill(process.env.E2E_OUTSIDER_EMAIL as string);
  await op
    .getByLabel("Password", { exact: true })
    .fill(process.env.E2E_OUTSIDER_PASSWORD as string);
  await op.getByRole("button", { name: "Log in with email" }).click();
  await op.waitForURL((u) => !u.pathname.startsWith("/login"));
  await op.goto(url);
  await expect(op.getByText(/don.t have access/i)).toBeVisible();
});
