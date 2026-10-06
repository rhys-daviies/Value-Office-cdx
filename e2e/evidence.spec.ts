import { expect, test, type Locator, type Page } from "@playwright/test";

// Phase 4D.2: evidence in everyday Continuous Assurance, on the synthetic "Evidence Compact" project
// (Authorised V1: VD-01 $1.0m, VD-02 $0.5m, VD-03 non-financial; one stakeholder, Test VCO).

async function submit(form: Locator, button: string, success: string | RegExp) {
  await form.getByRole("button", { name: button }).click();
  await expect(form.getByRole("status")).toContainText(success);
}

async function openAssurance(page: Page) {
  await page.goto("/projects");
  await page.getByRole("link", { name: "Evidence Compact" }).click();
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name: "Assurance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Continuous Assurance" })).toBeVisible();
}

async function setStage(page: Page, label: string) {
  const form = page.getByTestId("stage-form");
  await form.getByLabel("Working stage").selectOption({ label });
  await submit(form, "Set stage", "Working stage updated");
  await expect(page.getByTestId("matter-header")).toContainText(label);
}

test("matter → request evidence → document and fulfil → stage stays → deliberate review reliance locks it", async ({
  page,
}) => {
  page.on("dialog", (d) => void d.accept());
  await openAssurance(page);

  await page.getByTestId("create-matter").locator("summary").click();
  const create = page.getByTestId("create-matter-form");
  await create.getByLabel("Code").fill("VL-301");
  await create.getByLabel("Issue").fill("Vendor deployment delay");
  await create.getByLabel("VD-01").check();
  await create.getByRole("button", { name: "Raise matter" }).click();
  await page.waitForURL(/\/assurance\/matters\/[0-9a-f-]{36}$/);
  const matterUrl = page.url();
  await expect(page.getByTestId("matter-next-step")).toContainText("Document evidence you already hold");
  await setStage(page, "Awaiting evidence");

  // What evidence do we still need? Request it on a new Assurance Information Request.
  await page.getByTestId("request-evidence").locator("summary").click();
  const request = page.getByTestId("request-evidence-form");
  await request.getByLabel("Evidence required").fill("Revised vendor implementation schedule");
  await request.getByLabel("Requested from").selectOption({ label: "Test VCO — Value Case Owner" }); // 4D.13: person — role
  await request.getByLabel("Due").fill("2026-10-05");
  await request.getByLabel("Value Driver").selectOption({ index: 1 }); // VD-01 (affected) listed first
  await expect(request.getByLabel("Add to Assurance Information Request")).toHaveValue("new");
  await submit(request, "Request evidence", "Evidence requested (item #1)");
  const item = page.getByTestId("matter-request");
  await expect(item).toContainText("IR-01 #1");
  await expect(item).toContainText("Open");
  await expect(item).toContainText("Requested from Test VCO — Value Case Owner");
  await expect(item).toContainText("Value Driver VD-01");
  await expect(page.getByTestId("matter-next-step")).toContainText("1 evidence request(s) outstanding");

  // The evidence arrives: document it against the matter, then fulfil the request with it.
  await page.getByTestId("document-evidence").locator("summary").click();
  const doc = page.getByTestId("document-evidence-form");
  await doc.getByLabel("Code").fill("E-301");
  await doc.getByLabel("Title").fill("Revised vendor schedule v2");
  await doc.getByLabel("Also relates to Value Driver (working link)").selectOption({ index: 1 });
  await submit(doc, "Record and link evidence", "Evidence E-301 recorded and linked to this matter");
  const row = page.getByTestId("matter-evidence-row").filter({ hasText: "E-301" });
  await expect(row).toContainText("Working link");
  await expect(row).not.toContainText("Locked");

  const fulfil = item.getByTestId("fulfil-item-form");
  await fulfil.getByLabel("Status").selectOption({ label: "Received" });
  await fulfil.getByLabel("Fulfilled by evidence").selectOption({ label: "E-301 Revised vendor schedule v2" });
  await submit(fulfil, "Update request", "Request item updated");
  await expect(item.getByTestId("request-fulfilled-by")).toContainText("E-301 Revised vendor schedule v2");
  await expect(item).toContainText("Received");

  // Evidence arriving does not move the stage or size the matter — the consultant does.
  await expect(page.getByTestId("matter-header")).toContainText("Awaiting evidence");
  await expect(page.getByTestId("working-assessment")).toContainText("Not yet quantified");
  await expect(page.getByTestId("matter-next-step")).toContainText("move the stage to Assessing");
  await setStage(page, "Assessing");

  // The Information Request page now lists the Assurance request.
  await page.getByRole("link", { name: "IR-01 #1" }).click();
  await expect(page.getByTestId("ir-index-row")).toContainText("Assurance");

  // Formal review: matter evidence is offered, not adopted.
  await openAssurance(page);
  const open = page.getByTestId("create-review-form");
  await open.getByLabel("Why is this review happening?").selectOption({ label: "Ad hoc" });
  await open.getByRole("button", { name: "Open review" }).click();
  await expect(page.getByTestId("review-state")).toContainText("Assurance Review #1");
  await expect(page.getByText("Evidence relied on in this review (0)")).toBeVisible();
  const candidate = page.getByTestId("matter-evidence-candidate").filter({ hasText: "E-301" });
  await expect(candidate).toContainText("matter VL-301");
  await candidate.getByRole("button", { name: "Rely on in this review" }).click();
  await expect(page.getByText("Evidence relied on in this review (1)")).toBeVisible();
  await expect(page.getByTestId("matter-evidence-candidates")).toHaveCount(0);

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

  // Formal reliance now locks the evidence…
  await page.getByRole("link", { name: "E-301 Revised vendor schedule v2" }).first().click();
  await expect(page.getByText("Locked — formally relied on")).toBeVisible();
  await expect(page.getByTestId("formal-reliance")).toContainText("Assurance Review #1");
  await expect(page.getByTestId("working-links")).toContainText("VL-301");
  await expect(page.getByTestId("working-links")).toContainText("Value Driver VD-01");

  // …while the living matter keeps its own lifecycle.
  await page.goto(matterUrl);
  await expect(page.getByTestId("matter-evidence-row").filter({ hasText: "E-301" })).toContainText(
    "Locked by formal reliance elsewhere",
  );
  await setStage(page, "Remediation underway");
});
