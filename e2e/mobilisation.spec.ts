import { expect, test, type Page } from "@playwright/test";

// Phase 4D.10C: Mobilisation as the consultant's starting workflow — explicit client choice, the derived status
// (completed / outstanding / recommended next action), the Day-1 Information Request with starter suggestions, and the
// Original Business Case as the input to Value Case Definition. Guidance only: nothing blocks navigation.

const uid = Date.now().toString(36);
const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Project" }).getByRole("link", { name, exact: true });

test("Mobilisation guides a new engagement without gating it", async ({ page }) => {
  // Explicit client choice: only one of the two fields is ever on the form.
  await page.goto("/projects/new");
  const create = page.getByTestId("create-project-form");
  const choice = create.getByTestId("client-choice");
  await expect(choice.getByLabel("Use an existing client")).toBeChecked(); // other journeys created clients
  await expect(choice.getByRole("combobox", { name: /Existing client/ })).toBeVisible();
  await expect(choice.getByLabel("New client name")).toHaveCount(0);
  await choice.getByLabel("Create a new client").check();
  await expect(choice.getByRole("combobox", { name: /Existing client/ })).toHaveCount(0);
  await choice.getByLabel("New client name").fill(`Mobilisation Client ${uid}`);
  await create.getByLabel("Project name").fill(`Mobilisation ${uid}`);
  await create.getByLabel("Currency").fill("AUD");
  await create.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByTestId("project-name")).toHaveText(`Mobilisation ${uid}`);

  // The pre-V1 Overview shows the same derived status as Mobilisation.
  const overviewStatus = page.getByTestId("mobilisation-status");
  await expect(overviewStatus).toHaveAttribute("data-stage", "mobilising");
  await expect(page.getByTestId("mobilisation-next")).toContainText("Define the Value Basis");

  await tab(page, "Mobilisation").click();
  const status = page.getByTestId("mobilisation-status");
  await expect(status.getByTestId("mobilisation-completed")).toContainText("Project established");
  const outstanding = status.getByTestId("mobilisation-outstanding");
  await expect(outstanding).toContainText("Required for V1");
  await expect(outstanding).toContainText("Recommended");
  await expect(outstanding.getByTestId("mobilisation-item-vco")).toContainText("Not nominated");
  await expect(status).not.toContainText("%"); // guidance, never a score

  // Original Business Case: the starting point for Value Case Definition.
  await expect(page.getByTestId("mobilisation-obc")).toContainText("Not captured");
  await expect(page.locator("#original-business-case")).toContainText("starting point for Value Case Definition");

  // Day-1 Information Request with two starter suggestions and one custom item.
  const dayOne = page.getByTestId("day-one-create-form");
  await dayOne.getByTestId("day-one-business-case").check();
  await dayOne.getByTestId("day-one-programme-plan").check();
  await dayOne.getByLabel("Additional items").fill("Organisation chart");
  await dayOne.getByRole("button", { name: "Create Information Request" }).click();
  await expect(page.getByTestId("day-one-existing")).toContainText("IR-01 · Day-1 Information Request");
  await expect(page.getByTestId("day-one-existing")).toContainText("3 items");
  await expect(page.getByTestId("day-one-create-form")).toHaveCount(0); // never a second Day-1 request
  await expect(page.getByTestId("mobilisation-item-information-request")).toContainText("not yet issued");

  // Remaining suggestions can still be added to the existing request.
  const add = page.getByTestId("day-one-add-form");
  await expect(add.getByTestId("day-one-business-case")).toHaveCount(0);
  await add.getByTestId("day-one-baseline-evidence").check();
  await add.getByRole("button", { name: "Add to IR-01" }).click();
  await expect(page.getByTestId("day-one-existing")).toContainText("4 items");

  // The items are ordinary Information Request items, edited and issued in the existing workflow.
  await page.getByTestId("day-one-existing").getByRole("link").click();
  await expect(page).toHaveURL(/\/information-request#ir-/);
  await expect(page.getByTestId("ir-item")).toHaveCount(4);
  await expect(page.getByTestId("ir-item").first()).toContainText("Existing Business Case");

  // Nothing is gated: Value Case Definition is open although Mobilisation is incomplete.
  await tab(page, "Value Case Definition").click();
  await expect(page.getByTestId("create-v1-form")).toBeVisible();
});
