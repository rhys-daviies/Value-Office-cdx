import { expect, test, type Locator } from "@playwright/test";

// Phase 4D.5: Value Case Evolution on the synthetic "Evolution Compact" project — V0 $2.0m; V1 $1.5m
// (15 Jan 2026); Reviews #1–#2 against V1; V2 $1.3m via VC-001 (15 Jul 2026); Review #3 against V2.
// Pending VC-002 (draft V3 $1.75m), emerging VD-04 ($0.2m) and working leakage ($0.45m) must not appear.
// Assertions are on labels and data, never on SVG geometry.

async function expectGovernedHistory(section: Locator) {
  const row = (key: string) => section.getByTestId(`evolution-row-${key}`);
  await expect(section.getByTestId("evolution-original-value")).toHaveText("$2.0m");
  await expect(row("original")).toContainText("Not dated");
  await expect(section.getByTestId("evolution-v1-authorised")).toHaveText("$1.5m");
  await expect(row("v1")).toContainText("15 Jan 2026");
  await expect(section.getByTestId("evolution-v1-basis")).toContainText("VCO: Test VCO");
  await expect(section.getByTestId("evolution-r1-forecast")).toHaveText("$1.4m");
  await expect(section.getByTestId("evolution-r1-realised")).toHaveText("$0");
  await expect(section.getByTestId("evolution-r2-forecast")).toHaveText("$1.3m");
  await expect(section.getByTestId("evolution-r2-realised")).toHaveText("$0.3m");
  await expect(section.getByTestId("evolution-r2-gap")).toHaveText("$0.2m");
  await expect(section.getByTestId("evolution-r2-basis")).toContainText("Measured against V1");
  await expect(section.getByTestId("evolution-v2-authorised")).toHaveText("$1.3m");
  await expect(section.getByTestId("evolution-v2-basis")).toContainText("via VC-001");
  await expect(section.getByTestId("evolution-r3-forecast")).toHaveText("$1.2m");
  await expect(section.getByTestId("evolution-r3-realised")).toHaveText("$0.6m");
  await expect(section.getByTestId("evolution-r3-basis")).toContainText("Measured against V2");
  await expect(section.getByTestId("evolution-table").locator("tbody tr")).toHaveCount(6);
}

test("Value Case Evolution: compact governance summary on Overview; full governed history on Value Case", async ({
  page,
}) => {
  await page.goto("/projects");
  await page.getByRole("link", { name: "Evolution Compact" }).click();

  // 4D.9H: Overview carries a compact Value Case summary, not a second large chart.
  await expect(page.getByTestId("value-case-evolution")).toHaveCount(0);
  const summary = page.getByTestId("value-case-summary");
  await expect(summary.getByTestId("summary-current")).toHaveText("$1.3m");
  await expect(summary).toContainText("V2 · authorised 15 Jul 2026");
  await expect(summary.getByTestId("summary-original")).toHaveText("$2.0m");
  await expect(summary.getByTestId("summary-changes")).toHaveText("1");
  await expect(summary).toContainText("Latest VC-001 → V2");
  await expect(summary.getByTestId("summary-pending")).toHaveText(
    "Proposed change +$0.5m · Draft — not in force · Open VC-002",
  );
  await summary.getByRole("link", { name: "View Value Case history →" }).click();
  await expect(page).toHaveURL(/\/value-case#evolution$/);

  // Value Case: commitment → trajectory → Evolution → Value Change history → version history.
  const order = await page.evaluate(() =>
    [
      "current-commitment",
      "value-trajectory",
      "value-case-evolution",
      "value-change-history",
      "value-case-timeline",
    ].map(
      (id) => (document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top ?? -1e9) + window.scrollY,
    ),
  );
  expect(
    order.every((t) => t >= 0),
    JSON.stringify(order),
  ).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  await expect(page.getByTestId("commitment-total")).toHaveText("$1.3m");
  await expect(page.getByTestId("current-commitment")).toContainText("Authorised V2");
  await expect(page.getByTestId("commitment-pending")).toContainText("Proposed V3 via VC-002 (draft) — not in force");
  await expect(page.getByTestId("commitment-basis")).toContainText("Value Basis not classified");
  // Legacy: no trajectory adoption is needed to see the governed history.
  await expect(page.getByTestId("value-trajectory")).toHaveAttribute("data-status", "basis_not_classified");

  const section = page.getByTestId("value-case-evolution");
  await expect(section.getByRole("heading", { name: "Value Case Evolution" })).toBeVisible();
  await expect(section).toContainText("History of the governed value commitment");
  await expect(section).toContainText("Governed history");
  const legend = section.getByTestId("evolution-legend");
  for (const label of ["Original Business Case", "Authorised Value", "Formal Forecast", "Realised Value"]) {
    await expect(legend).toContainText(label);
  }

  // Plotted governed events, by their accessible labels.
  const chart = section.getByTestId("evolution-chart");
  for (const name of [
    "Original Business Case, Business Case: $2.0m",
    "Authorised Value, V1: $1.5m",
    "Authorised Value, V2: $1.3m",
    "Formal Forecast, Review #1: $1.4m",
    "Formal Forecast, Review #3: $1.2m",
    "Realised Value, Review #1: $0",
    "Realised Value, Review #3: $0.6m",
  ]) {
    await expect(chart.getByRole("img", { name, exact: true })).toHaveCount(1);
  }
  await expect(chart.getByRole("img")).toHaveCount(9);
  // 4D.6 refinement: forecast connectors run only within one measured-against version.
  await expect(chart).toHaveAttribute("data-forecast-connectors", "r1>r2|r3");
  await expect(chart.getByRole("img", { name: /^Formal Forecast, Review #\d/ })).toHaveCount(3);
  // Not plotted: pending VC-002 / draft V3, the emerging driver's working estimate, working leakage.
  await expect(chart.getByRole("img", { name: /V3|\$1\.8m|\$0\.2m|\$0\.5m/ })).toHaveCount(0);
  await expect(section).not.toContainText("VC-002");
  await expect(section.getByTestId("evolution-table")).toBeVisible(); // open by default here
  await expectGovernedHistory(section);

  // Value Change history: the governed actions that produced the movement.
  const history = page.getByTestId("value-change-history");
  await expect(history.getByTestId("value-change-row")).toHaveText([
    /VC-001.*V1 → V2.*Authorised 15 Jul 2026/,
    /VC-002.*V2 → V3.*Draft — not in force/,
  ]);

  for (const width of [1366, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(0);
  }
});
