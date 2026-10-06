import { expect, test, type Locator, type Page } from "@playwright/test";

// Phase 4D.13 operational readiness on the synthetic "Office Compact" project (Authorised V1; stakeholder Test VCO,
// role Value Case Owner). The test creates its own request item and evidence and asserts only on those, so it does
// not depend on what other specs did to the project.

async function submit(form: Locator, button: string, success: string | RegExp) {
  await form.getByRole("button", { name: button }).click();
  await expect(form.getByRole("status")).toContainText(success);
}

async function openTab(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Project" }).getByRole("link", { name, exact: true }).click();
}

test("IR outstanding queue, evidence needing classification, Overview signals, working-assumption help", async ({
  page,
}) => {
  page.on("dialog", (d) => void d.accept()); // "Issue this Information Request to the client?"
  const stamp = Date.now().toString(36);
  await page.goto("/projects");
  await page.getByRole("link", { name: "Office Compact" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  const overview = page.url();

  // An issued request item whose due date has passed is an overdue item in the working queue: person — role shown.
  await openTab(page, "Information Requests");
  const create = page.getByTestId("create-ir-form");
  if (await create.isVisible()) {
    await create.getByRole("button", { name: "Create Information Request" }).click();
  } else {
    await page.getByTestId("new-ir").locator("summary").click();
    await page.getByTestId("new-ir-form").getByRole("button", { name: "Create Information Request" }).click();
  }
  // The new (empty) request's add-item form is the one open; earlier requests' forms stay collapsed.
  const addItem = page.getByTestId("add-ir-item-form").filter({ visible: true });
  await expect(addItem).toHaveCount(1);
  await addItem.getByLabel("Requested information").fill(`Overdue schedule ${stamp}`);
  await addItem.getByLabel("Requested from").selectOption({ label: "Test VCO — Value Case Owner" });
  await addItem.getByLabel("Due").fill("2026-01-15");
  await submit(addItem, "Add item", "Item added");
  await page
    .locator("section")
    .filter({ has: page.getByText(`Overdue schedule ${stamp}`) })
    .getByRole("button", { name: "Mark issued" })
    .click();
  const row = page.getByTestId("ir-outstanding-row").filter({ hasText: `Overdue schedule ${stamp}` });
  await expect(row).toHaveAttribute("data-due", "overdue");
  await expect(row).toContainText("Overdue");
  await expect(row).toContainText("Test VCO — Value Case Owner");

  // Evidence with no relationship is flagged and filterable; evidence that authorised V1 (E-001) is classified.
  await openTab(page, "Evidence");
  const record = page.getByTestId("record-evidence-form");
  await record.getByLabel("Title").fill(`Loose note ${stamp}`);
  await submit(record, "Record evidence", /Evidence recorded|recorded/);
  const loose = page.getByTestId("evidence-row").filter({ hasText: `Loose note ${stamp}` });
  await expect(loose.getByTestId("evidence-needs-classification")).toBeVisible();
  await page
    .getByTestId("evidence-filter")
    .getByRole("link", { name: /Needs classification/ })
    .click();
  await expect(page).toHaveURL(/show=needs-classification/);
  await expect(loose).toBeVisible();
  const rows = page.getByTestId("evidence-row");
  await expect(rows.filter({ hasNot: page.getByTestId("evidence-needs-classification") })).toHaveCount(0);
  await expect(rows.filter({ hasText: "E-001" })).toHaveCount(0);

  // Overview: two small signals linking to where the work is done.
  await page.goto(overview);
  const signals = page.getByTestId("attention-operational");
  await expect(signals.getByTestId("attention-overdue-requests")).toContainText(/overdue request item/);
  await expect(signals.getByTestId("attention-unclassified-evidence")).toContainText(/classification/);
  await signals.getByRole("link", { name: /classification/ }).click();
  await expect(page).toHaveURL(/\/evidence\?show=needs-classification/);

  // Working assumptions are explained where they are recorded.
  await openTab(page, "Value Drivers");
  await page.getByRole("link", { name: /VD-01/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: /VD-01/ })).toBeVisible();
  const start = page.getByRole("button", { name: "Start working record from V1" });
  if (await start.isVisible()) await start.click(); // working assumptions live on the working record
  await expect(page.getByTestId("driver-assumptions-help")).toContainText(
    "They become the governed Assumptions when the driver is next included in a Value Change.",
  );
});
