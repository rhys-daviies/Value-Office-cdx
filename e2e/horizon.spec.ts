import { expect, test } from "@playwright/test";

// Phase 1 UI acceptance: the seeded Horizon fixture is fully representable.
const DRIVERS = [
  ["VD-01", "Service Productivity", "$4.8m"],
  ["VD-02", "Customer Retention", "$3.6m"],
  ["VD-03", "Technology Run Cost", "$2.4m"],
  ["VD-04", "Contact Avoidance", "$2.1m"],
  ["VD-05", "Quality / Rework", "$2.2m"],
  ["VD-06", "New Automation", "$0.4m"],
] as const;

test("Project Horizon: $18.0m inherited, $15.5m authorised, six drivers", async ({ page }) => {
  await page.goto("/projects");
  await page.getByRole("link", { name: "Project Horizon" }).click();
  await expect(page.getByTestId("project-name")).toHaveText("Project Horizon");

  // Overview
  await expect(page.getByTestId("overview-inherited-total")).toHaveText("$18.0m");
  await expect(page.getByTestId("overview-requalified-total")).toHaveText("$15.5m");
  // Unknown facts stay visibly labelled as placeholders (including the USD currency).
  await expect(page.getByText(/Currency USD is a placeholder/)).toBeVisible();

  // Value Case timeline
  await page.getByRole("link", { name: "Value Case", exact: true }).click();
  await expect(page.getByTestId("timeline-v0-total")).toHaveText("$18.0m");
  await expect(page.getByTestId("timeline-v1-total")).toHaveText("$15.5m");
  await expect(page.getByTestId("timeline-v1")).toContainText("Authorised Value Case V1");
  await expect(page.getByTestId("timeline-v0")).toContainText("Inherited Business Case");

  // Authorised V1 version view
  await page.getByRole("link", { name: "Open V1" }).click();
  await expect(page.getByTestId("version-total")).toHaveText("$15.5m");
  await expect(page.getByText("Authorised Value Case — read-only")).toBeVisible();
  await expect(page.getByTestId("authorisation-details")).toContainText("[FIXTURE PLACEHOLDER] Value Case Owner");
  const rows = page.getByTestId("version-driver-row");
  await expect(rows).toHaveCount(6);
  for (const [i, [code, name, value]] of DRIVERS.entries()) {
    await expect(rows.nth(i)).toContainText(code);
    await expect(rows.nth(i)).toContainText(name);
    await expect(rows.nth(i)).toContainText(value);
  }
  await expect(page.getByRole("button", { name: "Save driver" })).toHaveCount(0);

  // Re-Qualification workspace is read-only for the authorised version
  await page.getByRole("link", { name: "Re-Qualification" }).click();
  await expect(page.getByTestId("requal-state")).toContainText("Authorised Value Case V1 — read-only");
  await expect(page.getByTestId("requal-inherited-total")).toHaveText("$18.0m");
  await expect(page.getByTestId("requal-v1-total")).toHaveText("$15.5m");
  await expect(page.getByTestId("requal-change")).toHaveText("-$2.5m");
  await expect(page.getByTestId("comparison-row")).toHaveCount(6);
  await expect(page.getByRole("button", { name: /Propose V1|Save driver|Add driver/ })).toHaveCount(0);
});

test("Project Horizon Assurance: $15.5m authorised, $14.7m forecast, $0.8m gap; $2.8m realised kept as labelled aggregate", async ({
  page,
}) => {
  await page.goto("/projects");
  await page.getByRole("link", { name: "Project Horizon" }).click();
  await expect(page.getByTestId("overview-authorised-value")).toHaveText("$15.5m");
  await expect(page.getByTestId("overview-forecast")).toHaveText("$14.7m");
  await expect(page.getByTestId("overview-gap")).toHaveText("$0.8m");
  await expect(page.getByTestId("overview-realised")).toHaveText("Not yet assessed");

  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "Assurance", exact: true }).click();
  await expect(page.getByTestId("assurance-authorised")).toHaveText("$15.5m");
  await expect(page.getByTestId("assurance-forecast")).toHaveText("$14.7m");
  await expect(page.getByTestId("assurance-gap")).toHaveText("$0.8m");
  await expect(page.getByTestId("assurance-realised")).toHaveText("Not yet assessed");

  await page.getByTestId("review-row").getByRole("link", { name: "#1" }).click();
  const expected = [
    ["VD-01", "$4.8m", "$4.4m"],
    ["VD-02", "$3.6m", "$3.2m"],
    ["VD-03", "$2.4m", "$2.2m"],
    ["VD-04", "$2.1m", "$2.0m"],
    ["VD-05", "$2.2m", "$2.5m"],
    ["VD-06", "$0.4m", "$0.4m"],
  ];
  const rows = page.getByTestId("position-row");
  await expect(rows).toHaveCount(6);
  for (const [i, [code, authorised, forecast]] of expected.entries()) {
    await expect(rows.nth(i)).toContainText(code!);
    await expect(rows.nth(i)).toContainText(authorised!);
    await expect(rows.nth(i).getByTestId("position-forecast")).toHaveText(forecast!);
    await expect(rows.nth(i).getByTestId("position-realised")).toHaveText("Not assessed");
  }
  await expect(page.getByTestId("review-summary-text")).toContainText(
    "[FIXTURE PLACEHOLDER] Realised Value of $2.8m is known only as a project-level aggregate",
  );
});
