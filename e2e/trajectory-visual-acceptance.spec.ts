import { expect, test, type Locator, type Page } from "@playwright/test";

// Phase 4D.9N.1A: executive trajectory visuals on the canonical journey ("Canonical Value Journey": V1 $30.0m →
// Review #2 options with the 30 Dec 2026 delayed-action pivot → VC-001 −$3.0m → Authorised V2 $27.0m → Review #3
// forecast $25.0m, realised $4.6m, gap $2.0m). Monthly crosshair, Value Gap bracket, pivot marker and the Evolution
// commitment story; 4D.9N.1B Review #2 Formal Forecast context. Set VISUAL_OUT=<dir> to save review screenshots (never
// written by default).

const OUT = process.env.VISUAL_OUT;
const shot = async (target: Page | Locator, name: string) => {
  if (OUT) await target.screenshot({ path: `${OUT}/${name}.png` });
};
const AT_DATE = '[data-tag="Entered"], [data-tag="Formal"], [data-tag="Scenario"]';
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

async function open(page: Page) {
  await page.goto("/projects");
  await page.getByRole("link", { name: "Canonical Value Journey" }).click();
  await expect(page.getByTestId("project-name")).toHaveText("Canonical Value Journey");
}

/** Hover the plot at a calendar date (period 2026–2028; plot margins as rendered by the chart). */
async function hoverAt(page: Page, chart: Locator, right: number, y: number, m: number, d: number) {
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.boundingBox())!;
  const [t0, t1] = [Date.UTC(2026, 0, 1), Date.UTC(2028, 11, 31)];
  const left = box.x + 8 + 56;
  const width = box.width - 8 - 56 - right;
  await page.mouse.move(left + ((Date.UTC(y, m, d) - t0) / (t1 - t0)) * width, box.y + box.height / 2, { steps: 3 });
}

for (const width of [1366, 1024]) {
  test(`executive trajectory visuals at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await open(page);

    // Overview: primary Value Trajectory on V2 with named end labels and the period-end Value Gap bracket.
    const t = page.getByTestId("value-trajectory");
    const chart = t.getByTestId("trajectory-chart");
    await expect(t.getByTestId("trajectory-definitions")).toContainText("Formal Forecast = what we formally expect.");
    await expect(chart.getByTestId("trajectory-end-label-plan")).toHaveText("Authorised V2 · $27.0m");
    await expect(chart.getByTestId("trajectory-end-label-forecast")).toHaveText("Formal Forecast · $25.0m");
    await expect(chart.getByTestId("trajectory-gap-bracket")).toHaveAttribute("data-label", "Value Gap · $2.0m");
    await expect(page.getByTestId("overview-gap")).toHaveText("$2.0m");
    await page.mouse.move(0, 0);
    await shot(t, `${width}-1-overview-trajectory`);

    // Monthly sweep: every hovered month shows that month (or a stored date inside it); a value-free month never
    // shows a value AT the month — only Previous / Next / Latest formal.
    const tip = page.getByTestId("trajectory-tooltip");
    for (const [y, m] of [
      [2027, 0],
      [2027, 1],
      [2027, 2],
      [2027, 3],
      [2027, 4],
      [2027, 5],
    ] as const) {
      await hoverAt(page, chart, 172, y, m, 20);
      const heading = (await tip.getByTestId("tip-heading").textContent())!;
      expect(heading, `month ${y}-${m + 1}`).toMatch(new RegExp(`(^|\\d+ )${MONTH[m]} ${y}$`));
      if (/^[A-Z]/.test(heading)) await expect(tip.locator(AT_DATE)).toHaveCount(0);
      await expect(tip.getByTestId("tip-footer")).toHaveText(
        "Value Gap at Value Period end: $2.0m (Authorised V2 $27.0m − Formal Forecast $25.0m)",
      );
    }
    await hoverAt(page, chart, 172, 2027, 5, 20);
    await expect(tip.locator('[data-series-label="Authorised Plan (V2)"]')).toContainText("Previous31 Dec 2026 ·$5.0m");
    await expect(tip.locator('[data-series-label="Formal Forecast"]')).toContainText("Next31 Dec 2027 ·$15.5m");
    // 4D.9N.1B.1: Review #3's explicit 31 Dec 2026 milestone is the forecast's previous stored value.
    await expect(tip.locator('[data-series-label="Formal Forecast"]')).toContainText("Previous31 Dec 2026 ·$5.0m");
    await shot(t, `${width}-2-overview-tooltip-value-free-month`);
    // At 31 Dec 2026 both are stored values on that date: Authorised Plan $5.0m and Formal Forecast $5.0m (aligned).
    await hoverAt(page, chart, 172, 2026, 11, 29);
    await expect(tip.getByTestId("tip-heading")).toHaveText("31 Dec 2026");
    await expect(tip.locator('[data-series-label="Authorised Plan (V2)"] [data-tag="Entered"]')).toContainText("$5.0m");
    await expect(tip.locator('[data-series-label="Formal Forecast"] [data-tag="Formal"]')).toContainText("$5.0m");
    await shot(t, `${width}-2b-overview-tooltip-dec-2026`);

    // Value Case: trajectory facts + the E1 Evolution commitment story with event cards.
    await page
      .getByRole("navigation", { name: "Project" })
      .getByRole("link", { name: "Value Case", exact: true })
      .click();
    const evo = page.getByTestId("value-case-evolution");
    const ec = evo.getByTestId("evolution-chart");
    await expect(ec.getByTestId("evolution-promise")).toHaveCount(1);
    await expect(ec.getByTestId("evolution-commitment")).toHaveCount(1);
    for (const key of ["r1", "r2", "r3"]) await expect(ec.getByTestId(`evolution-checkpoint-${key}`)).toHaveCount(1);
    await expect(ec).toContainText("VC-001 · V2");
    await expect(evo.getByTestId("evolution-card-original-value")).toHaveText("$32.0m");
    await expect(evo.getByTestId("evolution-card-v2-delta")).toHaveText("-$3.0m");
    for (const [id, v] of [
      ["r2-against", "$30.0m"],
      ["r2-forecast", "$26.0m"],
      ["r2-realised", "$4.0m"],
      ["r2-gap", "$4.0m"],
      ["r3-against", "$27.0m"],
      ["r3-forecast", "$25.0m"],
      ["r3-realised", "$4.6m"],
      ["r3-gap", "$2.0m"],
    ] as const)
      await expect(evo.getByTestId(`evolution-card-${id}`)).toHaveText(v);
    await shot(page.getByTestId("value-trajectory"), `${width}-5-value-case-trajectory`);
    await shot(evo, `${width}-6-value-case-evolution`);

    // Review #2: Alternative Value Trajectories with the stored delayed-action pivot and the shared opening.
    await page
      .getByRole("navigation", { name: "Project" })
      .getByRole("link", { name: "Assurance", exact: true })
      .click();
    await page.getByTestId("review-row").getByRole("link", { name: "#2" }).click();
    const alt = page.getByTestId("alternative-value-trajectories");
    const ac = alt.getByTestId("alternatives-chart");
    await expect(ac.getByTestId("alternatives-pivot-marker")).toHaveText("Management acts — delayed action");
    await expect(alt.getByTestId("alternatives-shared-note")).toContainText("same path as No action until 30 Dec 2026");
    // 4D.9N.1B: the Formal Forecast is the review's formal expectation, stated apart from the assessed options.
    await expect(alt.getByTestId("alternatives-formal-forecast")).toHaveText(
      "Formal Forecast · $26.0mCurrent expected outcome before the assessed management interventions.",
    );
    await page.mouse.move(0, 0);
    await shot(alt, `${width}-3-alternatives`);
    const atip = page.getByTestId("alternatives-tooltip");
    // Before the pivot: Delay shares No action's path; Act now has already diverged (no shared note).
    await hoverAt(page, ac, 184, 2026, 10, 20);
    await expect(atip.getByTestId("tip-heading")).toHaveText("Nov 2026");
    await expect(atip.locator(AT_DATE)).toHaveCount(0);
    await expect(atip.locator('[data-series-label="Delay 3 months"]')).toContainText("Same path as No action");
    await expect(atip.locator('[data-series-label="Act now"]')).not.toContainText("Same path");
    await expect(atip.getByTestId("tip-footer")).toContainText("Client selected − Cardaxia recommendation = -$2.0m");
    await shot(alt, `${width}-4b-alternatives-tooltip-before-pivot`);
    // At the pivot month: the stored delayed-action note is an event; values shown are the stored scenario points.
    await hoverAt(page, ac, 184, 2026, 11, 30);
    await expect(atip.getByTestId("tip-heading")).toContainText("Dec 2026");
    await shot(alt, `${width}-4-alternatives-tooltip-pivot`);
    // After the pivot: Delay has diverged — previous stored value is the pivot, next is its own 2027 milestone.
    await hoverAt(page, ac, 184, 2027, 5, 20);
    await expect(atip.getByTestId("tip-heading")).toHaveText("Jun 2027");
    await expect(atip.locator('[data-series-label="Delay 3 months"]')).not.toContainText("Same path");
    await expect(atip.locator('[data-series-label="Delay 3 months"]')).toContainText("Next31 Dec 2027 ·$16.5m");
    await expect(atip.locator('[data-series-label="No action"]')).toContainText("Next31 Dec 2027 ·$15.0m");
    await shot(alt, `${width}-4c-alternatives-tooltip-after-pivot`);

    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(0);
  });
}
