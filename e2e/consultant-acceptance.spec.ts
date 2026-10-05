import { appendFileSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

// Phase 4D.10I: the full consultant acceptance journey, entirely through the consultant UI, starting from a new client
// and project. Synthetic values (USD, Cumulative Benefit, 1 Jul 2026 – 30 Jun 2029):
//
//   Original Business Case $10.0m: VD-01 Procurement Savings $6.0m, VD-02 Process Automation $3.0m,
//                                  VD-03 Legacy Decommissioning $1.0m
//   V1 $9.5m: VD-01 $5.5m (adjusted), VD-02 $3.0m (unchanged), VD-03 not carried forward, VD-04 $1.0m (introduced)
//   Review #1 (Kick-off): forecast $9.0m; recommendation returned for a delayed option; decision; No Value Change
//   Review #2 (material evidence): forecast $8.5m vs Review #1; decision; Value Change Proposed → VC-001 −$0.5m
//   V2 $9.0m (VD-01 $5.0m), plan re-phased; Review #3 against V2: forecast $8.6m, Value Gap $0.4m

const uid = Date.now().toString(36);

// Fail fast on a wrong locator instead of waiting for the (long) journey timeout.
test.use({ actionTimeout: 20_000 });
const PROJECT = `Acceptance Journey ${uid} (SYNTHETIC)`;

const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Project" }).getByRole("link", { name, exact: true });

async function open(details: Locator) {
  // A bounded wait: evaluate() otherwise waits for the element until the test timeout.
  const isOpen = await details.evaluate((el) => (el as HTMLDetailsElement).open, undefined, { timeout: 10_000 });
  if (!isOpen) await details.locator("summary").first().click();
}

async function submit(form: Locator, button: string | RegExp, success: string | RegExp) {
  await form.getByRole("button", { name: button }).click();
  await expect(form.getByRole("status")).toContainText(success);
}

/** Select the option whose text matches (labels carry generated codes such as E-004). */
async function selectMatching(select: Locator, text: RegExp) {
  const options = await select.locator("option").allTextContents();
  const label = options.find((o) => text.test(o));
  expect(label, `option matching ${text}`).toBeTruthy();
  await select.selectOption({ label: label! });
}

async function addMilestone(editor: Locator, asOf: string, value: string) {
  const add = editor.locator("details").last();
  await open(add);
  await add.locator('input[name="asOf"]').fill(asOf);
  await add.locator('input[name="value"]').fill(value);
  await add.getByRole("button", { name: "Add" }).click();
  await expect(editor.locator(`[data-testid="milestone"][data-as-of="${asOf}"]`)).toHaveCount(1);
}

async function addOption(page: Page, label: string, kind: string, total: string) {
  const panel = page.getByTestId("add-scenario");
  await open(panel);
  const form = page.getByTestId("add-scenario-form");
  await form.getByLabel("Option").fill(label);
  await form.getByLabel("Kind").selectOption({ label: kind });
  await form.getByLabel("Projected total value").fill(total);
  await form.getByRole("button", { name: "Add option" }).click();
  await expect(page.getByTestId("scenario-row").filter({ hasText: label })).toHaveCount(1);
}

async function positions(page: Page, values: Record<string, { forecast: string; why?: string; matter?: RegExp }>) {
  const form = page.getByTestId("positions-form");
  for (const [code, v] of Object.entries(values)) {
    const block = form.getByTestId(`position-editor-${code}`);
    await block.getByLabel("Current Forecast").fill(v.forecast);
    if (v.why) await block.getByLabel("Why the forecast changed (or why Not Assessed)").fill(v.why);
    if (v.matter) await selectMatching(block.getByLabel("Related Assurance matter (optional)"), v.matter);
  }
  await submit(form, "Save Value Positions", "Value Positions saved");
}

/**
 * Acceptance evidence: a full-page Overview screenshot and the Overview's position / governance / attention text at a
 * named state, written to this test's output folder. Returns to the page it came from.
 */
async function overviewEvidence(page: Page, name: string) {
  const back = page.url();
  if (!/\/projects\/[0-9a-f-]{36}$/.test(back)) await tab(page, "Overview").click();
  await expect(page.getByTestId("executive-position")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath(`overview-${name}.png`), fullPage: true });
  const text = async (id: string) =>
    (await page.getByTestId(id).count()) ? (await page.getByTestId(id).innerText()).replace(/\s+/g, " ") : "—";
  appendFileSync(
    test.info().outputPath("overview-states.md"),
    `## ${name}\n- Position: ${await text("executive-position")}\n- Governance: ${await text("overview-governance")}\n` +
      `- Attention: ${await text("overview-attention")}\n\n`,
  );
  if (page.url() !== back) await page.goto(back);
}

const recState = (page: Page) => page.getByTestId("recommendation-state");
const stage = (page: Page) => page.getByTestId("impact-stage");

/** Every primary destination renders, with no error page and no retired terminology. */
async function navigationSweep(page: Page) {
  for (const name of [
    "Overview",
    "Mobilisation",
    "Value Case Definition",
    "Value Case",
    "Assurance",
    "Evidence",
    "Information Requests",
    "Value Drivers",
    "Reports",
    "History",
  ]) {
    await tab(page, name).click();
    await expect(tab(page, name)).toHaveAttribute("aria-current", "page");
    const main = page.locator("main");
    await expect(main).not.toContainText("Application error");
    await expect(main).not.toContainText("This page could not be found");
    // The report keeps its issued name ("Re-Qualification Report"; renaming new issues is a PMO question). Any other
    // use of the retired stage name is a terminology leak.
    const text = (await main.innerText()).replaceAll("Re-Qualification Report", "");
    expect(text, `retired terminology on ${name}`).not.toMatch(/Re-?Qualification|Inherited Business Case|\bSetup\b/i);
  }
}

test("full consultant journey: new project → Original Business Case → V1 → Assurance → reviews → V2", async ({
  page,
}) => {
  test.setTimeout(15 * 60_000);
  page.on("dialog", (d) => void d.accept());

  await test.step("start from zero: new client and project", async () => {
    await page.goto("/projects/new");
    const create = page.getByTestId("create-project-form");
    await create.getByLabel("Create a new client").check();
    await create.getByLabel("New client name").fill(`Synthetic Acceptance Client ${uid}`);
    await create.getByLabel("Project name").fill(PROJECT);
    await create.getByLabel("Currency").fill("USD");
    await create.getByLabel("Value Basis description").fill("Synthetic: cumulative financial benefit FY27–FY29");
    await create.getByLabel("Period start").fill("2026-07-01");
    await create.getByLabel("Period end").fill("2029-06-30");
    await create.getByLabel("Kick-off").fill("2026-07-15");
    await create.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByTestId("project-name")).toHaveText(PROJECT);
    // The consultant is told where to start.
    await expect(page.getByTestId("mobilisation-status")).toHaveAttribute("data-stage", "mobilising");
    await expect(page.getByTestId("mobilisation-next")).toContainText("Nominate the Value Case Owner");
  });

  await test.step("Mobilisation: stakeholders, VCO and the Day-1 Information Request", async () => {
    await tab(page, "Mobilisation").click();
    const s = page.getByTestId("add-stakeholder-form");
    await s.getByLabel("Name").fill("Val Owner");
    await s.getByLabel("This person is the Value Case Owner").check();
    await submit(s, "Add stakeholder", "Val Owner added as Value Case Owner");
    await s.getByLabel("Name").fill("Ava Accountable");
    await s.getByLabel("Role on this project").fill("AVO — Procurement");
    await submit(s, "Add stakeholder", "Ava Accountable added");

    const dayOne = page.getByTestId("day-one-create-form");
    await dayOne.getByTestId("day-one-business-case").check();
    await dayOne.getByTestId("day-one-programme-plan").check();
    await dayOne.getByLabel("Additional items").fill("Supplier contracts");
    await dayOne.getByRole("button", { name: "Create Information Request" }).click();
    await expect(page.getByTestId("day-one-existing")).toContainText("3 items");
    await expect(page.getByTestId("mobilisation-item-information-request")).toContainText("not yet issued");
    await navigationSweep(page); // pre-authorisation
  });

  await test.step("evidence and the Day-1 request: issued, received, partial, unavailable, closed", async () => {
    await tab(page, "Evidence").click();
    const ev = page.getByTestId("record-evidence-form");
    await ev.getByLabel("Title").fill("Original Business Case document");
    await submit(ev, "Record evidence", /Evidence E-001 recorded/);

    await tab(page, "Information Requests").click();
    await page.getByRole("button", { name: "Mark issued" }).click();
    await expect(page.getByText(/^Issued /)).toBeVisible();
    const items = page.getByTestId("ir-item");
    await expect(items).toHaveCount(3);
    const setItem = async (text: string, status: string, evidence?: RegExp) => {
      const item = items.filter({ hasText: text });
      await open(item);
      await item.getByLabel("Status").selectOption({ label: status });
      if (evidence) await selectMatching(item.getByLabel("Fulfilled by evidence"), evidence);
      await item.getByRole("button", { name: "Save item" }).click();
      await expect(items.filter({ hasText: text })).toContainText(status);
    };
    await setItem("Existing Business Case", "Received", /E-001 Original Business Case document/);
    await setItem("Programme / project plan", "Partial");
    await setItem("Supplier contracts", "Not available");
    await tab(page, "Mobilisation").click();
    await expect(page.getByTestId("mobilisation-item-information-request")).toContainText("1 of 3 items outstanding");
    await tab(page, "Information Requests").click();
    await page.getByRole("button", { name: "Close request" }).click();
    await expect(page.getByTestId("ir-index-row").first()).toContainText("Closed");
  });

  await test.step("Original Business Case: total, drivers, record (immutable)", async () => {
    await tab(page, "Value Case").click();
    const v0 = page.getByTestId("create-v0-form");
    await v0.getByLabel("Stated total value").fill("10m");
    await v0.getByRole("button", { name: "Start capturing the Original Business Case" }).click();
    await page.getByRole("link", { name: "Open Original Business Case" }).click();
    for (const [name, value, code] of [
      ["Procurement Savings", "6m", "VD-01"],
      ["Process Automation", "3m", "VD-02"],
      ["Legacy Decommissioning", "1m", "VD-03"],
    ]) {
      await open(page.getByTestId("add-driver"));
      const add = page.getByTestId("add-driver-form");
      await add.getByLabel("Name").fill(name!);
      await add.getByRole("textbox", { name: /^Financial value/ }).fill(value!);
      await submit(add, "Add driver", `Value Driver ${code} added`);
    }
    await expect(page.getByTestId("obc-stated-total")).toHaveText("$10.0m");
    await expect(page.getByTestId("obc-driver-summary")).toHaveText("3 drivers");
    await expect(page.getByTestId("driver-edit-VD-02")).toBeVisible(); // editing is discoverable
    await page.getByRole("button", { name: "Record the Original Business Case" }).click();
    await expect(page.getByText("Recorded — read-only")).toBeVisible();
    await expect(page.getByTestId("driver-edit-VD-01")).toHaveCount(0);
    await page.getByTestId("obc-continue").getByRole("link").click();
    await expect(page.getByTestId("definition-entry")).toContainText("3 drivers (VD-01, VD-02, VD-03)");
  });

  await test.step("Value Case Definition: V1 from the Original Business Case with governed reasons", async () => {
    await page
      .getByTestId("create-v1-form")
      .getByRole("button", { name: "Create draft V1 from the Original Business Case" })
      .click();
    await expect(page.getByTestId("requal-state")).toContainText("Draft Value Case (V1) — editable");
    await expect(page.getByTestId("comparison-row")).toHaveCount(3);

    // Adjust VD-01 (reason required).
    await page.getByTestId("driver-edit-VD-01").click();
    const f1 = page.getByTestId("driver-form-VD-01");
    await f1.getByRole("textbox", { name: /^Financial value/ }).fill("5.5m");
    await f1.getByLabel("Accountable Value Owner").selectOption({ label: "Ava Accountable" });
    await f1.getByLabel("Why the value differs from the Original Business Case").fill("Supplier quotes support $5.5m");
    await submit(f1, "Save driver", "Value Driver saved");

    // Drop VD-03 (reason required, recorded against the Original Business Case driver).
    const vd03 = page.getByTestId("driver-VD-03");
    await open(vd03);
    await vd03.getByRole("button", { name: "Remove driver from draft" }).click();
    await expect(page.getByTestId("driver-VD-03")).toHaveCount(0);
    await expect(page.getByTestId("propose-checklist")).toContainText("VD-03");
    await expect(page.getByRole("button", { name: "Propose Value Case V1" })).toBeDisabled();
    const notCarried = page.getByTestId("not-carried-form-VD-03");
    await notCarried.getByLabel("Reason (required before proposal)").fill("Legacy platform retained until FY30");
    await submit(notCarried, "Save reason", /saved|recorded/i);

    // Introduce VD-04 (reason required; no false zero-baseline arithmetic).
    await open(page.getByTestId("add-driver"));
    const add = page.getByTestId("add-driver-form");
    await add.getByLabel("Name").fill("Working Capital Release");
    await add.getByRole("textbox", { name: /^Financial value/ }).fill("1m");
    await submit(add, "Add driver", "Value Driver VD-04 added");
    await page.getByTestId("driver-edit-VD-04").click();
    const f4 = page.getByTestId("driver-form-VD-04");
    await f4.getByLabel("Why this value is introduced").fill("Inventory release identified in mobilisation");
    await submit(f4, "Save driver", "Value Driver saved");

    const row = (code: string) => page.getByTestId("comparison-row").filter({ hasText: code });
    await expect(row("VD-01")).toHaveAttribute("data-change", "adjusted");
    await expect(row("VD-02")).toHaveAttribute("data-change", "unchanged");
    await expect(row("VD-04")).toHaveAttribute("data-change", "new");
    const why = (code: string) => page.locator(`[data-testid="comparison-rationale"][data-code="${code}"]`);
    await expect(why("VD-01")).toContainText("Why changed: Supplier quotes support $5.5m");
    await expect(why("VD-04")).toContainText("Why introduced: Inventory release");
    await expect(why("VD-04")).not.toContainText("+$1.0m from");
    await expect(page.getByTestId("requal-v1-total")).toHaveText("$9.5m");
    await expect(page.getByTestId("requal-inherited-total")).toHaveText("$10.0m");
    await expect(page.getByTestId("propose-checklist")).toContainText("Every governed value movement has a rationale");

    // Value Basis and plan phasing (Value Trajectory).
    const basis = page.getByTestId("version-basis-form");
    await basis.getByLabel("Value Basis").selectOption({ label: "Cumulative Benefit" });
    await basis.getByRole("button", { name: "Save basis" }).click();
    const plan = page.getByTestId("plan-milestones");
    await addMilestone(plan, "2027-06-30", "3m");
    await addMilestone(plan, "2028-06-30", "6.5m");
    await addMilestone(plan, "2029-06-30", "9.5m");
    await expect(page.getByTestId("plan-reconciliation")).toContainText("Reconciled");

    // Propose the version as a whole; the VCO's authorisation is recorded with evidence.
    await page.getByRole("button", { name: "Propose Value Case V1" }).click();
    await expect(page.getByTestId("requal-state")).toContainText("Proposed Value Case (V1) — locked");
    const authEvidence = page.getByTestId("authorisation-evidence-form");
    await submit(authEvidence, "Record evidence", /Evidence E-\d+ recorded/);
    const authorise = page.getByTestId("authorise-form");
    await selectMatching(authorise.getByLabel("Authorisation evidence"), /VCO authorisation of V1/);
    await authorise.getByRole("button", { name: /Record authorisation/ }).click();
    await expect(page.getByTestId("requal-state")).toContainText("Authorised Value Case V1 — read-only");
  });

  await test.step("Overview and navigation immediately after authorisation", async () => {
    await tab(page, "Overview").click();
    await expect(page.getByTestId("overview-authorised-value")).toHaveText("$9.5m");
    await expect(page.getByTestId("overview-formal-position")).toHaveText("No formal Assurance position yet.");
    await expect(page.getByTestId("mobilisation-status")).toHaveCount(0); // pre-V1 guidance never returns
    await expect(page.getByTestId("overview-governance").getByTestId("gov-draft-review")).toHaveText("None");
    // The due Kick-off review is the next action — never "no action pending" beside a Due requirement (4D.10I fix).
    await expect(page.getByTestId("overview-next-action")).toContainText("Open the kick-off review");
    await overviewEvidence(page, "01-authorised-v1");
    await navigationSweep(page);
  });

  let matterUrl = "";
  await test.step("Continuous Assurance: matter, evidence request, working leakage, remediation", async () => {
    await tab(page, "Assurance").click();
    await open(page.getByTestId("create-matter"));
    const m = page.getByTestId("create-matter-form");
    await m.getByLabel("Code").fill("VL-001");
    await m.getByLabel("Issue").fill("Supplier price increase");
    await m.getByLabel("Description").fill("Lead supplier signalled a 6% increase from Q3");
    await m.getByLabel("Risk / Leakage Owner").selectOption({ label: "Ava Accountable" });
    await m.getByLabel("VD-01").check();
    await m.getByRole("button", { name: "Raise matter" }).click();
    await page.waitForURL(/\/assurance\/matters\/[0-9a-f-]{36}$/);
    matterUrl = page.url();
    await expect(page.getByTestId("matter-workflow")).toBeVisible();
    await expect(page.getByTestId("workflow-identified")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("matter-handoff")).toContainText("Worked continuously — no formal review is open");

    const stageForm = page.getByTestId("stage-form");
    await stageForm.getByLabel("Working stage").selectOption({ label: "Awaiting evidence" });
    await submit(stageForm, "Set stage", "Working stage updated");

    await open(page.getByTestId("request-evidence"));
    const req = page.getByTestId("request-evidence-form");
    await req.getByLabel("Evidence required").fill("Supplier price notice");
    await req.getByLabel("Requested from").selectOption({ label: "Ava Accountable" });
    await req.getByRole("button", { name: "Request evidence" }).click();
    await expect(page.getByTestId("matter-request-summary")).toHaveText("Evidence requested · 1 item outstanding");

    await open(page.getByTestId("document-evidence"));
    const doc = page.getByTestId("document-evidence-form");
    await doc.getByLabel("Title").fill("Supplier price notice (Q3)");
    await doc.getByRole("button", { name: "Record and link evidence" }).click();
    await expect(page.getByTestId("matter-evidence-row")).toHaveCount(1);
    const fulfil = page.getByTestId("fulfil-item-form");
    await fulfil.getByRole("combobox", { name: /^Status/ }).selectOption({ label: "Received" });
    await selectMatching(fulfil.getByLabel("Fulfilled by evidence"), /Supplier price notice/);
    await fulfil.getByRole("button", { name: "Update request" }).click();
    await expect(page.getByTestId("matter-request-summary")).toHaveText("Evidence received");

    const working = page.getByTestId("working-form");
    await working.getByLabel("Working total Value Leakage").fill("0.8m");
    await submit(working, "Save working assessment", "Working assessment recorded");
    const remediation = page.getByTestId("remediation-form");
    await remediation.getByLabel("Remediation approach").fill("Renegotiate the supplier contract");
    await remediation.getByLabel("Monitor until").fill("2027-06-30");
    await submit(remediation, "Save remediation", "Remediation saved");
    await stageForm.getByLabel("Working stage").selectOption({ label: "Monitoring" });
    await submit(stageForm, "Set stage", "Working stage updated");
    await expect(page.getByTestId("workflow-leakage")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("workflow-remediation")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("workflow-formal")).toHaveAttribute("data-done", "false"); // not yet formally assessed

    await tab(page, "Assurance").click();
    const row = page.getByTestId("matter-row").filter({ hasText: "VL-001" });
    await expect(row.getByTestId("working-amount")).toContainText("$0.8m working");
    await expect(row.getByTestId("matter-formal")).toHaveText("Not yet in a formal review");
  });

  await test.step("Review #1: reasoning order, leakage, governed forecast movement", async () => {
    const create = page.getByTestId("create-review-form");
    await create.getByLabel("Why is this review happening?").selectOption({ label: "Kick-off" });
    await create.getByLabel("What changed?").fill("Supplier pricing pressure on Procurement Savings.");
    await create.getByLabel("Why does it matter?").fill("Procurement Savings could fall $0.5m short.");
    await create.getByRole("button", { name: "Open review" }).click();
    await expect(page.getByTestId("review-state")).toContainText("Assurance Review #1");

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

    // Matter assessed in this review; its working evidence relied on deliberately.
    const matter = page.getByTestId("leakage-VL-001");
    await open(matter);
    await expect(matter.getByTestId("matter-response-remediation")).toContainText("Renegotiate the supplier contract");
    const assess = page.getByTestId("assess-VL-001");
    await assess.getByLabel("Total VL").fill("0.8m");
    await submit(assess, "Save assessment", /saved|recorded|assessed/i);
    await page.getByTestId("matter-evidence-candidate").getByRole("button", { name: "Rely on in this review" }).click();
    await expect(page.getByTestId("review-evidence")).toContainText("Supplier price notice (Q3)");

    // Forecast: VD-01 moves (reason + related matter); the others hold.
    await positions(page, {
      "VD-01": { forecast: "5.0m", why: "Supplier price increase", matter: /VL-001/ },
      "VD-02": { forecast: "3.0m" },
      "VD-04": { forecast: "1.0m" },
    });
    const pr = (code: string) => page.getByTestId("position-row").filter({ hasText: code });
    await expect(pr("VD-01").getByTestId("position-baseline")).toContainText("$5.5m");
    await expect(pr("VD-01").getByTestId("position-baseline-source")).toHaveText("authorised");
    await expect(pr("VD-01").getByTestId("position-movement")).toHaveText("-$0.5m");
    await expect(pr("VD-01").getByTestId("position-matter")).toContainText("VL-001");
    await expect(pr("VD-02").getByTestId("position-unchanged")).toBeVisible();
    await expect(page.getByTestId("review-forecast")).toHaveText("$9.0m");
    await expect(page.getByTestId("review-gap")).toHaveText("$0.5m");
    // Value Leakage ($0.8m) is not forced to reconcile with the Value Gap ($0.5m).
    await expect(page.getByTestId("leakage-total")).toHaveText("$0.8m");
    await overviewEvidence(page, "02-review1-underway");
  });

  await test.step("Review #1: internal recommendation challenge — returned for a delayed option", async () => {
    await addOption(page, "Current trajectory", "Current trajectory", "9.0m");
    await addOption(page, "Renegotiate supplier now", "Proposed recommendation", "9.4m");
    await addOption(page, "No action", "No action", "8.8m");
    const rec = page.getByTestId("recommendation-form");
    await rec.getByLabel("Recommendation").fill("Renegotiate now to protect $0.4m.");
    await submit(rec, "Save draft recommendation", "Recommendation saved");

    await page.getByRole("button", { name: "Submit for Internal Review" }).click();
    await expect(recState(page)).toHaveAttribute("data-state", "in_internal_review");
    await expect(page.getByTestId("recommendation-form")).toHaveCount(0);
    await expect(page.getByTestId("add-scenario")).toHaveCount(0);
    await expect(page.getByTestId("finalise-recommendation")).toBeVisible();
    await expect(page.getByRole("button", { name: "Finalise review" })).toBeDisabled();
    await overviewEvidence(page, "03-recommendation-in-internal-review");

    const ret = page.getByTestId("return-recommendation-form");
    await ret.getByLabel("Return for revision — reviewer feedback").fill("Add a delayed renegotiation option.");
    await ret.getByRole("button", { name: "Return for revision" }).click();
    await expect(recState(page)).toHaveAttribute("data-state", "returned");
    await expect(page.getByTestId("recommendation-feedback")).toContainText("Add a delayed renegotiation option.");
    await addOption(page, "Renegotiate next quarter", "Alternative", "9.2m");
    await expect(page.getByTestId("scenario-row")).toHaveCount(4);
    const rec2 = page.getByTestId("recommendation-form");
    await rec2.getByLabel("Recommendation").fill("Renegotiate now: a one-quarter delay costs $0.2m.");
    await submit(rec2, "Save draft recommendation", "Recommendation saved");
    await page.getByRole("button", { name: "Resubmit for Internal Review" }).click();
    await expect(recState(page)).toHaveAttribute("data-state", "in_internal_review");
    await page.getByRole("button", { name: "Mark Ready to Issue" }).click();
    await expect(recState(page)).toHaveAttribute("data-state", "ready_to_issue");
    await expect(page.getByTestId("add-scenario")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Finalise review" })).toBeDisabled();
    await expect(page.locator("#decision")).toContainText("recorded after Cardaxia's recommendation is issued");

    // Overview while the recommendation is ready to issue.
    await tab(page, "Overview").click();
    await expect(page.getByTestId("gov-recommendation")).toHaveText("Ready to Issue");
    await expect(page.getByTestId("overview-next-action")).toContainText("Issue the recommendation to management");
    await page.getByTestId("overview-next-action").click();
    await page.getByRole("button", { name: "Issue to management" }).click();
    await expect(recState(page)).toHaveAttribute("data-state", "issued");
    await expect(page.locator("#options")).toContainText("Options are frozen");
    await expect(page.getByTestId("review-history-item")).toHaveCount(4);
  });

  await test.step("Review #1: decision → No Value Change Required → finalise; V1 unchanged", async () => {
    const decision = page.getByTestId("decision-form");
    await decision.getByLabel("Selected option").selectOption({ label: "Renegotiate supplier now ($9.4m)" });
    await decision.getByLabel("Decision maker").selectOption({ label: "Val Owner" });
    await decision.getByLabel("Rationale").fill("Protect the commitment");
    await decision.getByRole("button", { name: "Record decision" }).click();
    await expect(page.getByTestId("decision")).toBeVisible();
    await expect(stage(page)).toHaveAttribute("data-stage", "awaiting_determination");

    await tab(page, "Overview").click();
    await expect(page.getByTestId("gov-impact")).toHaveText("To be determined");
    await overviewEvidence(page, "04-decision-awaiting-determination");
    await page.getByTestId("overview-next-action").click(); // Determine the Value Case impact
    const det = page.getByTestId("determination-form");
    await det.getByLabel("No Value Change Required").check();
    await det.getByLabel("Rationale").fill("Renegotiation protects the authorised commitment.");
    await det.getByRole("button", { name: "Record determination" }).click();
    await expect(stage(page)).toHaveAttribute("data-stage", "no_value_change");
    await expect(page.getByTestId("determination-unchanged")).toContainText("remains $9.5m (V1)");

    await page.getByRole("button", { name: "Finalise review" }).click();
    await expect(page.getByTestId("review-state")).toContainText("Finalised");
    await tab(page, "Overview").click();
    await expect(page.getByTestId("overview-authorised-value")).toHaveText("$9.5m"); // forecast never becomes authorised
    await expect(page.getByTestId("overview-forecast")).toHaveText("$9.0m");
    await expect(page.getByTestId("overview-gap")).toHaveText("$0.5m");
    await expect(page.getByTestId("gov-impact")).toHaveText("No Value Change Required");
    await expect(page.getByTestId("overview-next-action-none")).toBeVisible();
    await overviewEvidence(page, "05-no-value-change-required");
  });

  await test.step("Review #2: new evidence, baseline from Review #1, recommendation, Value Change Proposed", async () => {
    await tab(page, "Evidence").click();
    const ev = page.getByTestId("record-evidence-form");
    await ev.getByLabel("Title").fill("Renegotiation outcome: increase confirmed");
    await ev.getByRole("checkbox", { name: /^Material change/ }).check();
    await submit(ev, "Record evidence", /Evidence E-\d+ recorded/);

    await tab(page, "Assurance").click();
    await expect(page.getByTestId("requirement-material_evidence_change")).toContainText("Renegotiation outcome");
    const create = page.getByTestId("create-review-form");
    await create.getByLabel("Why is this review happening?").selectOption({ label: "Material evidence change" });
    await selectMatching(create.getByLabel("Triggering evidence (optional)"), /Renegotiation outcome/);
    await create.getByLabel("What changed?").fill("Renegotiation failed; the increase is confirmed.");
    await create.getByLabel("Why does it matter?").fill("Procurement Savings now $4.5m against $5.5m authorised.");
    await create.getByRole("button", { name: "Open review" }).click();
    await expect(page.getByTestId("previous-position")).toContainText("Review #1");

    await positions(page, {
      "VD-01": { forecast: "4.5m", why: "Price increase confirmed", matter: /VL-001/ },
      "VD-02": { forecast: "3.0m" },
      "VD-04": { forecast: "1.0m" },
    });
    const pr = (code: string) => page.getByTestId("position-row").filter({ hasText: code });
    await expect(pr("VD-01").getByTestId("position-baseline")).toContainText("$5.0m");
    await expect(pr("VD-01").getByTestId("position-baseline-source")).toHaveText("Review #1");
    await expect(pr("VD-01").getByTestId("position-movement")).toHaveText("-$0.5m");
    await expect(page.getByTestId("review-forecast")).toHaveText("$8.5m");
    await expect(page.getByTestId("review-gap")).toHaveText("$1.0m");
    await expect(page.getByTestId("review-movement")).toHaveText("-$0.5m");

    await addOption(page, "Current trajectory", "Current trajectory", "8.5m");
    await addOption(page, "Rebase Procurement Savings", "Proposed recommendation", "9.0m");
    await addOption(page, "Hold the commitment", "Alternative", "8.5m");
    const rec = page.getByTestId("recommendation-form");
    await rec.getByLabel("Recommendation").fill("Rebase Procurement Savings to $5.0m with a secondary supplier.");
    await submit(rec, "Save draft recommendation", "Recommendation saved");
    await page.getByRole("button", { name: "Submit for Internal Review" }).click();
    await expect(recState(page)).toHaveAttribute("data-state", "in_internal_review");
    await page.getByRole("button", { name: "Mark Ready to Issue" }).click();
    await page.getByRole("button", { name: "Issue to management" }).click();
    await expect(recState(page)).toHaveAttribute("data-state", "issued");

    const decision = page.getByTestId("decision-form");
    await decision.getByLabel("Selected option").selectOption({ label: "Rebase Procurement Savings ($9.0m)" });
    await decision.getByLabel("Decision maker").selectOption({ label: "Val Owner" });
    await decision.getByRole("button", { name: "Record decision" }).click();
    const det = page.getByTestId("determination-form");
    await det.getByLabel("Value Change Proposed").check();
    await det.getByLabel("Rationale").fill("The confirmed increase changes the authorised Procurement Savings.");
    await det.getByRole("button", { name: "Record determination" }).click();
    await expect(stage(page)).toHaveAttribute("data-stage", "proposed_not_prepared");
    // The review is finalised while V1 is still in force (finalisation needs the version it measured).
    await page.getByRole("button", { name: "Finalise review" }).click();
    await expect(page.getByTestId("review-state")).toContainText("Finalised");

    await tab(page, "Overview").click();
    await expect(page.getByTestId("gov-impact")).toHaveText("Value Change Proposed · not yet prepared");
    await expect(page.getByTestId("overview-next-action")).toContainText(
      "Prepare the Value Change proposed in Review #2",
    );
    await overviewEvidence(page, "06-value-change-proposed");
  });

  await test.step("Value Change → V2: determination context, draft changes nothing, authorisation", async () => {
    await page.getByTestId("overview-next-action").click();
    const vc = page.getByTestId("create-change-form");
    await vc.getByLabel("Stated change to Authorised Value").fill("-0.5m");
    await vc.getByLabel("Value Change reason").fill("Rebase Procurement Savings from $5.5m to $5.0m");
    await vc.getByRole("button", { name: "Prepare Value Change" }).click();
    await expect(page.getByTestId("change-state")).toContainText("VC-001");
    await expect(page.getByTestId("change-determination")).toContainText(
      "Value Change Proposed — The confirmed increase changes the authorised Procurement Savings.",
    );

    await tab(page, "Overview").click();
    await expect(page.getByTestId("overview-authorised-value")).toHaveText("$9.5m"); // a draft changes nothing
    await expect(page.getByTestId("gov-change")).toContainText("VC-001 (draft)");
    await overviewEvidence(page, "07-draft-value-change");
    await page.getByTestId("overview-next-action").click(); // Complete and propose VC-001

    await open(page.getByTestId("driver-VD-01"));
    const f = page.getByTestId("driver-form-VD-01");
    await f.getByRole("textbox", { name: /^Financial value/ }).fill("5.0m");
    await submit(f, "Save driver", "Value Driver saved");
    // Re-phase the copied plan so it ends at the V2 total.
    const terminal = page.getByTestId("plan-milestones").locator('[data-as-of="2029-06-30"]');
    await open(terminal.getByTestId("milestone-edit"));
    await terminal.locator('input[name="value"]').fill("9.0m");
    await terminal.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("plan-reconciliation")).toContainText("Reconciled");
    await expect(page.getByText("Reconciled: the proposed drivers deliver the stated change.")).toBeVisible();
    await page.getByRole("button", { name: "Propose VC-001" }).click();
    await expect(page.getByTestId("change-state")).toContainText("proposed");
    await submit(page.getByTestId("change-evidence-form"), "Record evidence", /Evidence E-\d+ recorded/);
    const auth = page.getByTestId("authorise-change-form");
    await selectMatching(auth.getByLabel("Authorisation evidence"), /VCO authorisation of VC-001/);
    await auth.getByRole("button", { name: /Record authorisation/ }).click();
    await expect(page.getByTestId("change-state")).toContainText("authorised");

    await tab(page, "Value Case").click();
    await expect(page.getByTestId("timeline-v1")).toContainText("Superseded");
    await expect(page.getByTestId("timeline-v2-total")).toHaveText("$9.0m");
    const evo = page.getByTestId("value-case-evolution");
    await expect(evo.getByTestId("evolution-original-value")).toHaveText("$10.0m");
    await expect(evo.getByTestId("evolution-v1-authorised")).toHaveText("$9.5m");
    await expect(evo.getByTestId("evolution-v2-authorised")).toHaveText("$9.0m");
    await expect(evo.getByTestId("evolution-v2-basis")).toContainText("via VC-001");

    await tab(page, "Overview").click();
    await expect(page.getByTestId("overview-authorised-value")).toHaveText("$9.0m");
    await expect(page.getByTestId("gov-impact")).toHaveText("Value Change authorised");
    await expect(page.getByTestId("value-trajectory")).toBeVisible();
    await overviewEvidence(page, "08-authorised-v2");
  });

  await test.step("Review #3 against V2: baseline, rationale, Value Gap on V2, continuity", async () => {
    await tab(page, "Assurance").click();
    await expect(page.getByTestId("assurance-authorised")).toHaveText("$9.0m");
    await expect(page.getByTestId("matter-row").filter({ hasText: "VL-001" })).toContainText(
      "Last recorded: Review #2",
    );
    await page.getByTestId("create-review-form").getByRole("button", { name: "Open review" }).click();
    await expect(page.getByTestId("review-state")).toContainText("Assurance Review #3");
    await expect(page.getByTestId("context-authorised")).toHaveText("$9.0m");
    await expect(page.getByRole("link", { name: "Authorised V2" })).toBeVisible();
    await expect(page.getByTestId("previous-position")).toContainText("Review #2");

    await positions(page, {
      "VD-01": { forecast: "4.6m" },
      "VD-02": { forecast: "3.0m" },
      "VD-04": { forecast: "1.0m" },
    });
    const pr = (code: string) => page.getByTestId("position-row").filter({ hasText: code });
    await expect(pr("VD-01").getByTestId("position-baseline")).toContainText("$4.5m");
    await expect(pr("VD-01").getByTestId("position-baseline-source")).toHaveText("Review #2");
    await expect(pr("VD-01").getByTestId("position-why-missing")).toBeVisible();
    await expect(page.getByRole("button", { name: "Finalise review" })).toBeDisabled();
    await positions(page, { "VD-01": { forecast: "4.6m", why: "Secondary supplier onboarded" } });
    await expect(page.getByTestId("review-gap")).toHaveText("$0.4m"); // V2 $9.0m − $8.6m
    await expect(page.getByTestId("leakage-VL-001")).toBeVisible(); // the matter continues across the Value Change
    await page.getByRole("button", { name: "Finalise review" }).click();
    await expect(page.getByTestId("review-state")).toContainText("Finalised");

    await tab(page, "Overview").click();
    await expect(page.getByTestId("overview-authorised-value")).toHaveText("$9.0m");
    await expect(page.getByTestId("overview-forecast")).toHaveText("$8.6m");
    await expect(page.getByTestId("overview-gap")).toHaveText("$0.4m");
    await expect(page.getByTestId("mobilisation-status")).toHaveCount(0);
    await tab(page, "Value Case").click();
    const evo = page.getByTestId("value-case-evolution");
    await expect(evo).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("value-case-evolution.png"), fullPage: true });
    await expect(evo.getByTestId("evolution-r1-forecast")).toHaveText("$9.0m");
    await expect(evo.getByTestId("evolution-r2-forecast")).toHaveText("$8.5m");
    await expect(evo.getByTestId("evolution-r3-forecast")).toHaveText("$8.6m");
    await expect(evo.getByTestId("evolution-r3-basis")).toContainText("Measured against V2");
    await navigationSweep(page); // post-V2
    // 4D.10B aliases resolve once to the canonical route, with the right tab active (no loop).
    const root = page.url().replace(/\/projects\/([0-9a-f-]{36}).*$/, "/projects/$1");
    for (const [alias, route, name] of [
      ["/mobilisation", "/setup", "Mobilisation"],
      ["/value-case-definition", "/requalification", "Value Case Definition"],
    ] as const) {
      await page.goto(root + alias);
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      await expect(tab(page, name)).toHaveAttribute("aria-current", "page");
    }
    await page.goto(matterUrl);
    await overviewEvidence(page, "09-review3-against-v2");
    await expect(page.getByTestId("formal-record")).toHaveCount(3);
  });
});
