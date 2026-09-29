import { expect, test } from "@playwright/test";

test("app boots, connects to the database and resolves a consultant", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Cardaxia Value Office" })).toBeVisible();
  await expect(page.getByTestId("db-status")).toContainText("connected");
  await expect(page.getByTestId("actor")).toContainText("@");
});

test("health endpoint reports ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok", migrationsApplied: 2 });
});
