import { expect, test, type Page } from "@playwright/test";

// Phase 4D.4: the daily Value Office, on the synthetic "Office Compact" project (Authorised V1 $1.5m;
// Review #1 forecast $1.4m; VL-101 escalated, $0.3m working; VL-102 awaiting evidence, unquantified,
// with working evidence E-003 and an open request; VD-04 emerging, $0.2m working estimate).
// This journey checks the information architecture, not the domain commands (covered elsewhere).

function nav(page: Page) {
  return page.getByRole("navigation", { name: "Project" });
}
const tab = (page: Page, name: string) => nav(page).getByRole("link", { name, exact: true });

test("daily Value Office: overview → assurance → matter → formal → drivers → value case → evidence → more", async ({
  page,
}) => {
  await page.goto("/projects");
  await page.getByRole("link", { name: "Office Compact" }).click();

  // Consultant navigation (4D.10B): lifecycle, cross-lifecycle, utility. Value Changes are reached in context.
  const groups = {
    "nav-lifecycle": ["Overview", "Mobilisation", "Value Case Definition", "Value Case", "Assurance"],
    "nav-cross-lifecycle": ["Evidence", "Information Requests"],
    "nav-utility": ["Value Drivers", "Reports", "History"],
  };
  for (const [testId, names] of Object.entries(groups)) {
    const group = page.getByTestId(testId);
    await expect(group.getByRole("link")).toHaveText(names);
  }
  await expect(page.getByTestId("nav-cross-lifecycle")).toContainText("Across the lifecycle");
  await expect(tab(page, "Value Changes")).toHaveCount(0);
  for (const old of ["Setup", "Re-Qualification"]) await expect(tab(page, old)).toHaveCount(0);

  // Overview (4D.9I): the governed position, then ONE matter requiring attention (working figures labelled).
  await expect(page.getByTestId("overview-authorised-value")).toHaveText("$1.5m");
  await expect(page.getByTestId("overview-forecast")).toHaveText("$1.4m");
  await expect(page.getByTestId("overview-gap")).toHaveText("$0.1m");
  await expect(page.getByTestId("working-picture")).toHaveCount(0); // the working detail lives in Assurance
  const attention = page.getByTestId("overview-attention");
  await expect(attention).toContainText("VL-101");
  await expect(attention.getByTestId("attention-conditions")).toContainText("Escalated — decision required");
  await expect(attention).toContainText("Working · not formally reviewed");
  await expect(attention.getByTestId("attention-leakage")).toContainText("$300,000");
  await expect(attention.getByTestId("attention-summary")).toContainText(
    "2 active Assurance matters · 2 need attention",
  );

  // Assurance: Continuous (working) and Formal (governed) are distinct areas.
  await tab(page, "Assurance").click();
  const continuous = page.getByTestId("continuous-assurance");
  const formal = page.getByTestId("formal-assurance");
  await expect(continuous).toContainText("Live · working");
  await expect(formal).toContainText("Governed snapshots and recommitment points");
  await expect(continuous.getByTestId("matter-row")).toHaveCount(2);
  await expect(formal.getByTestId("review-row")).toHaveCount(1);
  await expect(continuous.getByTestId("review-row")).toHaveCount(0);

  // The primary call to action lands on the raise-matter form already open (Phase 4D.8A release fix).
  await continuous.getByRole("link", { name: "+ Raise Assurance Matter" }).click();
  await expect(page).toHaveURL(/raise=1#raise-matter$/);
  await expect(continuous.getByTestId("create-matter-form")).toBeVisible();

  await page
    .getByTestId("matter-filters")
    .getByRole("link", { name: /Awaiting evidence/ })
    .click();
  await expect(page).toHaveURL(/stage=awaiting_evidence/);
  const row = continuous.getByTestId("matter-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("VL-102");
  await expect(row.getByTestId("working-amount")).toHaveText("Not yet quantified");
  await expect(row.getByTestId("matter-evidence-state")).toContainText("1 supporting");
  await expect(row.getByTestId("matter-evidence-state")).toContainText("Evidence requested · 1 item outstanding");
  await expect(row.getByTestId("matter-attention")).toContainText("No Risk / Leakage Owner");
  await page
    .getByTestId("matter-filters")
    .getByRole("link", { name: /Escalated/ })
    .click();
  await expect(continuous.getByTestId("matter-row")).toContainText("VL-101");

  // Open a matter: working assessment, evidence and remediation in one place.
  await page
    .getByTestId("matter-filters")
    .getByRole("link", { name: /Awaiting evidence/ })
    .click();
  await continuous.getByRole("link", { name: /VL-102/ }).click();
  await expect(page.getByTestId("matter-header")).toContainText("Awaiting evidence");
  await expect(page.getByTestId("matter-evidence-row")).toContainText("E-003");
  await expect(page.getByTestId("matter-request")).toContainText("Supplier capacity plan");
  await expect(page.getByRole("heading", { name: "Working assessment — not formally reviewed" })).toBeVisible();
  await expect(page.getByTestId("remediation-form")).toBeVisible();

  // Formal Assurance remains separate.
  await tab(page, "Assurance").click();
  await expect(formal.getByTestId("formal-forecast")).toHaveText("$1.4m");
  await expect(formal.getByTestId("formal-gap")).toHaveText("$0.1m");

  // Value Drivers: authorised vs emerging, never confused.
  await tab(page, "Value Drivers").click();
  await expect(page.getByTestId("driver-row-VD-01").getByTestId("driver-status")).toHaveText("In Value Case V1");
  const vd04 = page.getByTestId("driver-row-VD-04");
  await expect(vd04.getByTestId("driver-status")).toHaveText("Emerging");
  await expect(vd04.getByTestId("working-estimate")).toContainText("working · not authorised");
  await expect(vd04.getByTestId("authorised-value")).toHaveText("—");
  await expect(page.getByTestId("authorised-total")).toHaveText("$1.5m");

  // Value Case: the governed commitment dominates.
  await tab(page, "Value Case").click();
  const commitment = page.getByTestId("current-commitment");
  await expect(commitment).toContainText("Current Authorised Value Case");
  await expect(commitment).toContainText("Authorised V1");
  await expect(page.getByTestId("commitment-total")).toHaveText("$1.5m");
  await expect(page.getByTestId("commitment-authorisation")).toContainText("Test VCO (VCO)");
  await expect(page.getByTestId("commitment-driver-VD-01")).toContainText("$0.9m"); // latest formal forecast
  await expect(commitment).not.toContainText("VD-04");

  // Evidence: formal reliance and working links in separate columns.
  await tab(page, "Evidence").click();
  const e001 = page.getByTestId("evidence-row").filter({ hasText: "E-001" });
  await expect(e001.getByTestId("evidence-formal")).toContainText("Authorises V1");
  const e003 = page.getByTestId("evidence-row").filter({ hasText: "E-003" });
  await expect(e003.getByTestId("evidence-use")).toContainText("Matter VL-102 (working)");
  await expect(e003.getByTestId("evidence-formal")).toHaveText("—");

  // Value Changes from the Value Case page (no longer a navigation destination).
  await tab(page, "Value Case").click();
  await page.getByTestId("value-case-changes-link").getByRole("link", { name: "Open Value Changes" }).click();
  await expect(page).toHaveURL(/\/changes$/);

  // The rest of the lifecycle and the utilities.
  await tab(page, "Value Case Definition").click();
  await expect(page).toHaveURL(/\/requalification$/);
  await expect(page.getByTestId("requal-role")).toContainText("For ongoing Value Driver assessment, use Value Drivers");
  await tab(page, "Mobilisation").click();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page).toHaveTitle(/Mobilisation/);
  await tab(page, "History").click();
  await expect(page).toHaveURL(/\/history$/);
  // Consultant aliases (4D.10B) land on the existing pages.
  const project = page.url().replace(/\/history$/, "");
  await page.goto(`${project}/mobilisation`);
  await expect(page).toHaveURL(/\/setup$/);
  await page.goto(`${project}/value-case-definition`);
  await expect(page).toHaveURL(/\/requalification$/);
  await tab(page, "Information Requests").click();
  await expect(page.getByTestId("ir-index-row")).toContainText("Assurance");
});
