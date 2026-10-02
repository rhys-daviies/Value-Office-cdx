import { expect, test, type Page } from "@playwright/test";

// Phase 4D.9K: the canonical Value Office journey, seeded through commands (src/fixtures/canonical.ts) as
// "Canonical Value Journey": V0 $32.0m → V1 $30.0m → Reviews #1/#2 (V1) → VC-001 −$1.0m → Authorised V2 $29.0m →
// Review #3 (V2). Every surface must tell the same story; history keeps its own version.

const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Project" }).getByRole("link", { name, exact: true });

async function open(page: Page) {
  await page.goto("/projects");
  await page.getByRole("link", { name: "Canonical Value Journey" }).click();
  await expect(page.getByTestId("project-name")).toHaveText("Canonical Value Journey");
}

test("Overview and Value Case after V2: one consistent governed story", async ({ page }) => {
  await open(page);
  // Overview: V2 in force; the latest formal position is Review #3 against V2.
  await expect(page.getByTestId("overview-authorised-value")).toHaveText("$29.0m");
  await expect(page.getByTestId("overview-forecast")).toHaveText("$26.5m");
  await expect(page.getByTestId("overview-realised")).toHaveText("$4.6m");
  await expect(page.getByTestId("overview-gap")).toHaveText("$2.5m");
  await expect(page.getByTestId("overview-formal-position")).toContainText("Review #3");
  const summary = page.getByTestId("value-case-summary");
  await expect(summary.getByTestId("summary-current")).toHaveText("$29.0m");
  await expect(summary.getByTestId("summary-original")).toHaveText("$32.0m");
  await expect(summary.getByTestId("summary-changes")).toHaveText("1");
  await expect(summary).toContainText("Latest VC-001 → V2");
  // Trajectory on V2's plan, with the authorised Value Change marker; realised #1–#3; Today = formal position.
  const t = page.getByTestId("value-trajectory");
  await expect(t.getByTestId("trajectory-legend")).toContainText("Authorised Plan (V2)");
  await expect(t.getByTestId("trajectory-legend")).toContainText("Authorised Value Change");
  await expect(t.getByTestId("trajectory-chart").locator('[data-series="realised"]')).toHaveCount(4);
  await expect(t.getByTestId("trajectory-chart")).toContainText("Today · formal position");
  await expect(t.getByTestId("trajectory-legend")).toContainText("Today · formal position");
  await expect(t.getByTestId("trajectory-legend")).not.toContainText(/Formal position(?!\w)/); // one marker, one key

  // Value Case: commitment V2, history V1 → V2, the governed action that produced it.
  await tab(page, "Value Case").click();
  await expect(page.getByTestId("commitment-total")).toHaveText("$29.0m");
  await expect(page.getByTestId("current-commitment")).toContainText("Authorised V2");
  await expect(page.getByTestId("commitment-pending")).toHaveCount(0);
  await expect(page.getByTestId("evolution-v1-authorised")).toHaveText("$30.0m");
  await expect(page.getByTestId("evolution-v2-authorised")).toHaveText("$29.0m");
  await expect(page.getByTestId("evolution-v2-basis")).toContainText("via VC-001");
  await expect(page.getByTestId("value-change-row")).toHaveText([/VC-001.*V1 → V2.*Authorised.*-\$1\.0m/]);

  for (const width of [1366, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(0);
  }
});

test("historical Review #2 keeps its V1 meaning after V2 was authorised", async ({ page }) => {
  await open(page);
  await tab(page, "Assurance").click();
  await page.getByTestId("review-row").getByRole("link", { name: "#2" }).click();
  const story = page.getByTestId("review-story");
  await expect(story.getByTestId("story-position")).toContainText(
    "Formal position as at 30 Sept 2026 against V1: forecast $26.0m · Value Gap $4.0m · realised $4.0m",
  );
  await expect(story.getByTestId("story-leakage")).toHaveText(
    "Total Value Leakage $700,000 = Recoverable $450,000 + Unrecoverable $250,000",
  );
  await expect(story.getByTestId("story-value-change")).toContainText("VC-001 · V1 → V2 · authorised");
  const alt = page.getByTestId("alternative-value-trajectories");
  await expect(alt.getByTestId("comparison-recommended")).toHaveText("$29.0m");
  await expect(alt.getByTestId("comparison-selected")).toHaveText("$27.0m");
  await expect(alt.getByTestId("comparison-difference")).toHaveText("-$2.0m");
  // The management selection ($27.0m) did not become the commitment; VC-001 set $29.0m on its own rationale.
  await tab(page, "Assurance").click();
  await page.getByTestId("review-row").getByRole("link", { name: "#3" }).click();
  await expect(page.getByTestId("review-story").getByTestId("story-position")).toContainText("against V2");
});
