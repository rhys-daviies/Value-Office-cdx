import { expect, test, type Locator } from "@playwright/test";

// Phase 4D.6: Alternative Value Outcomes on the synthetic "Decision Compact" project — Authorised V1
// $1.5m; Review #1 finalised, formal forecast $1.4m; options Current trajectory $1.4m, Accelerate
// supplier onboarding $1.9m (Cardaxia recommendation), Phase the rollout $1.6m (client selected),
// Defer remediation $1.2m; difference −$0.3m. Draft VC-001 (+$0.25m), working VL-301 ($0.35m) and
// emerging VD-04 ($0.2m) must not appear as outcomes. Assertions are on labels and data, not geometry.

const OUTCOMES = [
  ["Accelerate supplier onboarding", "$1.9m", "Scenario · Cardaxia recommendation"],
  ["Current trajectory", "$1.4m", "Scenario"],
  ["Defer remediation", "$1.2m", "Scenario"],
  ["Phase the rollout", "$1.6m", "Scenario · Client selected"],
] as const;

async function expectDecisionEconomics(section: Locator, chartTestId: string) {
  await expect(section).toContainText("Point in time");
  await expect(section.getByTestId("outcomes-forecast")).toHaveText("$1.4m");
  await expect(section.getByTestId("outcomes-recommendation")).toHaveText("$1.9m");
  await expect(section.getByTestId("outcomes-selected")).toHaveText("$1.6m");
  await expect(section.getByTestId("outcomes-difference")).toHaveText("-$0.3m");

  const chart = section.getByTestId(chartTestId);
  await expect(chart.getByRole("img", { name: "Authorised Value (V1) (Reference): $1.5m", exact: true })).toHaveCount(
    1,
  );
  await expect(
    chart.getByRole("img", { name: "Formal Forecast (Reference · Review #1): $1.4m", exact: true }),
  ).toHaveCount(1);
  await expect(
    chart.getByRole("img", { name: "Accelerate supplier onboarding (Cardaxia recommendation): $1.9m", exact: true }),
  ).toHaveCount(1);
  await expect(chart.getByRole("img", { name: "Phase the rollout (Client selected): $1.6m", exact: true })).toHaveCount(
    1,
  );
  await expect(chart.getByRole("img")).toHaveCount(6); // two references + four stored options, each once

  // Table agrees with the chart, row for row.
  const rows = section.getByTestId("outcome-row");
  await expect(rows).toHaveCount(4);
  for (const [i, [label, value, role]] of OUTCOMES.entries()) {
    await expect(rows.nth(i).getByRole("rowheader")).toHaveText(label);
    await expect(rows.nth(i).getByTestId("outcome-value")).toHaveText(value);
    await expect(rows.nth(i).getByTestId("outcome-role")).toContainText(role);
  }
  await expect(section.getByTestId("outcome-ref-authorised").getByTestId("outcome-value")).toHaveText("$1.5m");
  await expect(section.getByTestId("outcome-ref-forecast").getByTestId("outcome-value")).toHaveText("$1.4m");

  // Not outcomes: the pending Value Change, working Value Leakage and the emerging working estimate.
  for (const absent of ["VC-001", "VL-301", "VD-04", "Automation Opportunity", "$1.8m", "$0.3m", "$0.2m"]) {
    await expect(section.getByTestId("outcomes-table")).not.toContainText(absent);
  }
  await expect(chart.getByRole("img", { name: /VC-001|\$1\.8m|\$0\.4m|\$0\.2m/ })).toHaveCount(0);
}

test("Alternative Value Outcomes: latest decision on Overview → full view on the review", async ({ page }) => {
  await page.goto("/projects");
  await page.getByRole("link", { name: "Decision Compact" }).click();

  // 4D.9I: Overview states the decision as text; the option economics stay on the review.
  const latest = page.getByTestId("latest-value-decision");
  await expect(latest.getByRole("heading", { name: "Latest value decision" })).toBeVisible();
  await expect(latest.getByTestId("overview-recommendation")).toHaveText("Accelerate supplier onboarding · $1.9m");
  await expect(latest.getByTestId("overview-decision")).toHaveText("Phase the rollout · $1.6m");
  await expect(latest.getByTestId("overview-decision-difference")).toHaveText("-$0.3m");
  await expect(latest.getByRole("img")).toHaveCount(0); // no chart on Overview
  // The pending Value Change is governance, shown provisionally in the Value Case summary — never as an outcome.
  // 4D.9J: its stated +$250k does not yet reconcile with the draft version (unchanged drivers): both are shown.
  await expect(page.getByTestId("summary-pending")).toContainText(
    "Stated change +$250k · Current draft movement $0 · Does not reconcile · Draft — not in force",
  );
  await expect(latest).not.toContainText("VC-001");

  await latest.getByRole("link", { name: "View Assurance decision →" }).click();
  const full = page.getByTestId("alternative-value-outcomes");
  await expect(full.getByRole("heading", { name: "Alternative Value Outcomes" })).toBeVisible();
  await expect(full.getByTestId("outcomes-table")).toBeVisible(); // open by default on the review
  await expectDecisionEconomics(full, "outcomes-chart");
  // The old truncated-baseline option bars are gone; the options table and decision remain.
  await expect(page.getByTestId("trajectory-chart")).toHaveCount(0);
  await expect(page.getByTestId("scenario-row")).toHaveCount(4);
  await expect(page.getByTestId("recommendation")).toContainText("Accelerate supplier onboarding");
  await expect(page.getByTestId("decision")).toContainText("Phase the rollout");
});
