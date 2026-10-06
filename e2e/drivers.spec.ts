import { expect, test, type Locator, type Page } from "@playwright/test";

// Phase 4D.3: living and emerging Value Drivers on the synthetic "Drivers Compact" project
// (Authorised V1: VD-01 $1.0m, VD-02 $0.5m, VD-03 non-financial = $1.5m; Review #1 finalised with
// forecasts $0.9m / $0.5m and a recorded client decision; one stakeholder, Test VCO).

function tab(page: Page, name: string) {
  return page.getByRole("navigation", { name: "Project" }).getByRole("link", { name, exact: true });
}
async function submit(form: Locator, button: string | RegExp, success: string | RegExp) {
  await form.getByRole("button", { name: button }).click();
  await expect(form.getByRole("status")).toContainText(success);
}

test("living driver edits leave V1 alone; an emerging driver joins V2 only through an authorised Value Change", async ({
  page,
}) => {
  page.on("dialog", (d) => void d.accept());
  await page.goto("/projects");
  await page.getByRole("link", { name: "Drivers Compact" }).click();
  await tab(page, "Value Drivers").click();
  await expect(page.getByTestId("authorised-total")).toHaveText("$1.5m");

  // Existing authorised driver: governed reading, then a living record that evolves separately.
  const vd01 = page.getByTestId("driver-row-VD-01");
  await expect(vd01).toContainText("In Value Case V1");
  await expect(vd01).toContainText("As in V1 — no working changes yet");
  await expect(vd01.getByTestId("authorised-value")).toContainText("$1.0m");
  await expect(vd01).toContainText("$0.9m");
  await vd01.getByRole("link").first().click();
  await expect(page.getByTestId("history-V1")).toContainText("$1.0m");
  await page
    .getByTestId("initialise-record-form")
    .getByRole("button", { name: "Start working record from V1" })
    .click();
  await expect(page.getByTestId("working-driver")).toBeVisible(); // the start form is replaced
  const avo = page.getByTestId("driver-avo-form");
  await avo.getByLabel("Working AVO").selectOption({ label: "Test VCO — Value Case Owner" }); // 4D.13: person — role
  await submit(avo, "Save AVO", "Working AVO updated");
  await expect(page.getByTestId("working-avo")).toHaveText("Test VCO — Value Case Owner");
  const estimate = page.getByTestId("driver-estimate-form");
  await estimate.getByLabel("Working estimate (not authorised)").fill("0.8m");
  await submit(estimate, "Save working estimate", "Working estimate recorded");
  await expect(page.getByTestId("driver-readings").getByTestId("working-estimate")).toContainText("$0.8m");
  await expect(page.getByTestId("driver-readings").getByTestId("authorised-value")).toContainText("$1.0m");
  await expect(page.getByTestId("history-V1")).toContainText("$1.0m"); // V1 unchanged
  await expect(page.getByTestId("history-V1")).not.toContainText("Test VCO"); // V1 had no AVO

  // A new, emerging driver identified during Assurance.
  await tab(page, "Value Drivers").click();
  await page.getByTestId("add-driver").locator("summary").click();
  const add = page.getByTestId("add-driver-form");
  await expect(add.getByLabel("Code")).toHaveValue("VD-04");
  await add.getByLabel("Name").fill("Automation Opportunity");
  await add.getByLabel("Qualification").selectOption({ label: "Partially qualified" });
  await add.getByLabel("Working estimate (not authorised)").fill("0.3m");
  await add.getByRole("button", { name: "Add emerging Value Driver" }).click();
  await page.waitForURL(/\/value-drivers\/[0-9a-f-]{36}$/);
  const header = page.getByTestId("driver-header");
  await expect(header).toContainText("VD-04 Automation Opportunity");
  await expect(header).toContainText("Emerging");
  const readings = page.getByTestId("driver-readings");
  await expect(readings.getByTestId("working-estimate")).toContainText("$0.3m");
  await expect(readings.getByTestId("working-estimate")).toContainText("working · not authorised");
  await expect(readings.getByTestId("authorised-value")).toHaveText("—");
  await expect(readings).toContainText("Not in current Value Case");
  await expect(page.getByText("Not yet in any Value Case version — this driver is emerging.")).toBeVisible();
  const link = page.getByTestId("driver-link-evidence-form");
  await link.getByLabel("Link existing evidence").selectOption({ label: "E-002 Quarterly benefits report" });
  await submit(link, "Link", "Working link to Value Driver added");
  await expect(page.getByTestId("driver-working-evidence")).toContainText("E-002");

  await tab(page, "Value Drivers").click();
  await expect(page.getByTestId("authorised-total")).toHaveText("$1.5m"); // the estimate is not authorised
  await expect(page.getByTestId("driver-row-VD-04")).toContainText("Emerging");

  // Governance: a Value Change from the recorded decision, including the emerging driver.
  await tab(page, "Assurance").click();
  await page
    .getByRole("link", { name: /Review #1/ })
    .first()
    .click();
  // 4D.10H: the decision's Value Case impact is determined explicitly before a Value Change is prepared.
  const det = page.getByTestId("determination-form");
  await det.getByLabel("Value Change Proposed").check();
  await det.getByLabel("Rationale").fill("The automation opportunity changes the authorised commitment");
  await det.getByRole("button", { name: "Record determination" }).click();
  await expect(page.getByTestId("determination")).toContainText("Value Change Proposed");
  const vc = page.getByTestId("create-change-form");
  await vc.getByLabel("Stated change to Authorised Value").fill("0.3m");
  await vc.getByLabel("Reason").fill("Automation opportunity identified in Assurance");
  await vc.getByRole("button", { name: "Prepare Value Change" }).click();
  await expect(page.getByTestId("change-state")).toContainText("VC-001");
  await expect(page.getByText("Not reconciled")).toBeVisible();
  const includable = page.getByTestId("includable-drivers");
  await expect(includable).toContainText(
    "This adds the driver to the proposed Value Case only. It does not alter the current Authorised Value Case.",
  );
  const vd04 = page.getByTestId("includable-driver").filter({ hasText: "VD-04" });
  await vd04.getByRole("button", { name: "Include in proposed Value Case" }).click();
  await expect(page.getByTestId("change-driver-row").filter({ hasText: "VD-04" })).toContainText("New");
  await expect(page.getByText("Reconciled: the proposed drivers deliver the stated change.")).toBeVisible();
  await expect(page.getByTestId("change-to-total")).toHaveText("$1.8m");

  await page.getByRole("button", { name: "Propose VC-001" }).click();
  await expect(page.getByTestId("change-state")).toContainText("proposed");
  const ev = page.getByTestId("change-evidence-form");
  await ev.getByRole("button", { name: "Record evidence" }).click();
  await expect(ev.getByRole("status")).toContainText(/Evidence E-\d+ recorded/);
  const auth = page.getByTestId("authorise-change-form");
  await auth.getByLabel("Authorisation evidence").selectOption({ label: "E-003 VCO authorisation of VC-001" });
  await auth.getByRole("button", { name: /Record authorisation/ }).click();
  await expect(page.getByTestId("change-state")).toContainText("authorised");

  // V2 contains VD-04; V1 never did.
  await tab(page, "Value Drivers").click();
  await expect(page.getByTestId("authorised-total")).toHaveText("$1.8m");
  const row = page.getByTestId("driver-row-VD-04");
  await expect(row).toContainText("In Value Case V2");
  await expect(row.getByTestId("authorised-value")).toContainText("$0.3m");
  await row.getByRole("link").first().click();
  await expect(page.getByTestId("history-V2")).toContainText("$0.3m");
  await expect(page.getByTestId("history-V1")).toHaveCount(0);
  await tab(page, "Value Case").click();
  await expect(page.getByTestId("timeline-v1-total")).toHaveText("$1.5m");
  await expect(page.getByTestId("timeline-v2-total")).toHaveText("$1.8m");
});
