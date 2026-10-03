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

  // Primary: the dominant chart; Evolution is no longer an equal chart here (4D.9H), only a compact summary below.
  const order = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="value-trajectory"]')!;
    const b = document.querySelector('[data-testid="value-case-summary"]')!;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order).toBeTruthy();
  await expect(page.getByTestId("value-case-evolution")).toHaveCount(0);
  await expect(page.getByTestId("value-case-summary").getByTestId("summary-current")).toHaveText("$30.0m");
  await expect(page.getByTestId("value-case-summary").getByTestId("summary-changes")).toHaveText("0");

  // 4D.9I hierarchy: value requiring attention and the latest decision follow the trajectory; no duplicates remain.
  const attention = page.getByTestId("overview-attention");
  await expect(attention).toContainText("Vendor sequencing risk");
  await expect(attention.getByTestId("attention-leakage")).toContainText("$700,000");
  await expect(attention).toContainText("is not the Value Gap");
  const decision = page.getByTestId("latest-value-decision");
  await expect(decision.getByTestId("overview-recommendation")).toHaveText("Act now · $29.0m");
  await expect(decision.getByTestId("overview-decision")).toHaveText("Delay 3 months · $27.0m");
  await expect(decision.getByTestId("overview-decision-difference")).toHaveText("-$2.0m");
  for (const gone of [
    "overview-authorised-version",
    "overview-value-case",
    "working-picture",
    "overview-leakage-recoverable",
  ]) {
    await expect(page.getByTestId(gone)).toHaveCount(0);
  }
  const top = (id: string) =>
    page.evaluate((x) => document.querySelector(`[data-testid="${x}"]`)!.getBoundingClientRect().top, id);
  const tops = await Promise.all(
    ["executive-position", "value-trajectory", "overview-attention", "value-case-summary"].map(top),
  );
  expect([...tops].sort((a, b) => a - b)).toEqual(tops);

  await expect(t).toContainText("Value Period 1 Jan 2026 – 31 Dec 2028 · Cumulative Value");
  // 4D.9I: the Executive Value Position states the headline figures and "as at" date; the chart's facts strip is
  // not repeated on Overview (it remains on the Value Case page).
  await expect(t.getByTestId("trajectory-facts")).toHaveCount(0);
  await expect(page.getByTestId("overview-authorised-value")).toHaveText("$30.0m");
  await expect(page.getByTestId("overview-realised")).toHaveText("$4.0m");
  await expect(page.getByTestId("overview-forecast")).toHaveText("$26.0m");
  await expect(page.getByTestId("overview-gap")).toHaveText("$4.0m");
  await expect(page.getByTestId("overview-formal-position")).toContainText(
    "Formal position as at 30 Sept 2026 · Review #2",
  );
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

  // 4D.9N.1A: definitions, named end labels and the period-end Value Gap bracket.
  await expect(t.getByTestId("trajectory-definitions")).toContainText(
    "Authorised Plan = what we committed to, and when.",
  );
  await expect(t.getByTestId("trajectory-definitions")).toContainText(
    "Value Gap = Authorised minus Formal Forecast at the Value Period end.",
  );
  await expect(chart.getByTestId("trajectory-end-label-plan")).toHaveText("Authorised V1 · $30.0m");
  await expect(chart.getByTestId("trajectory-end-label-forecast")).toHaveText("Formal Forecast · $26.0m");
  await expect(chart.getByTestId("trajectory-gap-bracket")).toHaveAttribute("data-label", "Value Gap · $4.0m");
  await expect(chart.getByTestId("trajectory-gap-bracket")).toContainText("Value Gap · $4.0m");

  // Tooltip at an explicit point: the stored observation, tagged Formal.
  const tip = page.getByTestId("trajectory-tooltip");
  await chart.locator('[data-series="forecast"]').last().locator("circle").hover();
  await expect(tip.getByTestId("tip-heading")).toHaveText("31 Dec 2028");
  await expect(tip.locator('[data-series-label="Formal Forecast"] [data-tag="Formal"]')).toContainText("$26.0m");

  // Monthly cursor: a month with nothing stored shows Previous / Next only — never a value read off a line.
  const box = (await chart.boundingBox())!;
  const [t0, t1] = [Date.UTC(2026, 0, 1), Date.UTC(2028, 11, 31)];
  const plotLeft = box.x + 8 + 56;
  const plotWidth = box.width - 8 - 56 - 172;
  const hoverDate = async (y: number, m: number, d: number) =>
    page.mouse.move(plotLeft + ((Date.UTC(y, m, d) - t0) / (t1 - t0)) * plotWidth, box.y + box.height / 2);
  await hoverDate(2027, 5, 28);
  await expect(tip.getByTestId("tip-heading")).toHaveText("Jun 2027");
  await expect(tip.locator('[data-tag="Entered"], [data-tag="Formal"], [data-tag="Scenario"]')).toHaveCount(0);
  await expect(tip.locator('[data-series-label="Authorised Plan (V1)"]')).toContainText("Previous31 Dec 2026 ·$6.0m");
  await expect(tip.locator('[data-series-label="Authorised Plan (V1)"]')).toContainText("Next31 Dec 2027 ·$18.0m");
  await expect(tip.locator('[data-series-label="Realised"]')).toContainText("Latest formal30 Sept 2026 ·$4.0m");
  await expect(tip.getByTestId("tip-footer")).toHaveText(
    "Value Gap at Value Period end: $4.0m (Authorised V1 $30.0m − Formal Forecast $26.0m)",
  );
  await hoverDate(2026, 1, 25);
  await expect(tip.getByTestId("tip-heading")).toHaveText("Feb 2026");
  await expect(tip.locator('[data-series-label="Realised"]')).toContainText("No formal realised checkpoint yet");

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
  await expect(page.getByTestId("value-case-summary")).toBeVisible();
});
