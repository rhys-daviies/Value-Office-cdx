import { expect, test, type Locator, type Page } from "@playwright/test";

// Phase 3 journey on the synthetic "Response Compact" project (Authorised V1:
// Alpha $1.0m, Beta $0.5m, Gamma non-financial; total $1.5m).

function tab(page: Page, name: string) {
  return page.getByRole("navigation", { name: "Project" }).getByRole("link", { name, exact: true });
}
async function open(details: Locator) {
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open)))
    await details.locator("summary").first().click();
}
async function saved(form: Locator, text: string | RegExp) {
  await expect(form.getByRole("status")).toContainText(text);
}

test("position → leakage → options → recommendation → decision → Value Change → Authorised V2", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await page.goto("/projects");
  await page.getByRole("link", { name: "Response Compact" }).click();
  await tab(page, "Assurance").click();
  await page.getByTestId("create-review-form").getByRole("button", { name: "Open review" }).click();
  await expect(page.getByTestId("review-state")).toContainText("Assurance Review #1");

  // ---- A3: explicit Not Assessed makes the project forecast Incomplete ----------------
  const positions = page.getByTestId("positions-form");
  await positions.getByTestId("position-editor-VD-01").getByLabel("Current Forecast").fill("0.9m");
  const beta = positions.getByTestId("position-editor-VD-02");
  await beta.getByLabel("Not assessed — no forecast possible yet").check();
  await beta.getByRole("textbox", { name: "Forecast rationale" }).fill("Vendor volumes not yet reported");
  await positions.getByTestId("position-editor-VD-03").getByLabel("Outcome outlook").fill("Positive");
  await positions.getByRole("button", { name: "Save Value Positions" }).click();
  await saved(positions, "Value Positions saved");
  await expect(page.getByTestId("review-forecast")).toHaveText("Incomplete");
  await expect(page.getByTestId("forecast-blockers")).toContainText("VD-02 Beta Revenue (Not Assessed)");
  await beta.getByLabel("Not assessed — no forecast possible yet").uncheck();
  await beta.getByLabel("Current Forecast").fill("400k");
  await positions.getByRole("button", { name: "Save Value Positions" }).click();
  await expect(page.getByTestId("review-forecast")).toHaveText("$1.3m");

  // ---- A1: unattributed realised value -------------------------------------------------
  const un = page.getByTestId("unattributed-form");
  await un.getByLabel("Unattributed realised value").fill("50k");
  await un.getByLabel("Why it remains unattributed").fill("Confirmed by finance at programme level only");
  await un.getByRole("button", { name: /Save unattributed/ }).click();
  await saved(un, "Review saved");
  await expect(page.getByTestId("realised-unattributed")).toHaveText("$50.0k");
  await expect(page.getByTestId("realised-total")).toHaveText("$50.0k");

  // ---- Value Leakage ---------------------------------------------------------------------
  await open(page.getByTestId("add-leakage"));
  const addVl = page.getByTestId("add-leakage-form");
  await addVl.getByLabel("Issue").fill("Vendor delay");
  await addVl.getByLabel("Risk / Leakage Owner").selectOption({ label: "Test VCO" });
  await addVl.getByLabel("Alpha Savings").check();
  await addVl.getByRole("button", { name: "Add leakage item" }).click();
  await saved(addVl, "VL-001 recorded");
  const vl = page.getByTestId("leakage-VL-001");
  await open(vl);
  const assess = page.getByTestId("assess-VL-001");
  await assess.getByLabel("Total VL").fill("300k");
  await assess.getByLabel("Unrecoverable VL").fill("100k");
  await assess.getByRole("button", { name: "Save assessment" }).click();
  await expect(assess).toContainText("Required when unrecoverable is above zero"); // needs evidence of loss
  await assess.getByLabel(/Evidence of loss/).fill("Q3 savings forgone: go-live moved");
  await assess.getByRole("button", { name: "Save assessment" }).click();
  await saved(assess, "Leakage assessed");
  await expect(page.getByTestId("leakage-total")).toHaveText("$0.3m");
  await expect(page.getByTestId("leakage-recoverable")).toHaveText("$0.2m");
  await expect(page.getByTestId("leakage-unrecoverable")).toHaveText("$0.1m");
  await expect(page.getByTestId("review-gap")).toHaveText("$0.2m"); // Value Gap is independent of leakage

  // ---- Options, recommendation ---------------------------------------------------------------
  await open(page.getByTestId("add-scenario"));
  const addOpt = page.getByTestId("add-scenario-form");
  for (const [label, kind, total] of [
    ["Current trajectory", "Current trajectory", "1.3m"],
    ["Act now", "Proposed recommendation", "1.5m"], // the "recommended" kind, worded as a proposal until issued (4D.9H)
    ["Delay one quarter", "Alternative", "1.4m"],
  ] as const) {
    await addOpt.getByLabel("Option").fill(label);
    await addOpt.getByLabel("Kind").selectOption({ label: kind });
    await addOpt.getByLabel("Projected total value").fill(total);
    await addOpt.getByRole("button", { name: "Add option" }).click();
    await expect(page.getByTestId("scenario-row").filter({ hasText: label })).toHaveCount(1);
  }
  await expect(page.getByTestId("scenario-vs-recommended")).toHaveText(["-$0.2m", "$0", "-$0.1m"]);
  const rec = page.getByTestId("recommendation-form");
  await rec.getByLabel("Recommendation").fill("Act now to protect $0.2m.");
  await rec.getByRole("button", { name: "Save draft recommendation" }).click();
  await saved(rec, "Recommendation saved");
  await page.getByRole("button", { name: "Issue recommendation" }).click();
  await expect(page.getByTestId("recommendation")).toContainText("Issued");

  // ---- Finalise, then the client decides differently ---------------------------------------
  await page.getByRole("button", { name: "Finalise review" }).click();
  await expect(page.getByTestId("review-state")).toContainText("Finalised");
  const decision = page.getByTestId("decision-form");
  await decision.getByLabel("Selected option").selectOption({ label: "Delay one quarter ($1.4m)" });
  await decision.getByLabel("Decision maker").selectOption({ label: "Test VCO" });
  await decision.getByLabel("Rationale").fill("Budget cycle");
  await decision.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByTestId("decision-difference")).toHaveText("-$0.1m");
  await expect(page.getByTestId("recommendation")).toContainText("Act now: $1.5m"); // never rewritten

  // ---- Value Change -> V2 ---------------------------------------------------------------------
  const vc = page.getByTestId("create-change-form");
  await vc.getByLabel("Stated change to Authorised Value").fill("-0.1m");
  await vc.getByLabel("Reason").fill("Client elected to delay one quarter");
  await vc.getByRole("button", { name: "Prepare Value Change" }).click();
  await expect(page.getByTestId("change-state")).toContainText("VC-001");
  await expect(page.getByText("Not reconciled")).toBeVisible();
  const alpha = page.getByTestId("driver-VD-01");
  await open(alpha);
  await page
    .getByTestId("driver-form-VD-01")
    .getByRole("textbox", { name: /^Financial value/ })
    .fill("0.9m");
  await page.getByTestId("driver-form-VD-01").getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByText("Reconciled: the proposed drivers deliver the stated change.")).toBeVisible();
  await expect(page.getByTestId("change-to-total")).toHaveText("$1.4m");
  await page.getByRole("button", { name: "Propose VC-001" }).click();
  await expect(page.getByTestId("change-state")).toContainText("proposed");

  const ev = page.getByTestId("change-evidence-form");
  await ev.getByRole("button", { name: "Record evidence" }).click();
  await saved(ev, /Evidence E-\d+ recorded/);
  const auth = page.getByTestId("authorise-change-form");
  await auth.getByLabel("Authorisation evidence").selectOption({ label: "E-003 VCO authorisation of VC-001" });
  await auth.getByRole("button", { name: /Record authorisation/ }).click();
  await expect(page.getByTestId("change-state")).toContainText("authorised");
  await expect(page.getByTestId("change-authorisation")).toContainText("Test VCO");

  // V1 preserved as superseded; V2 in force; the next review measures against V2.
  await tab(page, "Value Case").click();
  await expect(page.getByTestId("timeline-v1")).toContainText("Superseded");
  await expect(page.getByTestId("timeline-v1-total")).toHaveText("$1.5m");
  await expect(page.getByTestId("timeline-v2")).toContainText("Authorised Value Case V2");
  await expect(page.getByTestId("timeline-v2-total")).toHaveText("$1.4m");
  await tab(page, "Assurance").click();
  await expect(page.getByTestId("assurance-authorised")).toHaveText("$1.4m");
  await page.getByTestId("create-review-form").getByRole("button", { name: "Open review" }).click();
  await expect(page.getByTestId("review-state")).toContainText("Assurance Review #2");
  await expect(page.getByRole("link", { name: "Authorised V2" })).toBeVisible();
  await expect(page.getByTestId("previous-position")).toContainText("Review #1");

  await tab(page, "Overview").click();
  await expect(page.getByTestId("overview-authorised-version")).toContainText("V2");
  await expect(page.getByTestId("overview-leakage-total")).toHaveText("$0.3m");
  await expect(page.getByTestId("overview-leakage-recoverable")).toHaveText("$0.2m");
  await expect(page.getByTestId("overview-decision")).toContainText("Delay one quarter");
});
