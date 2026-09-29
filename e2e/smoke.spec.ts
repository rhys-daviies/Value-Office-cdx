import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

const migrationCount = (JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] })
  .entries.length;

test("app boots, connects to the database and resolves a consultant", async ({ page }) => {
  await page.goto("/status");
  await expect(page.getByTestId("db-status")).toContainText("connected");
  await expect(page.getByTestId("db-status")).toContainText(`${migrationCount} migrations`);
  await expect(page.getByTestId("status-actor")).toHaveText("e2e.consultant@cardaxia.ai");
});

test("home lands on the project list", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create project" })).toBeVisible();
});

test("health endpoint reports ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok", migrationsApplied: migrationCount });
});
