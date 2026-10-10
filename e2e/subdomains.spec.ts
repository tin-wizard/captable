import { type Browser, type Page, expect, test } from "@playwright/test";

// E2E_ROOT: https://dealroom.test (CI) or https://dealroom-staging.tin.info (staging)
const ROOT = process.env.E2E_ROOT ?? "https://dealroom.test";
const BASE = new URL(ROOT).hostname; // also the tenant base domain
const RUN = process.env.E2E_RUN ?? Date.now().toString(36); // unique per run so staging can rerun
const host = (label: string) => `https://${label}.${BASE}`;
const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PASSWORD = process.env.E2E_PASSWORD ?? "E2e-password-1!";
// the upload needs a real bucket with CORS for the company host (staging); CI has none
const UPLOAD = process.env.E2E_UPLOAD === "1";

async function submitLogin(page: Page, email: string) {
  await page.getByLabel("Email").fill(email); // sr-only labels in signin/index.tsx
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in with email" }).click();
}

async function login(page: Page, email: string) {
  await page.goto(`${ROOT}/login`);
  await submitLogin(page, email);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

// shadcn Select / LinearCombobox: open the control next to the label, take the first option
async function pickFirst(page: Page, label: string) {
  const item = page
    .locator("div")
    .filter({ has: page.getByText(label, { exact: true }) })
    .last();
  await item
    .getByRole("combobox")
    .or(item.getByRole("button", { name: "Select option" }))
    .first()
    .click();
  await page.getByRole("option").first().click();
}

async function createCompany(page: Page, name: string, expectedLabel: string) {
  await page.goto(`${ROOT}/company/new`);
  await page.getByLabel("Company name").fill(name);
  await expect(page.getByLabel("Company address")).toHaveValue(expectedLabel); // step 3
  await page.getByLabel("Website").fill("https://example.com");
  await page.getByLabel("Your job title").fill("CEO");
  await page.getByLabel("Street address").fill("1 Main St");
  await page.getByLabel("City").fill("Wilmington");
  await page.getByLabel("State", { exact: true }).fill("DE");
  await page.getByLabel("Postal code").fill("19801");
  await pickFirst(page, "Country");
  await pickFirst(page, "Incorporation type");
  await page.getByLabel("Incorporation date").fill("2024-01-01");
  await pickFirst(page, "Incorporation country");
  await page.getByLabel("Incorporation state").fill("DE");
  await page.locator('form button[type="submit"]').click(); // step 4
}

// logged-in admin context sitting on a freshly created company's host
async function adminWithCompany(browser: Browser, label: string, name: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "admin@e2e.test");
  await createCompany(page, name, label);
  await page.waitForURL(new RegExp(`^${esc(host(label))}/[^/]+`));
  return { ctx, page, url: page.url() };
}

test("mandatory: company creation provisions a working, isolated subdomain", async ({
  browser,
}) => {
  const botski = `botski-${RUN}`;
  const konnect = `konnect-${RUN}`;
  const admin = await browser.newContext();
  const page = await admin.newPage();
  await login(page, "admin@e2e.test"); // step 1

  await createCompany(page, `Botski ${RUN}`, botski); // steps 2-4
  await page.waitForURL(new RegExp(`^${esc(host(botski))}/[^/]+`)); // step 5
  await expect(page.getByText(`Botski ${RUN}`).first()).toBeVisible(); // step 6
  const botskiUrl = page.url();

  if (UPLOAD) {
    // upload from the company host (bucket CORS)
    await page.goto(`${botskiUrl}/documents`);
    await page
      .getByRole("button", { name: /upload a document|^document$/i })
      .first()
      .click();
    await page.setInputFiles('input[type="file"]', {
      name: "e2e.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("e2e"),
    });
    await expect(page.getByText("e2e.txt")).toBeVisible();
  }

  const outsider = await browser.newContext(); // step 7
  const op = await outsider.newPage();
  await login(op, "outsider@e2e.test");
  await op.goto(botskiUrl);
  await expect(op.getByText(/don.t have access/i)).toBeVisible();
  await expect(op.getByText(`Botski ${RUN}`)).toHaveCount(0);

  await createCompany(page, `Konnect ${RUN}`, konnect); // step 8
  await page.waitForURL(new RegExp(`^${esc(host(konnect))}/`));
  await page.goto(botskiUrl); // Botski unaffected
  await expect(page.getByText(`Botski ${RUN}`).first()).toBeVisible();

  // step 9: old canonical link of a company that is NOT the session's current one, deep path kept
  const legacy = process.env.E2E_LEGACY_PUBLIC_ID as string;
  const legacyLabel = process.env.E2E_LEGACY_LABEL as string;
  expect(legacy, "E2E_LEGACY_PUBLIC_ID (run e2e/seed.ts)").toBeTruthy();
  await page.goto(`${ROOT}/${legacy}/stakeholders`);
  await expect(page).toHaveURL(
    new RegExp(`^${esc(host(legacyLabel))}/${legacy}/stakeholders`),
  );
  await expect(page.getByText("Legacy Co").first()).toBeVisible();

  // logged-out deep link survives login + handoff
  const fresh = await browser.newContext();
  const fp = await fresh.newPage();
  await fp.goto(`${botskiUrl}/stakeholders`);
  await fp.waitForURL(/\/login/);
  await submitLogin(fp, "admin@e2e.test");
  await fp.waitForURL(new RegExp(`^${esc(botskiUrl)}/stakeholders`));
});

test("mandatory: no per-company infrastructure", async ({ page }) => {
  // step 10: an arbitrary new label reaches the app through the same wildcard DNS, TLS and proxy
  const res = await page.goto(host(`never-created-${RUN}`));
  expect(page.url()).toContain("/domain-not-found");
  expect(res?.ok() || res?.status() === 404).toBeTruthy();
});

test("two tabs: each tab keeps its own company after reloading both", async ({
  browser,
}) => {
  const a = `tabsa-${RUN}`;
  const b = `tabsb-${RUN}`;
  const first = await adminWithCompany(browser, a, `TabsA ${RUN}`);
  const p2 = await first.ctx.newPage();
  await createCompany(p2, `TabsB ${RUN}`, b);
  await p2.waitForURL(new RegExp(`^${esc(host(b))}/`));
  const second = p2.url();

  await first.page.reload();
  await p2.reload();
  await expect(first.page).toHaveURL(first.url);
  await expect(p2).toHaveURL(second);
  await expect(first.page.getByText(`TabsA ${RUN}`).first()).toBeVisible();
  await expect(p2.getByText(`TabsB ${RUN}`).first()).toBeVisible();
});

test("sign-out on one company host signs out every host", async ({
  browser,
}) => {
  const a = `outa-${RUN}`;
  const b = `outb-${RUN}`;
  const first = await adminWithCompany(browser, a, `OutA ${RUN}`);
  const p2 = await first.ctx.newPage();
  await createCompany(p2, `OutB ${RUN}`, b);
  await p2.waitForURL(new RegExp(`^${esc(host(b))}/`));

  // what the user menu's "Sign out" does on a company host
  await p2.evaluate(() => {
    const form = document.createElement("form");
    form.method = "post";
    form.action = "/auth/signout";
    document.body.append(form);
    form.submit();
  });
  await p2.waitForURL(/\/login/);
  await first.page.goto(first.url);
  await first.page.waitForURL(/\/login/);
});

test("a tenant session cookie is not accepted on the canonical host", async ({
  browser,
}) => {
  const label = `cookie-${RUN}`;
  const { ctx, url } = await adminWithCompany(browser, label, `Cookie ${RUN}`);
  const cookies = await ctx.cookies(url);
  const tenant = cookies.find((c) => c.name === "__Host-dr-tenant");
  expect(tenant, "tenant cookie on the company host").toBeTruthy();

  // a request from the browser, so the host-resolver rules apply (APIRequestContext resolves in Node)
  const other = await browser.newContext();
  await other.addCookies([
    {
      name: "__Host-dr-tenant",
      value: tenant?.value ?? "",
      url: ROOT,
      secure: true,
    },
  ]);
  const op = await other.newPage();
  await op.goto(`${ROOT}/login`);
  const res = await op.evaluate(async () => {
    const r = await fetch("/api/trpc/company.getCompany");
    return { status: r.status, body: await r.text() };
  });
  expect(res.status === 401 || res.body.includes("UNAUTHORIZED")).toBeTruthy();
  expect(res.body).not.toContain(`Cookie ${RUN}`);

  // positive control: a normal canonical session can call the same endpoint
  const ctrl = await browser.newContext();
  const cp = await ctrl.newPage();
  await login(cp, "admin@e2e.test");
  await cp.goto(`${ROOT}/login`);
  const ok = await cp.evaluate(async () => {
    const r = await fetch("/api/trpc/company.getCompany");
    return { status: r.status, body: await r.text() };
  });
  expect(ok.status).toBe(200);
  expect(ok.body).toContain('"name"');
});

test("alias: the old company URL follows a rename, logged out", async ({
  browser,
}) => {
  const old = `alias-${RUN}`;
  const renamed = `alias2-${RUN}`;
  const { page, url } = await adminWithCompany(browser, old, `Alias ${RUN}`);

  await page.goto(`${url}/settings/company`);
  await page.getByLabel("New company address").fill(renamed);
  await expect(page.getByText("Available")).toBeVisible();
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByRole("button", { name: "Change address" }).click();
  await page.waitForURL(new RegExp(`^${esc(host(renamed))}/`));

  const fresh = await browser.newContext();
  const fp = await fresh.newPage();
  const publicPath = new URL(url).pathname;
  await fp.goto(`${host(old)}${publicPath}`);
  await fp.waitForURL(/\/login/);
  await submitLogin(fp, "admin@e2e.test");
  await fp.waitForURL(new RegExp(`^${esc(host(renamed))}${esc(publicPath)}`));
});
