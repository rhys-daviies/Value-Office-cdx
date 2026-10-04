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
  await expect(page.getByTestId("summary-original")).toHaveText("$18.0m");
  await expect(page.getByTestId("summary-current")).toHaveText("$15.5m");
  // Unknown facts stay visibly labelled as placeholders (including the USD currency) — in the setup record (4D.9I).
  await page.getByTestId("overview-setup-record").locator("summary").click();
  await expect(page.getByText(/Currency USD is a placeholder/)).toBeVisible();

  // Value Case timeline
  await page.getByRole("link", { name: "Value Case", exact: true }).click();
  await expect(page.getByTestId("timeline-v0-total")).toHaveText("$18.0m");
  await expect(page.getByTestId("timeline-v1-total")).toHaveText("$15.5m");
  await expect(page.getByTestId("timeline-v1")).toContainText("Authorised Value Case V1");
  await expect(page.getByTestId("timeline-v0")).toContainText("Original Business Case");

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

  // Value Case Definition is read-only for the authorised version
  await page
    .getByRole("navigation", { name: "Project" })
    .getByRole("link", { name: "Value Case Definition", exact: true })
    .click();
  await expect(page.getByTestId("requal-state")).toContainText("Authorised Value Case V1 — read-only");
  await expect(page.getByTestId("requal-inherited-total")).toHaveText("$18.0m");
  await expect(page.getByTestId("requal-v1-total")).toHaveText("$15.5m");
  await expect(page.getByTestId("requal-change")).toHaveText("-$2.5m");
  await expect(page.getByTestId("comparison-row")).toHaveCount(6);
  await expect(page.getByRole("button", { name: /Propose V1|Save driver|Add driver/ })).toHaveCount(0);
});

test("Project Horizon Assurance: $15.5m authorised, $14.7m forecast, $0.8m gap; $2.8m realised unattributed", async ({
  page,
}) => {
  await page.goto("/projects");
  await page.getByRole("link", { name: "Project Horizon" }).click();
  await expect(page.getByTestId("overview-authorised-value")).toHaveText("$15.5m");
  await expect(page.getByTestId("overview-forecast")).toHaveText("$14.7m");
  await expect(page.getByTestId("overview-gap")).toHaveText("$0.8m");
  await expect(page.getByTestId("overview-realised")).toHaveText("$2.8m");

  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "Assurance", exact: true }).click();
  await expect(page.getByTestId("assurance-authorised")).toHaveText("$15.5m");
  await expect(page.getByTestId("assurance-forecast")).toHaveText("$14.7m");
  await expect(page.getByTestId("assurance-gap")).toHaveText("$0.8m");
  await expect(page.getByTestId("assurance-realised")).toHaveText("$2.8m");

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
  // $2.8m is unattributed: no driver carries any of it.
  await expect(page.getByTestId("realised-attributed")).toHaveText("None attributed");
  await expect(page.getByTestId("realised-unattributed")).toHaveText("$2.8m");
  await expect(page.getByTestId("realised-total")).toHaveText("$2.8m");
  await expect(page.getByTestId("unattributed-rationale")).toContainText("[FIXTURE PLACEHOLDER]");
});

test("Project Horizon Phase 3: options, recommendation vs decision, unassessed leakage, VC-002 proposed", async ({
  page,
}) => {
  await page.goto("/projects");
  await page.getByRole("link", { name: "Project Horizon" }).click();
  await expect(page.getByTestId("overview-recommendation")).toContainText("$15.3m");
  await expect(page.getByTestId("overview-decision")).toContainText("$14.9m");
  await expect(page.getByTestId("overview-decision-difference")).toHaveText("-$0.4m");
  await expect(page.getByTestId("overview-leakage-total")).toHaveText("Not yet assessed");
  await expect(page.getByTestId("value-case-summary")).toContainText("V1 · authorised");
  await expect(page.getByTestId("summary-pending")).toContainText("Proposed — not in force");
  await expect(page.getByTestId("summary-pending")).toContainText("VC-002");

  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "Assurance", exact: true }).click();
  await page.getByTestId("review-row").getByRole("link", { name: "#1" }).click();
  await expect(page.getByTestId("scenario-total")).toHaveText(["$14.7m", "$15.3m", "$14.9m"]);
  await expect(page.getByTestId("recommendation")).toContainText("$15.3m");
  await expect(page.getByTestId("decision-recommended")).toHaveText("$15.3m");
  await expect(page.getByTestId("decision-selected")).toHaveText("$14.9m");
  await expect(page.getByTestId("decision-difference")).toHaveText("-$0.4m");
  const vl = page.getByTestId("leakage-VL-001");
  await expect(vl.getByTestId("leakage-amounts")).toHaveText("Not yet quantified in this review");
  await vl.locator("summary").click();
  await expect(vl.getByTestId("leakage-description")).toContainText("do not reconcile");

  // Value Changes are reached from the Value Case (4D.10B), not the navigation.
  await page
    .getByRole("navigation", { name: "Project" })
    .getByRole("link", { name: "Value Case", exact: true })
    .click();
  await page.getByTestId("value-case-changes-link").getByRole("link").click();
  await expect(page).toHaveURL(/\/changes$/);
  await page.getByTestId("change-row").getByRole("link", { name: "VC-002" }).click();
  await expect(page.getByTestId("change-from-total")).toHaveText("$15.5m");
  await expect(page.getByTestId("change-stated")).toHaveText("-$0.6m");
  await expect(page.getByTestId("change-projected")).toHaveText("$14.9m");
  await expect(page.getByText("Not reconciled")).toBeVisible();
  await expect(page.getByRole("button", { name: /Record authorisation/ })).toBeDisabled();
});
