import { createHash } from "node:crypto";

import { expect, test, type Locator } from "@playwright/test";

// Deployment smoke: health → protected access refused → sign in → projects → mutation →
// audit actor → report preview → issue PDF → retrieve PDF → hash valid → sign out → refused.
const email = process.env.SMOKE_EMAIL;
const password = process.env.SMOKE_PASSWORD;

async function submit(form: Locator, button: string, success: string | RegExp) {
  await form.getByRole("button", { name: button }).click();
  await expect(form.getByRole("status")).toContainText(success);
}

test("deployment smoke test", async ({ page }) => {
  test.skip(!email || !password, "SMOKE_EMAIL and SMOKE_PASSWORD are required");
  page.on("dialog", (d) => void d.accept());
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);

  // Health (public, minimal).
  const health = await page.request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok", database: "ok" });

  // Unauthenticated access is refused.
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/sign-in/);
  expect((await page.request.post("/projects", { headers: { "next-action": "x" }, maxRedirects: 0 })).status()).toBe(
    401,
  );

  // Sign in.
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  const session = (await page.context().cookies()).find((c) => c.name === "__Host-vo_session");
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });

  // Mutation: a clearly labelled smoke-test project with an issued Information Request.
  await page.goto("/projects/new");
  const create = page.getByTestId("create-project-form");
  await create.getByLabel("New client name").fill("Cardaxia — deployment smoke test");
  await create.getByLabel("Project name").fill(`Deployment smoke ${stamp}`);
  await create.getByLabel("Currency").fill("USD");
  await create.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByTestId("project-name")).toHaveText(`Deployment smoke ${stamp}`);
  const projectUrl = page.url();

  await page.goto(`${projectUrl}/information-request`);
  await page.getByTestId("create-ir-form").getByRole("button", { name: "Create Information Request" }).click();
  const item = page.getByTestId("add-ir-item-form");
  await item.getByLabel("Requested information").fill("Deployment smoke-test item");
  await submit(item, "Add item", "Item added");
  await page.getByRole("button", { name: "Mark issued" }).click();
  await expect(page.getByText(/^Issued /)).toBeVisible();

  // The authenticated consultant is the audited actor.
  await page.goto(`${projectUrl}/history`);
  await expect(page.getByTestId("history-entry").first()).toContainText(email!);

  // Report preview → issue → PDF.
  await page.goto(`${projectUrl}/reports`);
  await page
    .getByTestId("available-report")
    .filter({ hasText: "Information Request" })
    .getByRole("link", { name: "Preview" })
    .click();
  await expect(page.getByTestId("report-draft-banner")).toBeVisible();
  const form = page.getByTestId("issue-report-form");
  await form.getByLabel("I have reviewed this report and it is ready to issue to the client").check();
  await form.getByRole("button", { name: "Issue report" }).click();
  await page.waitForURL(/\/reports\/issued\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const issuedUrl = page.url();
  const recorded = (await page.getByTestId("issue-record").locator("code").nth(1).textContent())!.trim();

  const pdf = await page.request.get(`${issuedUrl}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  const bytes = await pdf.body();
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(recorded);

  // Sign out → protected access refused.
  await page.getByTestId("sign-out").click();
  await expect(page).toHaveURL(/\/sign-in\?signedOut=1$/);
  await page.goto(projectUrl);
  await expect(page).toHaveURL(/\/sign-in/);
  const refused = await page.request.get(`${issuedUrl}/pdf`, { maxRedirects: 0 });
  expect(refused.status()).toBe(307); // redirected to sign-in, no PDF bytes
  expect(refused.headers()["location"]).toMatch(/\/sign-in\?next=/);
});
