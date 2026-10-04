import { expect, test, type Page } from "@playwright/test";

// Phase 4D.10F: Assurance as the consultant's operating workspace, on the synthetic "Workspace Compact" project
// (Authorised V1 $1.5m: VD-01 $1.0m, VD-02 $0.5m, VD-03 non-financial; Review #1 finalised at $1.4m; VL-101 escalated
// with $0.3m working leakage; VL-102 awaiting evidence with E-003 linked, one request outstanding and a remediation plan).

const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Project" }).getByRole("link", { name, exact: true });

test("landing → review reasoning → matter handoff → forecast movement → Value Case impact", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await page.goto("/projects");
  await page.getByRole("link", { name: "Workspace Compact" }).click();
  await tab(page, "Assurance").click();

  // ---- Landing: current position, active assurance, formal reviews ------------------------------
  const current = page.getByTestId("assurance-current");
  await expect(current.getByTestId("assurance-authorised")).toHaveText("$1.5m");
  await expect(current.getByTestId("assurance-forecast")).toHaveText("$1.4m");
  await expect(current.getByTestId("current-latest")).toContainText("Review #1");
  await expect(current.getByTestId("current-next-requirement")).toContainText("Next formal Assurance requirement");
  await expect(current.getByTestId("gap-vs-leakage")).toContainText("They are not reconciled");
  await expect(page.getByTestId("active-evidence-outstanding")).toContainText("1 item across 1 matter");
  await expect(page.getByTestId("active-remediation")).toContainText("1 planned");
  const vl102 = page.getByTestId("matter-row").filter({ hasText: "VL-102" });
  await expect(vl102.getByTestId("matter-request-state")).toHaveText("Evidence requested · 1 item outstanding");
  await expect(vl102.getByTestId("matter-remediation")).toContainText("Secondary supplier on standby");
  // VL-102 was raised after Review #1 was finalised, so no formal review has recorded it yet.
  await expect(vl102.getByTestId("matter-formal")).toHaveText("Not yet in a formal review");

  // ---- Create the review with both reasoning fields ------------------------------------------------
  const create = page.getByTestId("create-review-form");
  await create.getByLabel("Why is this review happening?").selectOption({ label: "Ad hoc" });
  await create.getByLabel("What changed?").fill("Supplier capacity is unconfirmed.");
  await create.getByLabel("Why does it matter?").fill("VD-02 benefits depend on the supplier.");
  await create.getByRole("button", { name: "Open review" }).click();
  await expect(page.getByTestId("review-state")).toContainText("Assurance Review #2");

  // Both visible together, early, and in the in-app story right after each other.
  const reasoning = page.getByTestId("reasoning-form");
  await expect(reasoning.getByLabel("What changed?")).toHaveValue("Supplier capacity is unconfirmed.");
  await expect(reasoning.getByLabel("Why does it matter?")).toHaveValue("VD-02 benefits depend on the supplier.");
  await expect(page.getByTestId("story-why-it-matters")).toContainText("VD-02 benefits depend on the supplier.");
  await expect(page.getByTestId("review-step-reasoning")).toContainText("recorded");

  // Reasoning order: context → reasoning → matters → forecast → options → recommendation → decision → impact.
  const order = await page.evaluate(() =>
    [
      "context",
      "reasoning",
      "leakage",
      "position",
      "options",
      "recommendation",
      "decision",
      "value-change",
      "finalise",
    ].map((id) => document.getElementById(id)!.getBoundingClientRect().top + window.scrollY),
  );
  expect([...order].sort((a, b) => a - b)).toEqual(order);

  // Matters carry their remediation and live evidence status.
  const reviewUrl = page.url();
  const matter = page.getByTestId("leakage-VL-102");
  await matter.locator("summary").click();
  await expect(matter.getByTestId("matter-response-remediation")).toContainText("Secondary supplier on standby");
  await expect(matter.getByTestId("matter-response-evidence")).toContainText("Evidence requested · 1 item outstanding");
  await expect(matter.getByTestId("matter-response-formal")).toContainText("Not yet assessed");

  // ---- Matter → review handoff -----------------------------------------------------------------------
  await tab(page, "Assurance").click();
  await expect(page.getByTestId("active-draft-review")).toContainText("Review #2 (draft)");
  await page.getByTestId("matter-row").filter({ hasText: "VL-102" }).getByRole("link", { name: "VL-102" }).click();
  await expect(page.getByTestId("workflow-remediation")).toHaveAttribute("data-done", "true");
  await expect(page.getByTestId("workflow-leakage")).toHaveAttribute("data-done", "false");
  await expect(page.getByTestId("matter-request-summary")).toHaveAttribute("data-state", "requested");
  await expect(page.getByTestId("matter-handoff")).toContainText("Being assessed in Review #2 (draft)");
  await page.getByTestId("rely-on-review-form").getByRole("button", { name: "Rely on in Review #2" }).click();
  await expect(page.getByTestId("relied-on-in-review")).toHaveText("Relied on in Review #2");

  // Evidence partially received: visible, never blocking.
  const fulfil = page.getByTestId("fulfil-item-form");
  await fulfil.getByRole("combobox", { name: /^Status/ }).selectOption({ label: "Partial" });
  await fulfil.getByRole("button", { name: "Update request" }).click();
  await expect(page.getByTestId("matter-request-summary")).toHaveText(
    "Evidence partially received · 1 item outstanding",
  );

  await page.getByRole("link", { name: "Assess in Review #2 →" }).click();
  await expect(page).toHaveURL(/#matter-VL-102$/);
  await expect(page.getByTestId("leakage-VL-102")).toHaveAttribute("open", "");
  await expect(page.getByTestId("review-evidence")).toContainText("E-003 Supplier status letter");

  // ---- Forecast Value Position: 4D.10E baseline / movement / reason / related matter --------------------
  const positions = page.getByTestId("positions-form");
  await positions.getByTestId("position-editor-VD-01").getByLabel("Current Forecast").fill("0.9m");
  await positions.getByTestId("position-editor-VD-02").getByLabel("Current Forecast").fill("0.4m");
  await positions.getByTestId("position-editor-VD-03").getByLabel("Outcome outlook").fill("On track");
  await positions.getByRole("button", { name: "Save Value Positions" }).click();
  await expect(positions.getByRole("status")).toContainText("Value Positions saved");
  const row = (code: string) => page.getByTestId("position-row").filter({ hasText: code });
  await expect(row("VD-01").getByTestId("position-baseline")).toContainText("$0.9m");
  await expect(row("VD-01").getByTestId("position-baseline-source")).toHaveText("Review #1");
  await expect(row("VD-01").getByTestId("position-unchanged")).toBeVisible();
  await expect(row("VD-02").getByTestId("position-why-missing")).toBeVisible();
  await expect(page.getByRole("button", { name: "Finalise review" })).toBeDisabled();
  await expect(page.getByTestId("finalise-evidence-outstanding")).toContainText("not blocking");

  const vd02 = positions.getByTestId("position-editor-VD-02");
  await vd02.getByLabel("Why the forecast changed (or why Not Assessed)").fill("Supplier capacity reduced");
  await vd02
    .getByLabel("Related Assurance matter (optional)")
    .selectOption({ label: "VL-102 Supplier capacity unconfirmed" });
  await positions.getByRole("button", { name: "Save Value Positions" }).click();
  await expect(positions.getByRole("status")).toContainText("Value Positions saved");
  await expect(row("VD-02").getByTestId("position-why")).toHaveText("Why it moved: Supplier capacity reduced");
  await expect(row("VD-02").getByTestId("position-matter")).toContainText("VL-102");
  await expect(row("VD-02").getByTestId("position-movement")).toHaveText("-$0.1m");

  // ---- Value Case impact: forecast movement never alters the Authorised Value ----------------------------
  const impact = page.getByTestId("value-case-impact");
  await expect(impact.getByTestId("impact-authorised")).toHaveText("$1.5m");
  await expect(impact.getByTestId("value-change-guidance")).toContainText("never created automatically");
  await expect(impact).toContainText("A Value Change is prepared after the client decision.");

  await page.getByRole("button", { name: "Finalise review" }).click();
  await expect(page.getByTestId("review-state")).toContainText("Finalised");
  await expect(page.getByTestId("reasoning-form")).toHaveCount(0);
  await expect(page.getByTestId("what-changed")).toHaveText("Supplier capacity is unconfirmed.");
  await expect(page.getByTestId("why-it-matters")).toHaveText("VD-02 benefits depend on the supplier.");
  await expect(page.getByTestId("story-no-value-change")).toBeVisible();
  expect(page.url()).toContain(reviewUrl.split("#")[0]!);

  await tab(page, "Assurance").click();
  await expect(page.getByTestId("assurance-authorised")).toHaveText("$1.5m");
  await expect(page.getByTestId("assurance-forecast")).toHaveText("$1.3m");
  await expect(page.getByTestId("current-latest")).toContainText("Review #2");
  await expect(page.getByTestId("matter-row").filter({ hasText: "VL-102" }).getByTestId("matter-formal")).toContainText(
    "Last recorded: Review #2",
  );
});
