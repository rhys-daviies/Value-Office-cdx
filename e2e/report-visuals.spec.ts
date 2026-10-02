import { expect, test, type Page } from "@playwright/test";

// Phase 4D.7: Value Assurance Report visuals — server-side SVG from the report snapshot (now in the model-v3 layout,
// Phase 4D.9J: section numbers follow the v3 narrative, so headings are matched by title).
// Assertions are on report DOM and data, not pixels.

async function previewAssurance(page: Page, project: string, subject: string) {
  await page.goto("/projects");
  await page.getByRole("link", { name: project }).click();
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await page
    .getByTestId("available-report")
    .filter({ hasText: "Value Assurance Report" })
    .filter({ hasText: subject })
    .getByRole("link", { name: "Preview" })
    .click();
  await expect(page.getByTestId("report-draft-banner")).toBeVisible();
  return page.getByTestId("report-preview");
}

test("Horizon Assurance Report: Value Case Evolution and Alternative Value Outcomes with exact values", async ({
  page,
}) => {
  const report = await previewAssurance(page, "Project Horizon", "Assurance Review 1");
  await expect(report.getByRole("heading", { name: /^\d+\. Value Case Evolution$/ })).toBeVisible();
  await expect(report.getByTestId("as-evolution-svg")).toBeVisible();
  await expect(report.getByTestId("as-evolution-original-original")).toHaveText("$18.0m");
  await expect(report.getByTestId("as-evolution-v1-authorised")).toHaveText("$15.5m");
  await expect(report.getByTestId("as-evolution-r1-forecast")).toHaveText("$14.7m");
  await expect(report.getByTestId("as-evolution-r1-realised")).toHaveText("$2.8m");
  await expect(report.getByTestId("as-evolution-r1-gap")).toHaveText("$0.8m");
  await expect(report.getByTestId("as-evolution-row-original")).toContainText("Not dated");

  const outcomes = report.getByTestId("as-outcomes");
  await expect(outcomes.getByRole("heading", { name: /^\d+\. Alternative Value Outcomes$/ })).toBeVisible();
  // Horizon is unclassified: no trajectory charts, only the endpoint-only outcomes.
  await expect(report.getByTestId("rpt-trajectory-unavailable")).toHaveText(
    "Value Basis not classified — no Value Trajectory is shown.",
  );
  await expect(outcomes.getByTestId("as-outcomes-svg")).toBeVisible();
  await expect(outcomes.getByTestId("as-outcomes-forecast")).toContainText("$14.7m");
  await expect(outcomes.getByTestId("as-outcomes-recommendation")).toContainText("$15.3m");
  await expect(outcomes.getByTestId("as-outcomes-selected")).toContainText("$14.9m");
  await expect(outcomes.getByTestId("as-outcomes-difference")).toContainText("-$0.4m");
  await expect(outcomes.getByTestId("as-outcome-ref-authorised")).toContainText("$15.5m");
  await expect(outcomes.getByTestId("as-outcome-ref-forecast")).toContainText("$14.7m");
  // Equal values, distinct records: the $14.7m Current trajectory option is kept beside the forecast reference.
  await expect(outcomes.getByTestId("as-outcome-row").filter({ hasText: "Current trajectory" })).toContainText(
    "$14.7m",
  );
  await expect(outcomes.getByTestId("as-outcome-row")).toHaveCount(3);
  // VC-002 is a Value Change, reported in its own section — never an outcome.
  await expect(outcomes).not.toContainText("VC-002");
  await expect(report.getByTestId("as-value-change")).toContainText("VC-002");
  await expect(report).not.toContainText("Alternative trajectories");
});

test("a review without options: Evolution renders, Alternative Value Outcomes is omitted cleanly", async ({ page }) => {
  const report = await previewAssurance(page, "Evolution Compact", "Assurance Review 3");
  await expect(report.getByTestId("as-evolution-svg")).toBeVisible();
  await expect(report.getByTestId("as-evolution-svg")).toHaveAttribute("data-forecast-connectors", "r1>r2|r3");
  await expect(report.getByTestId("as-evolution-r3-forecast")).toHaveText("$1.2m");
  await expect(report.getByTestId("as-evolution-r1-realised")).toHaveText("$0");
  await expect(report.getByTestId("as-evolution-v2-basis")).toContainText("via VC-001");
  await expect(report.getByTestId("as-outcomes")).toHaveCount(0);
  await expect(report.getByRole("heading", { name: /Alternative Value Outcomes/ })).toHaveCount(0);
  await expect(report.getByRole("heading", { name: /^\d+\. Cardaxia recommendation$/ })).toBeVisible();
  // Pending VC-002 (draft V3) and working values never reach the governed history.
  await expect(report.getByTestId("as-evolution")).not.toContainText("VC-002");
  await expect(report.getByTestId("as-evolution")).not.toContainText("V3");
});
