import { expect, test } from "@playwright/test";

// Phase 4D.9E: the primary Value Trajectory on Overview for the synthetic "Trajectory Executive" (authorised $30m
// plan over 2026–2028; finalised reviews 31 Mar 2026 realised $1.0m and 30 Sep 2026 realised $4.0m with formal
// forecast milestones $16m / $26m). Assertions use data and labels, not geometry. Today is the real date.

test("Value Trajectory is the primary Overview visual: plan, realised, formal checkpoint, forecast, values", async ({
  page,
}) => {
  await page.goto("/projects");
  await page.getByRole("link", { name: "Trajectory Executive" }).click();
  const t = page.getByTestId("value-trajectory");
  await expect(t).toHaveAttribute("data-status", "ready");

  // Primary: above the Value Case Evolution.
  const order = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="value-trajectory"]')!;
    const b = document.getElementById("evolution")!;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order).toBeTruthy();

  await expect(t).toContainText("Value Period 1 Jan 2026 – 31 Dec 2028 · Cumulative Value");
  const facts = t.getByTestId("trajectory-facts");
  await expect(facts).toContainText(/Authorised V1\s*\$30\.0m by 31 Dec 2028/);
  await expect(facts).toContainText(/Realised\s*\$4\.0m at 30 Sept 2026/);
  await expect(facts).toContainText(/Formal forecast\s*\$26\.0m as at 30 Sept 2026 \(Review #2\)/);
  await expect(t.getByTestId("trajectory-legend")).toContainText("Authorised Plan (V1)");
  await expect(t.getByTestId("trajectory-notes")).toContainText("Formal position as at 30 Sept 2026 (Review #2)");

  // Marks: 4 plan, 3 realised (origin + 2 checkpoints), 2 forecast (the anchor carries no forecast mark).
  const chart = t.getByTestId("trajectory-chart");
  await expect(chart.locator('[data-series="plan"]')).toHaveCount(4);
  await expect(chart.locator('[data-series="realised"]')).toHaveCount(3);
  await expect(chart.locator('[data-series="forecast"]')).toHaveCount(2);
  await expect(chart).toContainText("Formal position 30 Sept 2026");

  // Accessible values: one row per stored observation.
  await t.getByTestId("trajectory-table").locator("summary").click();
  const rows = t.getByTestId("trajectory-table-row");
  await expect(rows).toHaveCount(9);
  await expect(rows.filter({ hasText: "31 Dec 2028" })).toHaveText([
    /Authorised Plan \(V1\)\s*\$30\.0m/,
    /Formal Forecast\s*\$26\.0m — formal position as at 30 Sept 2026/,
  ]);

  // Tooltip at an explicit point shows only stored observations for that date.
  const forecastEnd = chart.locator('[data-series="forecast"]').last();
  await forecastEnd.hover();
  await expect(page.getByTestId("trajectory-tooltip")).toContainText("31 Dec 2028");
  await expect(page.getByTestId("trajectory-tooltip")).toContainText("Formal Forecast: $26.0m");

  // Laptop widths: no page-level horizontal overflow.
  for (const width of [1366, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(chart).toBeVisible();
    // ResponsiveContainer re-measures asynchronously after a resize: wait for the settled layout.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(0);
  }
});

test("Value Trajectory unavailable states are explicit and existing Overviews still render", async ({ page }) => {
  // Legacy-style project (no basis classified): explicit unavailable message, Evolution unchanged.
  await page.goto("/projects");
  await page.getByRole("link", { name: "Evolution Compact" }).click();
  await expect(page.getByTestId("value-trajectory")).toHaveAttribute("data-status", "basis_not_classified");
  await expect(page.getByTestId("trajectory-unavailable")).toHaveText("Value Basis not classified.");
  await expect(page.getByTestId("value-trajectory").getByTestId("trajectory-chart")).toHaveCount(0);
  await expect(page.getByTestId("evolution-chart")).toBeVisible();
});
