import { expect, test } from "@playwright/test";

// Phase 4D.9F: Alternative Value Trajectories on the formal review of the synthetic "Trajectory Executive" (Review #2,
// 30 Sep 2026: realised $4.0m; options Act now $29m [Cardaxia recommendation], Delay 3 months $27m [Client selected],
// No action $23m, each with explicit milestones; VL-001 Vendor sequencing risk on VD-01). Assertions use data and
// labels, not geometry.

test("Alternative Value Trajectories: shared history → review → three explicit paths with stored terminal values", async ({
  page,
}) => {
  await page.goto("/projects");
  await page.getByRole("link", { name: "Trajectory Executive" }).click();
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "Assurance", exact: true }).click();
  await page.getByTestId("review-row").getByRole("link", { name: "#2" }).click();

  // 4D.9G: the management story, governed, before the detail.
  const story = page.getByTestId("review-story");
  await expect(story).toHaveAttribute("data-governed", "true");
  await expect(story.getByRole("heading", { name: "Why the value position moved" })).toBeVisible();
  await expect(story.getByTestId("story-what-changed")).toContainText("VL-001 Vendor sequencing risk");
  await expect(story.getByTestId("story-what-changed")).toContainText("E-002 Revised mobilisation plan (trigger)");
  await expect(story.getByTestId("story-value-affected")).toContainText(
    "VD-01 Procurement Savings: forecast $14.0m → $13.0m",
  );
  await expect(story.getByTestId("story-leakage")).toHaveText(
    "Total Value Leakage $700,000 = Recoverable $450,000 + Unrecoverable $250,000",
  );
  await expect(story.getByTestId("story-response")).toContainText("Cardaxia recommendation: Act now");
  await expect(story.getByTestId("story-decision")).toContainText("Client selected: Delay 3 months");
  await expect(story.getByTestId("story-governance")).toContainText("No Value Change linked to this review.");
  await expect(page.getByTestId("alternative-value-trajectories-preview")).toHaveCount(0);

  const s = page.getByTestId("alternative-value-trajectories");
  await expect(s.getByRole("heading", { name: "Alternative Value Trajectories" })).toBeVisible();
  await expect(s).toHaveAttribute("data-status", "ready");
  // One combined treatment: no second endpoint-only chart for the same options.
  await expect(page.getByTestId("alternative-value-outcomes")).toHaveCount(0);
  // Decision area: after the recorded client decision.
  const after = await page.evaluate(() => {
    const d = document.querySelector('[data-testid="decision"]')!;
    const a = document.querySelector('[data-testid="alternative-value-trajectories"]')!;
    return d.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(after).toBeTruthy();

  // The decision comparison: Client Selected vs Cardaxia Recommendation (no per-option difference metric).
  await expect(s.getByTestId("comparison-recommended")).toHaveText("$29.0m");
  await expect(s.getByTestId("comparison-selected")).toHaveText("$27.0m");
  await expect(s.getByTestId("comparison-difference")).toHaveText("-$2.0m");
  await expect(s.getByTestId("alternatives-difference")).toHaveCount(0);

  const chart = s.getByTestId("alternatives-chart");
  await expect(chart.getByTestId("alternatives-review-marker")).toHaveText(
    "Review #2 · 30 Sept 2026 · options assessed",
  );
  await expect(chart.locator('[data-series="history"]')).toHaveCount(3); // origin, Review #1, the review anchor
  await expect(chart.locator("[data-option]")).toHaveCount(6); // 2 explicit milestones per option; anchor not repeated
  await expect(chart.getByTestId("alternatives-end-label")).toHaveText([
    /\$29\.0m Act now\s*Cardaxia recommendation/,
    /\$27\.0m Delay 3 months\s*Client selected/,
    /\$23\.0m No action/,
  ]);

  // Tooltip at an explicit milestone only shows stored values.
  await chart.locator('[data-option="Act now"]').last().hover();
  const tip = page.getByTestId("alternatives-tooltip");
  await expect(tip).toContainText("31 Dec 2028");
  await expect(tip).toContainText("Act now: $29.0m · Cardaxia recommendation");
  await expect(tip).toContainText("Delay 3 months: $27.0m · Client selected");

  // Accessible economics without the chart.
  await expect(s.getByTestId("alternatives-row")).toHaveCount(3);
  await expect(s.getByTestId("alternatives-total")).toHaveText(["$29.0m", "$23.0m", "$27.0m"]);
  await s.getByTestId("alternatives-values").locator("summary").click();
  await expect(s.getByTestId("alternatives-value-row")).toHaveCount(9);

  // Laptop widths: no page overflow; terminal labels stay inside the section.
  for (const width of [1366, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(chart).toBeVisible();
    // ResponsiveContainer re-measures asynchronously after a resize: wait for the settled layout.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(0);
    const sb = (await story.boundingBox())!;
    expect(sb.x + sb.width).toBeLessThanOrEqual(width);
    const box = (await s.boundingBox())!;
    for (const label of await chart.getByTestId("alternatives-end-label").all()) {
      const b = (await label.boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width);
    }
  }
});

test("Draft review: working context and a Draft · Not governed trajectory preview", async ({ page }) => {
  await page.goto("/projects");
  await page.getByRole("link", { name: "Trajectory Compact" }).click();
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "Assurance", exact: true }).click();
  await page.getByTestId("review-row").getByRole("link", { name: "#1" }).click();

  const story = page.getByTestId("review-story");
  await expect(story).toHaveAttribute("data-governed", "false");
  await expect(story).toContainText("Working Assurance context");
  await expect(story.getByTestId("story-governance")).toContainText("Not yet a formal position");

  const preview = page.getByTestId("alternative-value-trajectories-preview");
  await expect(preview).toHaveAttribute("data-governed", "false");
  await expect(preview.getByTestId("not-governed-tag")).toHaveText("Draft · Not governed");
  await expect(preview.getByTestId("preview-recommendation")).toHaveText("Draft recommendation (not issued): Act now.");
  await expect(preview.getByTestId("alternatives-chart").getByTestId("alternatives-review-marker")).toHaveText(
    "Draft Review #1 · 30 Sept 2026 · not finalised",
  );
  await expect(page.getByTestId("alternative-value-trajectories")).toHaveCount(0); // no governed visual on a draft
  await expect(preview.getByText("Cardaxia recommendation", { exact: false })).toHaveCount(0);
});
