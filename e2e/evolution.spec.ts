import { expect, test, type Locator, type Page } from "@playwright/test";

// Phase 4D.5: Value Case Evolution on the synthetic "Evolution Compact" project — V0 $2.0m; V1 $1.5m
// (15 Jan 2026); Reviews #1–#2 against V1; V2 $1.3m via VC-001 (15 Jul 2026); Review #3 against V2.
// Pending VC-002 (draft V3 $1.75m), emerging VD-04 ($0.2m) and working leakage ($0.45m) must not appear.
// Assertions are on labels and data, never on SVG geometry.

const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Project" }).getByRole("link", { name, exact: true });

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

test("Value Case Evolution: governed history on Overview and Value Case", async ({ page }) => {
  await page.goto("/projects");
  await page.getByRole("link", { name: "Evolution Compact" }).click();

  const section = page.getByTestId("value-case-evolution");
  await expect(section.getByRole("heading", { name: "Value Case Evolution" })).toBeVisible();
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
  // Not plotted: pending VC-002 / draft V3, the emerging driver's working estimate, working leakage.
  await expect(chart.getByRole("img", { name: /V3|\$1\.8m|\$0\.2m|\$0\.5m/ })).toHaveCount(0);
  await expect(section).not.toContainText("VC-002");

  // Companion table (collapsed on Overview), exact governed values.
  await section.getByText("Governed history table").click();
  await expectGovernedHistory(section);

  // Pending governance is still visible elsewhere on Overview — just not plotted.
  await expect(page.getByText("VC-002 (draft)")).toBeVisible();

  // Value Case reuses the same component; values identical.
  await tab(page, "Value Case").click();
  const reused = page.getByTestId("value-case-evolution");
  await expect(reused.getByTestId("evolution-chart")).toBeVisible();
  await expect(reused.getByTestId("evolution-table")).toBeVisible(); // open by default here
  await expectGovernedHistory(reused);
});
