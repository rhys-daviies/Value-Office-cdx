import { expect, test, type Page } from "@playwright/test";

// Phase 4A: client outputs generated from the governed Value Record (Horizon acceptance).

async function openReports(page: Page) {
  await page.goto("/projects");
  await page.getByRole("link", { name: "Project Horizon" }).click();
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Available reports" })).toBeVisible();
}

async function preview(page: Page, report: string) {
  await openReports(page);
  await page.getByTestId("available-report").filter({ hasText: report }).getByRole("link", { name: "Preview" }).click();
  await expect(page.getByTestId("report-draft-banner")).toBeVisible();
}

test("Horizon Re-Qualification Report preview: $18.0m → $15.5m, −$2.5m, six drivers", async ({ page }) => {
  await preview(page, "Re-Qualification Report");
  const report = page.getByTestId("report-preview");
  await expect(report.getByRole("heading", { name: "Re-Qualification Report" })).toBeVisible();
  await expect(page.getByTestId("rq-inherited")).toContainText("$18.0m");
  await expect(page.getByTestId("rq-authorised")).toContainText("Authorised Value");
  await expect(page.getByTestId("rq-authorised")).toContainText("$15.5m");
  await expect(page.getByTestId("rq-movement")).toContainText("-$2.5m");
  await expect(page.getByTestId("rq-driver-count")).toContainText("6");
  await expect(page.getByTestId("rq-drivers").locator("tbody tr")).toHaveCount(6);
  await expect(page.getByTestId("rq-authorisation")).toContainText("[FIXTURE PLACEHOLDER] Value Case Owner");
  await expect(page.getByTestId("report-status")).toHaveText("Authorised");
});

test("Horizon Value Assurance Report preview: position, unattributed realised, leakage, options, decision", async ({
  page,
}) => {
  await preview(page, "Value Assurance Report");
  // Model v3 (4D.9J) executive position, as at the review.
  await expect(page.getByTestId("rpt-formal-position")).toContainText("Formal position as at");
  await expect(page.getByTestId("rpt-exec-authorised")).toContainText("$15.5m");
  await expect(page.getByTestId("rpt-exec-forecast")).toContainText("$14.7m");
  await expect(page.getByTestId("rpt-exec-gap")).toContainText("$0.8m");
  await expect(page.getByTestId("as-drivers").locator("tfoot")).toContainText("-$800,000"); // movement kept
  await expect(page.getByTestId("rpt-exec-realised")).toContainText("$2.8m");
  // $2.8m is clearly unattributed, not allocated to drivers.
  await expect(page.getByTestId("rpt-exec-realised")).toContainText("All recorded as unattributed (project level)");
  await expect(page.getByTestId("as-unattributed-note")).toContainText("$2,800,000");
  await expect(page.getByTestId("as-unattributed-note")).toContainText("not attributed to any Value Driver");
  await expect(page.getByTestId("as-unattributed-row")).toContainText("$2,800,000");

  // Value Leakage: separate from Value Gap and not yet quantified — no $0, no prototype figures.
  await expect(page.getByTestId("rpt-story")).toContainText("it is not the Value Gap");
  await expect(page.getByTestId("rpt-story-leakage")).toContainText("Value Leakage not yet quantified in this review");
  const vl = page.getByTestId("as-leakage-row").filter({ hasText: "VL-001" });
  await expect(vl).toContainText("Vendor sequencing");
  await expect(vl.getByTestId("as-leakage-unquantified")).toHaveText("Not yet quantified");
  await expect(vl).not.toContainText("$0");
  await expect(page.getByTestId("report-preview")).not.toContainText("0.70");

  // Options, recommendation and decision stay separate (unclassified basis: the Alternative Value Outcomes table).
  const options = page.getByTestId("as-outcomes-table");
  await expect(options).toContainText("$14.7m");
  await expect(options).toContainText("$15.3m");
  await expect(options).toContainText("$14.9m");
  await expect(page.getByTestId("as-recommendation")).toContainText("$15.3m");
  await expect(page.getByTestId("as-decision")).toContainText("$14.9m");
  await expect(page.getByTestId("as-client-difference")).toContainText("-$0.4m");
  await expect(page.getByTestId("as-value-change")).toContainText("VC-002");
  await expect(page.getByTestId("as-value-change")).toContainText("Stated change -$600k · current draft movement");
  await expect(page.getByTestId("as-value-change")).toContainText("does not reconcile");
  await expect(page.getByTestId("as-value-change")).toContainText("Proposed — not in force");
});

test("Horizon VC-002 Notice: PROPOSED, NOT RECONCILED, NOT READY FOR AUTHORISATION", async ({ page }) => {
  await preview(page, "Value Change Notice");
  const stamps = page.getByTestId("vc-stamps");
  await expect(stamps).toContainText("Proposed");
  await expect(stamps).toContainText("Not reconciled");
  await expect(stamps).toContainText("Not ready for authorisation");
  await expect(page.getByTestId("vc-not-ready")).toBeVisible();
  await expect(page.getByTestId("vc-current")).toContainText("$15.5m");
  await expect(page.getByTestId("vc-stated")).toContainText("-$600k"); // 4D.9J adaptive change precision
  await expect(page.getByTestId("vc-proposed")).toContainText("$14.9m");
  await expect(page.getByTestId("vc-reconciled")).toHaveText("NOT RECONCILED");
  await expect(page.getByTestId("vc-readiness")).toContainText("NOT READY FOR AUTHORISATION");
  await expect(page.getByTestId("vc-no-driver-changes")).toBeVisible(); // no fabricated allocation
  await expect(page.getByTestId("report-status")).toHaveText("Proposed — awaiting VCO authorisation");
});

test("issue the Horizon Value Assurance Report: confirmation, immutable issue record, PDF", async ({ page }) => {
  await preview(page, "Value Assurance Report");
  const form = page.getByTestId("issue-report-form");

  // Confirmation is required.
  page.once("dialog", (d) => d.accept());
  await form.getByRole("button", { name: "Issue report" }).click();
  await expect(form.getByText("Confirm that you have reviewed the report before issuing it")).toBeVisible();

  await form.getByLabel("I have reviewed this report and it is ready to issue to the client").check();
  page.once("dialog", (d) => d.accept());
  await form.getByRole("button", { name: "Issue report" }).click();
  await page.waitForURL(/\/reports\/issued\/[0-9a-f-]{36}$/, { timeout: 60_000 });

  await expect(page.getByTestId("issue-record")).toContainText("E2E Consultant");
  await expect(page.getByTestId("issue-record")).toContainText("finalised");
  const view = page.getByTestId("issued-report-view");
  await expect(view.getByTestId("report-issue-line")).toContainText("Issue 1");
  await expect(view.getByTestId("report-draft-banner")).toHaveCount(0);
  await expect(view.getByTestId("rpt-exec-forecast")).toContainText("$14.7m");
  // The issued (model v3) report carries its visuals from the snapshot (Horizon: Evolution + outcomes fallback).
  await expect(view.getByTestId("as-evolution-svg")).toBeVisible();
  await expect(view.getByTestId("as-outcomes-svg")).toBeVisible();
  await expect(view.getByTestId("as-outcomes-difference")).toContainText("-$0.4m");

  const pdfHref = await page.getByRole("link", { name: "Download PDF" }).getAttribute("href");
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  const body = await pdf.body();
  expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  await page.getByRole("link", { name: "← Reports" }).click();
  const issued = page.getByTestId("issued-report").filter({ hasText: "Value Assurance Report" });
  await expect(issued).toHaveCount(1);
  await expect(issued).toContainText("Value Assurance Report");
  await expect(issued).toContainText("Issue 1");
  await expect(issued).toContainText("E2E Consultant");
});
