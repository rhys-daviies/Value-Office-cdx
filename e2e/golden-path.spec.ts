import { expect, test, type Locator, type Page } from "@playwright/test";

// Phase 1 golden path, entirely through the consultant UI:
// create project → setup stakeholders/VCO → V0 → Information Request → evidence →
// draft V1 → edit drivers → propose → record VCO authorisation → Authorised V1.

const uid = Date.now().toString(36);

async function open(details: Locator) {
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open)))
    await details.locator("summary").first().click();
}

async function submit(form: Locator, button: string | RegExp, success: string | RegExp) {
  await form.getByRole("button", { name: button }).click();
  await expect(form.getByRole("status")).toContainText(success);
}

function tab(page: Page, name: string) {
  return page.getByRole("navigation", { name: "Project" }).getByRole("link", { name, exact: true });
}

test("consultant takes a project from creation to Authorised V1", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());

  // ---- Create project ------------------------------------------------------------
  await page.goto("/projects/new");
  const create = page.getByTestId("create-project-form");
  await create.getByLabel("Create a new client").check(); // 4D.10C: explicit existing / new client choice
  await create.getByLabel("New client name").fill(`Acme Utilities ${uid}`);
  await create.getByLabel("Project name").fill(`Golden Path ${uid}`);
  await create.getByLabel("Currency").fill("NZD");
  await create.getByLabel("Value Basis description").fill("Cumulative financial benefit over FY27–FY30");
  await create.getByLabel("Period start").fill("2026-07-01");
  await create.getByLabel("Period end").fill("2030-06-30");
  await create.getByLabel("Kick-off").fill("2026-10-05");
  await create.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByTestId("project-name")).toHaveText(`Golden Path ${uid}`);
  await expect(page.getByTestId("mobilisation-next")).toContainText("Nominate the Value Case Owner");

  // ---- Mobilisation: stakeholders, VCO, document reference --------------------------------
  await tab(page, "Mobilisation").click();
  const addStakeholder = page.getByTestId("add-stakeholder-form");
  await addStakeholder.getByLabel("Name").fill("Vera Owner");
  await addStakeholder.getByLabel("Title").fill("Chief Operating Officer");
  await addStakeholder.getByLabel("Organisation").fill("Acme Utilities");
  await addStakeholder.getByLabel("This person is the Value Case Owner").check();
  await submit(addStakeholder, "Add stakeholder", "Vera Owner added as Value Case Owner");
  await expect(page.getByTestId("vco-name")).toContainText("Vera Owner");

  await addStakeholder.getByLabel("Name").fill("Avery Accountable");
  await addStakeholder.getByLabel("Role on this project").fill("AVO — Service");
  await submit(addStakeholder, "Add stakeholder", "Avery Accountable added");
  await expect(page.getByTestId("stakeholder")).toHaveCount(2);

  await open(page.getByTestId("add-document"));
  const doc = page.getByTestId("add-document-form");
  await doc.getByLabel("Title").fill("Original Business Case v3.2");
  await doc.getByLabel("Source").fill("Provided by client PMO");
  await doc.getByLabel("Location / URL").fill("https://sharepoint.example/acme/bc-v3.2.pdf");
  await submit(doc, "Record document reference", "Document reference recorded");

  // ---- Capture the Original Business Case (V0) -----------------------------------------
  await tab(page, "Value Case").click();
  const v0 = page.getByTestId("create-v0-form");
  await v0.getByLabel("Stated total value").fill("18m");
  await v0.getByRole("button", { name: "Start capturing the Original Business Case" }).click(); // replaced by its card
  await expect(page.getByTestId("timeline-v0-total")).toHaveText("NZ$18.0m");
  await expect(page.getByTestId("timeline-v0")).toContainText("Original Business Case (being captured)");
  await page.getByRole("link", { name: "Open Original Business Case" }).click();
  await open(page.getByTestId("add-driver"));
  const v0Driver = page.getByTestId("add-driver-form");
  await v0Driver.getByLabel("Name").fill("Service Productivity");
  await v0Driver.getByRole("textbox", { name: /^Financial value/ }).fill("6,000,000");
  await submit(v0Driver, "Add driver", "Value Driver VD-01 added");
  await page.getByRole("button", { name: "Record the Original Business Case" }).click();
  await expect(page.getByText("Recorded — read-only")).toBeVisible();

  // ---- Information Request ---------------------------------------------------------
  await tab(page, "Information Requests").click();
  await page.getByTestId("create-ir-form").getByRole("button", { name: "Create Information Request" }).click();
  const item = page.getByTestId("add-ir-item-form");
  await item.getByLabel("Requested information").fill("Baseline effort per case, FY25");
  await item.getByLabel("Requested from").selectOption({ label: "Avery Accountable" });
  await item.getByLabel("Value Driver").selectOption({ label: "VD-01 Service Productivity" });
  await submit(item, "Add item", "Item added");
  await expect(page.getByTestId("ir-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Mark issued" }).click();
  await expect(page.getByText(/^Issued /)).toBeVisible();

  // ---- Evidence -----------------------------------------------------------------------
  await tab(page, "Evidence").click();
  const ev = page.getByTestId("record-evidence-form");
  await expect(ev.getByLabel("Code")).toHaveValue("E-001");
  await ev.getByLabel("Title").fill("Baseline effort study FY25");
  await ev.getByLabel("Document reference").selectOption({ label: "Original Business Case v3.2" });
  await submit(ev, "Record evidence", "Evidence E-001 recorded");
  await expect(page.getByTestId("evidence-row")).toHaveCount(1);

  // Mark the request item received and fulfilled by that evidence
  await tab(page, "Information Requests").click();
  const irItem = page.getByTestId("ir-item").first();
  await open(irItem);
  await irItem.getByLabel("Status").selectOption({ label: "Received" });
  await irItem.getByLabel("Fulfilled by evidence").selectOption({ label: "E-001 Baseline effort study FY25" });
  await irItem.getByRole("button", { name: "Save item" }).click();
  await expect(page.getByTestId("ir-item").first()).toContainText("Received");

  // ---- Value Case Definition: draft V1 ------------------------------------------------------
  await tab(page, "Value Case Definition").click();
  await page.getByTestId("create-v1-form").getByRole("button", { name: "Create draft V1" }).click();
  await expect(page.getByTestId("requal-state")).toContainText("Draft Value Case (V1) — editable");
  await expect(page.getByTestId("comparison-row")).toHaveCount(1); // VD-01 carried from V0

  // Re-qualify VD-01
  const vd01 = page.getByTestId("driver-VD-01");
  await open(vd01);
  const f = page.getByTestId("driver-form-VD-01");
  await f.getByLabel("Metric", { exact: true }).fill("effort units/case");
  await f.getByLabel("Baseline").fill("12.0");
  await f.getByLabel("Target").fill("7.0");
  await f.getByLabel("Economic calculation / rationale").fill("5 effort units × 960k cases × $1/unit over FY27–FY30");
  await f.getByRole("textbox", { name: /^Financial value/ }).fill("4.8m");
  await f.getByLabel("Accountable Value Owner").selectOption({ label: "Avery Accountable" });
  await f.getByLabel("Qualification status").selectOption({ label: "Partially qualified" });
  await f.getByLabel("Evidence status").selectOption({ label: "Partially evidenced" });
  await submit(f, "Save driver", "Value Driver saved");

  // Assumption + evidence link on VD-01
  await open(vd01.getByTestId("add-assumption"));
  await vd01.getByTestId("add-assumption").getByLabel("Assumption").fill("Case volumes remain within ±5% of FY25");
  await vd01.getByTestId("add-assumption").getByRole("button", { name: "Add assumption" }).click();
  await expect(vd01.getByTestId("assumption")).toHaveCount(1);
  const driverLinks = vd01.locator("h4", { hasText: "Linked evidence" }).locator("..");
  await driverLinks.getByLabel("Link evidence").selectOption({ label: "E-001 Baseline effort study FY25" });
  await driverLinks.getByRole("button", { name: "Link", exact: true }).click();
  await expect(driverLinks).toContainText("E-001 Baseline effort study FY25");

  // Add a non-financial driver (PMO decision: null value, excluded from total)
  await open(page.getByTestId("add-driver"));
  const add = page.getByTestId("add-driver-form");
  await expect(add.getByLabel("Code")).toHaveValue("VD-02");
  await add.getByLabel("Name").fill("Customer Experience");
  await add.getByLabel("Non-financial outcome").check();
  await submit(add, "Add driver", "Value Driver VD-02 added");

  // A negative driver is allowed
  await add.getByLabel("Name").fill("Transition dis-benefit");
  await add.getByRole("textbox", { name: /^Financial value/ }).fill("-0.3m");
  await submit(add, "Add driver", "Value Driver VD-03 added");

  await expect(page.getByTestId("requal-v1-total")).toHaveText("NZ$4.5m");
  await expect(page.getByTestId("requal-inherited-total")).toHaveText("NZ$18.0m");
  await expect(page.getByTestId("requal-change")).toHaveText("-NZ$13.5m");
  await expect(page.getByTestId("comparison-row")).toHaveCount(3);
  await expect(page.getByTestId("requal-v1-total").locator("..")).toContainText("Non-financial");
  await expect(page.getByTestId("count-partially_qualified")).toContainText("1");
  await expect(page.getByTestId("count-unqualified")).toContainText("2");

  // ---- Propose V1 -------------------------------------------------------------------
  await page.getByRole("button", { name: "Propose V1" }).click();
  await expect(page.getByTestId("requal-state")).toContainText("Proposed Value Case (V1) — locked");
  await expect(page.getByRole("button", { name: "Save driver" })).toHaveCount(0);

  // ---- Record VCO authorisation --------------------------------------------------------
  await expect(page.getByTestId("authorisation-statement")).toContainText("e2e.consultant@cardaxia.ai");
  await expect(page.getByTestId("authoriser-name")).toHaveText("Vera Owner");
  const authEvidence = page.getByTestId("authorisation-evidence-form");
  await expect(authEvidence.getByLabel("Code")).toHaveValue("E-002");
  await authEvidence.getByLabel("Summary").fill("Signed Value Case authorisation notice");
  await submit(authEvidence, "Record evidence", "Evidence E-002 recorded");

  const authorise = page.getByTestId("authorise-form");
  await authorise.getByLabel("Authorisation evidence").selectOption({ label: "E-002 VCO authorisation of V1" });
  await authorise.getByLabel("Note").fill("Approved at steering committee");
  await authorise.getByRole("button", { name: /Record authorisation/ }).click();

  // ---- Authorised V1 ------------------------------------------------------------------
  await expect(page.getByTestId("requal-state")).toContainText("Authorised Value Case V1 — read-only");
  await expect(page.getByRole("button", { name: /Save driver|Add driver|Propose V1|Return to draft/ })).toHaveCount(0);

  await tab(page, "Value Case").click();
  await expect(page.getByTestId("timeline-v1")).toContainText("Authorised Value Case V1");
  await expect(page.getByTestId("timeline-v1-total")).toHaveText("NZ$4.5m");
  await page.getByRole("link", { name: "Open V1" }).click();
  const auth = page.getByTestId("authorisation-details");
  await expect(auth).toContainText("Vera Owner");
  await expect(auth).toContainText("E-002 VCO authorisation of V1");
  await expect(auth).toContainText("e2e.consultant@cardaxia.ai");
  await expect(page.getByTestId("version-driver-row")).toHaveCount(3);

  // V0 remains historically accessible and unchanged
  await page.goto(page.url().replace(/\/v\/1$/, "/v/0"));
  await expect(page.getByTestId("version-total")).toHaveText("NZ$18.0m");
  await expect(page.getByText("Recorded — read-only")).toBeVisible();

  // Overview reflects the authorised state
  await tab(page, "Overview").click();
  await expect(page.getByTestId("overview-authorised-value")).toHaveText("NZ$4.5m");
  await expect(page.getByTestId("overview-formal-position")).toHaveText("No formal Assurance position yet.");
  await expect(page.getByTestId("overview-value-case")).toHaveCount(0); // the V0 → V1 baseline no longer competes

  // History shows the attributed commands
  await tab(page, "History").click();
  const history = page.getByTestId("history");
  await expect(history).toContainText("VCO authorisation recorded");
  await expect(history).toContainText("Value Case proposed for authorisation");
  await expect(history).toContainText("Original Business Case recorded");
  await expect(history).toContainText("E2E Consultant");
});
