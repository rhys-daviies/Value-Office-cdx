import { expect, test, type Locator, type Page } from "@playwright/test";

// Phase 4D.9D: consultant trajectory authoring on the synthetic "Trajectory Draft" (draft V1 $30m, unclassified,
// project Value Period 2026–2028) and "Trajectory Compact" (Authorised V1 $30m with plan; draft review with formal
// forecast $26m, forecast milestones and three option paths). Nothing is generated; milestones are entered.

function tab(page: Page, name: string) {
  return page.getByRole("navigation", { name: "Project" }).getByRole("link", { name, exact: true });
}

async function openProject(page: Page, name: string) {
  await page.goto("/projects");
  await page.getByRole("link", { name }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
}

/** Add a milestone through the editor's "+ Add milestone" form. */
async function addMilestone(editor: Locator, asOf: string, value: string) {
  const add = editor.locator("details").last();
  if (!(await add.evaluate((d) => (d as HTMLDetailsElement).open))) await add.locator("summary").click();
  await add.locator('input[name="asOf"]').fill(asOf);
  await add.locator('input[name="value"]').fill(value);
  await add.getByRole("button", { name: "Add" }).click();
}

/** Add a milestone and wait for its row (each save re-renders the editor). */
async function addAndWait(editor: Locator, asOf: string, value: string) {
  await addMilestone(editor, asOf, value);
  await expect(editor.locator(`[data-testid="milestone"][data-as-of="${asOf}"]`)).toHaveCount(1);
}

/** Edit a milestone's value in place (the edit panel stays open after a save). */
async function editValue(row: Locator, value: string) {
  const panel = row.getByTestId("milestone-edit");
  if (!(await panel.evaluate((d) => (d as HTMLDetailsElement).open))) await panel.locator("summary").click();
  await row.locator('input[name="value"]').fill(value);
  await row.getByRole("button", { name: "Save" }).click();
}

const milestoneDates = (editor: Locator) =>
  editor.getByTestId("milestone").evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.asOf));

test("Value Basis and plan milestones on a draft V1: pre-fill, NPV unavailable, mismatch shown, then locked", async ({
  page,
}) => {
  page.on("dialog", (d) => void d.accept());
  await openProject(page, "Trajectory Draft");
  await tab(page, "Value Case Definition").click();
  const section = page.getByTestId("version-trajectory");
  await expect(section).toHaveAttribute("data-status", "basis_not_classified");
  const basis = page.getByTestId("version-basis-form");
  // Project setup dates are offered, not saved.
  await expect(basis.getByLabel("Period start")).toHaveValue("2026-01-01");
  await expect(basis).toContainText("not saved until you save");
  await expect(section.getByTestId("trajectory-unavailable")).toContainText("Value Basis not classified");

  await basis.getByLabel("Value Basis").selectOption({ label: "Net Present Value (NPV)" });
  await basis.getByRole("button", { name: "Save basis" }).click();
  await expect(section).toHaveAttribute("data-status", "basis_not_supported");
  await expect(section.getByTestId("trajectory-unavailable")).toContainText(
    "Time-phased trajectory is not available for NPV.",
  );
  await expect(page.getByTestId("plan-milestones")).toHaveCount(0);

  await basis.getByLabel("Value Basis").selectOption({ label: "Cumulative Benefit" });
  await basis.getByRole("button", { name: "Save basis" }).click();
  await expect(section).toHaveAttribute("data-status", "phasing_not_entered");
  await expect(section.getByTestId("basis-note")).toContainText("Tracks cumulative value across the Value Period.");
  const plan = page.getByTestId("plan-milestones");
  await expect(page.getByTestId("plan-reconciliation")).toContainText("Phasing not entered");

  await addAndWait(plan, "2028-12-31", "28m");
  await expect(page.getByTestId("plan-reconciliation")).toContainText(
    "Terminal milestone $28.0m · Version total $30.0m · -$2.0m difference — must reconcile before proposal",
  );
  await addAndWait(plan, "2026-01-01", "0");
  await addAndWait(plan, "2026-12-31", "6m");
  await addAndWait(plan, "2027-12-31", "18m");
  await expect(plan.getByTestId("milestone")).toHaveCount(4);
  expect(await milestoneDates(plan)).toEqual(["2026-01-01", "2026-12-31", "2027-12-31", "2028-12-31"]);
  await expect(plan.locator('[data-as-of="2028-12-31"]').getByTestId("milestone-terminal")).toHaveText(
    "Value Period end",
  );

  // Edit the terminal milestone in place.
  const terminal = plan.locator('[data-as-of="2028-12-31"]');
  await editValue(terminal, "30m");
  await expect(page.getByTestId("plan-reconciliation")).toContainText(
    "Terminal milestone $30.0m · Version total $30.0m · Reconciled",
  );

  // Proposal locks the plan: read-only, no edit controls.
  await page.getByRole("button", { name: "Propose Value Case V1" }).click();
  await expect(page.getByTestId("version-basis-form")).toHaveCount(0);
  await expect(page.getByTestId("milestone-remove")).toHaveCount(0);
  await expect(page.getByText("+ Add milestone")).toHaveCount(0);
  await expect(page.getByTestId("plan-milestones").getByTestId("milestone")).toHaveCount(4);
});

test("Formal forecast and option-path milestones on a draft review; recommendation freezes the options", async ({
  page,
}) => {
  page.on("dialog", (d) => void d.accept());
  await openProject(page, "Trajectory Compact");
  const projectUrl = page.url();

  // The authorised plan is read-only on the version page.
  await page.goto(`${projectUrl}/value-case/v/1`);
  const plan = page.getByTestId("plan-milestones");
  await expect(plan.getByTestId("milestone-value")).toHaveText(["$0", "$6.0m", "$18.0m", "$30.0m"]);
  await expect(page.getByTestId("plan-reconciliation")).toContainText("Reconciled");
  await expect(page.getByTestId("milestone-remove")).toHaveCount(0);

  await tab(page, "Assurance").click();
  await page.getByTestId("review-row").getByRole("link", { name: "#1" }).click();
  const context = page.getByTestId("forecast-context");
  await expect(context).toContainText("Review date 30 Sept 2026");
  await expect(context).toContainText("Value Period end 31 Dec 2028");
  await expect(page.getByTestId("forecast-terminal-amount")).toHaveText("$26.0m");
  const forecast = page.getByTestId("forecast-milestones");
  await expect(forecast.getByTestId("milestone-value")).toHaveText(["$16.0m", "$26.0m"]);
  await expect(page.getByTestId("forecast-reconciliation")).toContainText("Reconciled");

  // Mismatch is shown, not auto-corrected; then restored.
  const end = forecast.locator('[data-as-of="2028-12-31"]');
  await editValue(end, "25m");
  await expect(page.getByTestId("forecast-reconciliation")).toContainText(
    "-$1.0m difference — must reconcile before finalisation",
  );
  await editValue(end, "26m");
  await expect(page.getByTestId("forecast-reconciliation")).toContainText("Reconciled");

  // A date on or before the review date is refused with a clear message.
  await addMilestone(forecast, "2026-09-30", "3m");
  await expect(forecast.getByRole("alert")).toContainText("must fall after the review date");
  await addAndWait(forecast, "2027-06-30", "10m");
  expect(await milestoneDates(forecast)).toEqual(["2027-06-30", "2027-12-31", "2028-12-31"]);
  await forecast.locator('[data-as-of="2027-06-30"]').getByTestId("milestone-remove").click();
  await expect(forecast.getByTestId("milestone")).toHaveCount(2);

  // Option paths: one editor per option, each against its own total.
  const options = page.getByTestId("option-path");
  await expect(options.getByTestId("option-path-label")).toHaveText(["Act now", "Delay 3 months", "No action"]);
  const noAction = options.filter({ hasText: "No action" });
  await expect(noAction).toContainText("option total $23.0m");
  await addAndWait(noAction.getByTestId("option-milestones"), "2027-06-30", "12m");
  await expect(noAction.getByTestId("milestone")).toHaveCount(4); // 3 canonical (incl. the 30 Dec 2026 pivot) + 1
  await expect(options.filter({ hasText: "Act now" }).getByTestId("milestone")).toHaveCount(2);
  await expect(noAction.getByTestId("option-reconciliation")).toContainText("Reconciled");

  // 4D.10G: in Internal Cardaxia Review the paths are read-only (not frozen); issuing freezes them.
  await page.getByRole("button", { name: "Submit for Internal Review" }).click();
  await expect(page.getByTestId("option-paths")).toContainText("read-only while the recommendation is in Internal");
  await expect(page.getByTestId("option-paths").getByTestId("milestone-remove")).toHaveCount(0);
  await page.getByRole("button", { name: "Mark Ready to Issue" }).click();
  await expect(page.getByTestId("recommendation-state")).toHaveAttribute("data-state", "ready_to_issue");
  await page.getByRole("button", { name: "Issue to management" }).click();
  await expect(page.getByTestId("option-paths")).toContainText("Option paths are frozen");
  await expect(page.getByTestId("option-paths").getByTestId("milestone-remove")).toHaveCount(0);
  await expect(forecast.getByTestId("milestone-remove")).toHaveCount(2); // forecast stays editable until finalisation
});
