import { expect, test, type Locator, type Page } from "@playwright/test";

// Phase 4D.1: Continuous Assurance matters on the synthetic "Matters Compact" project
// (Authorised V1: VD-01 $1.0m, VD-02 $0.5m, VD-03 non-financial; one stakeholder, Test VCO).

async function submit(form: Locator, button: string, success: string | RegExp) {
  await form.getByRole("button", { name: button }).click();
  await expect(form.getByRole("status")).toContainText(success);
}

async function openAssurance(page: Page) {
  await page.goto("/projects");
  await page.getByRole("link", { name: "Matters Compact" }).click();
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "Assurance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Continuous Assurance" })).toBeVisible();
}

async function raiseMatter(page: Page, code: string, title: string) {
  await page.getByTestId("create-matter").locator("summary").click();
  const form = page.getByTestId("create-matter-form");
  await form.getByLabel("Code").fill(code);
  await form.getByLabel("Issue").fill(title);
  await form.getByLabel("VD-01").check();
  await form.getByRole("button", { name: "Raise matter" }).click();
  await page.waitForURL(/\/assurance\/matters\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("matter-header")).toContainText(title);
  return page.url();
}

async function setStage(page: Page, label: string) {
  const form = page.getByTestId("stage-form");
  await form.getByLabel("Working stage").selectOption({ label });
  await submit(form, "Set stage", "Working stage updated");
  await expect(page.getByTestId("matter-header")).toContainText(label);
}

test("matter outside a review → working stages → working VL → remediation → formal snapshot survives later edits", async ({
  page,
}) => {
  page.on("dialog", (d) => void d.accept());
  await openAssurance(page);

  // Two matters, no review needed: one worked on, one left unquantified.
  const unquantifiedUrl = await raiseMatter(page, "VL-201", "Unsized supplier risk");
  await expect(page.getByTestId("working-assessment")).toContainText("Not yet quantified");
  await openAssurance(page);
  const matterUrl = await raiseMatter(page, "VL-202", "Vendor cutover slipping");

  const owner = page.getByTestId("owner-form");
  await owner.getByLabel("Risk / Leakage Owner").selectOption({ label: "Test VCO — Value Case Owner" }); // 4D.13: person — role
  await submit(owner, "Save owner", "Risk / Leakage Owner updated");
  await expect(page.getByTestId("matter-owner")).toHaveText("Test VCO — Value Case Owner");

  await setStage(page, "Awaiting evidence");
  await setStage(page, "Assessing");

  const working = page.getByTestId("working-form");
  await working.getByLabel("Working total Value Leakage").fill("250k");
  await working.getByLabel("Working unrecoverable").fill("50k");
  await working.getByRole("button", { name: "Save working assessment" }).click();
  await expect(working.getByText("Required when unrecoverable is above zero")).toBeVisible();
  await working.getByLabel("Evidence of loss (required if unrecoverable > 0)").fill("Two months of benefit lost");
  await submit(working, "Save working assessment", "Working assessment recorded");
  await expect(page.getByTestId("working-assessment")).toContainText("Total $0.3m");
  await expect(page.getByRole("heading", { name: "Working assessment — not formally reviewed" })).toBeVisible();

  await setStage(page, "Remediation underway");
  const remediation = page.getByTestId("remediation-form");
  await remediation.getByLabel("Remediation approach").fill("Re-sequence the vendor cutover");
  await remediation.getByLabel("Monitor until").fill("2027-06-30");
  await submit(remediation, "Save remediation", "Remediation saved");
  await setStage(page, "Monitoring");

  // The workspace lists both open matters, separately from formal reviews.
  await openAssurance(page);
  const rows = page.getByTestId("matter-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "VL-201" }).getByTestId("working-amount")).toHaveText("Not yet quantified");
  await expect(rows.filter({ hasText: "VL-202" })).toContainText("Monitoring");
  await expect(rows.filter({ hasText: "VL-202" }).getByTestId("working-amount")).toContainText("$0.3m working");

  // Formal review: positions, then finalise — every open matter is snapshotted.
  const create = page.getByTestId("create-review-form");
  await create.getByLabel("Why is this review happening?").selectOption({ label: "Ad hoc" });
  await create.getByRole("button", { name: "Open review" }).click();
  await expect(page.getByTestId("review-state")).toContainText("Assurance Review #1");
  const positions = page.getByTestId("positions-form");
  await positions.getByTestId("position-editor-VD-01").getByLabel("Current Forecast").fill("0.9m");
  await positions
    .getByTestId("position-editor-VD-01")
    .getByLabel("Why the forecast changed (or why Not Assessed)")
    .fill("Synthetic: slower ramp-up");
  await positions.getByTestId("position-editor-VD-02").getByLabel("Current Forecast").fill("0.5m");
  await positions.getByTestId("position-editor-VD-03").getByLabel("Outcome outlook").fill("On track");
  await positions.getByRole("button", { name: "Save Value Positions" }).click();
  await expect(positions.getByRole("status")).toContainText("Value Positions saved");
  await page.getByRole("button", { name: "Finalise review" }).click();
  await expect(page.getByTestId("review-state")).toContainText("Finalised");
  const reviewUrl = page.url();

  await expect(page.getByText("As recorded at finalisation")).toBeVisible();
  const snapshot202 = page.getByTestId("leakage-VL-202");
  const snapshot201 = page.getByTestId("leakage-VL-201");
  await expect(snapshot202).toContainText("Monitoring");
  await expect(snapshot202).toContainText("Test VCO");
  // Working figures are not formal figures: both are formally not yet quantified.
  await expect(snapshot202.getByTestId("leakage-amounts")).toHaveText("Not yet quantified in this review");
  await expect(snapshot201.getByTestId("leakage-amounts")).toHaveText("Not yet quantified in this review");
  await expect(page.getByTestId("leakage-summary")).not.toContainText("$0.3m");

  // Later living edits…
  await page.goto(matterUrl);
  await setStage(page, "Escalated — decision required");
  await page.getByTestId("owner-form").getByLabel("Risk / Leakage Owner").selectOption({ label: "— Not assigned —" });
  await submit(page.getByTestId("owner-form"), "Save owner", "Risk / Leakage Owner updated");
  await expect(page.getByTestId("formal-record")).toContainText("Review #1");
  await expect(page.getByTestId("formal-record")).toContainText("Monitoring");
  await page.goto(unquantifiedUrl);
  await page
    .getByTestId("close-form")
    .getByLabel("Closure note — how the matter was resolved")
    .fill("Supplier confirmed capacity");
  await page.getByTestId("close-form").getByRole("button", { name: "Close matter" }).click();
  await expect(page.getByTestId("closure-note")).toHaveText("Supplier confirmed capacity"); // form becomes Reopen

  // …leave the finalised review exactly as it was.
  await page.goto(reviewUrl);
  await expect(snapshot202).toContainText("Monitoring");
  await expect(snapshot202).not.toContainText("Escalated");
  await expect(snapshot202).toContainText("Test VCO");
  await expect(snapshot201).toContainText("open");
  await expect(snapshot201.getByTestId("leakage-amounts")).toHaveText("Not yet quantified in this review");
});
