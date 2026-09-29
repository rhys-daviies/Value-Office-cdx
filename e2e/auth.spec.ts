import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { E2E_CONSULTANT } from "./env";

// Phase 4B: real password sign-in, protected access and sign-out (no stored session).
test.use({ storageState: { cookies: [], origins: [] } });

test("sign in → projects → report preview → issue and retrieve PDF → sign out → access refused", async ({ page }) => {
  // Unauthenticated: pages redirect to sign-in; the health probe stays public.
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fprojects$/);
  expect((await page.request.get("/api/health")).status()).toBe(200);

  // Wrong password: generic refusal.
  await page.getByLabel("Email").fill(E2E_CONSULTANT.email);
  await page.getByLabel("Password").fill("definitely not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("The email or password is not correct.");

  // Valid consultant.
  await page.getByLabel("Email").fill(E2E_CONSULTANT.email);
  await page.getByLabel("Password").fill(E2E_CONSULTANT.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId("actor")).toHaveText(`Consultant: ${E2E_CONSULTANT.email}`);
  const cookie = (await page.context().cookies()).find((c) => c.name === "vo_session")!;
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });

  // Open a project and a report preview; issue it.
  await page.getByRole("link", { name: "Project Horizon" }).click();
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "Reports", exact: true }).click();
  await page
    .getByTestId("available-report")
    .filter({ hasText: "Re-Qualification Report" })
    .getByRole("link", { name: "Preview" })
    .click();
  await expect(page.getByTestId("report-draft-banner")).toBeVisible();
  const form = page.getByTestId("issue-report-form");
  await form.getByLabel("I have reviewed this report and it is ready to issue to the client").check();
  page.once("dialog", (d) => d.accept());
  await form.getByRole("button", { name: "Issue report" }).click();
  await page.waitForURL(/\/reports\/issued\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const issuedUrl = page.url();
  await expect(page.getByTestId("issue-record")).toContainText(E2E_CONSULTANT.name);

  // Retrieve the PDF and verify it against the hash recorded on the issue.
  const recorded = (await page.getByTestId("issue-record").locator("code").nth(1).textContent())!.trim();
  const pdfUrl = `${issuedUrl}/pdf`;
  const pdf = await page.request.get(pdfUrl);
  expect(pdf.status()).toBe(200);
  const bytes = await pdf.body();
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(recorded);

  // Sign out: the session is revoked server-side.
  await page.getByTestId("sign-out").click();
  await expect(page).toHaveURL(/\/sign-in\?signedOut=1$/);
  await expect(page.getByRole("status")).toHaveText("You have signed out.");
  await page.goto(issuedUrl);
  await expect(page).toHaveURL(/\/sign-in/);
  const refused = await page.request.get(pdfUrl, { maxRedirects: 0 });
  expect(refused.status()).toBe(307); // no session cookie: redirected to sign-in, no PDF bytes
  expect(refused.headers()["location"]).toMatch(/\/sign-in\?next=/);

  // Replaying the old cookie does not work either: revoked, not merely deleted.
  await page.context().addCookies([cookie]);
  expect((await page.request.get(pdfUrl, { maxRedirects: 0 })).status()).toBe(401);
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/sign-in/);
});
