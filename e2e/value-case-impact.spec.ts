import { expect, test, type Page } from "@playwright/test";

// Phase 4D.10H: the no-change path and the executive Overview, on the synthetic "Impact Compact" project (Authorised
// V1 $1.5m; Review #1 finalised at $1.4m — the forecast moved; recommendation issued; management decision recorded).

const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Project" }).getByRole("link", { name, exact: true });

test("decision → No Value Change Required → Authorised Value unchanged; Overview governance and next action; cadence", async ({
  page,
}) => {
  page.on("dialog", (d) => void d.accept());
  await page.goto("/projects");
  await page.getByRole("link", { name: "Impact Compact" }).click();

  // Overview: authorised, formal position, governance, next action.
  await expect(page.getByTestId("overview-authorised-value")).toHaveText("$1.5m");
  await expect(page.getByTestId("overview-forecast")).toHaveText("$1.4m");
  const gov = page.getByTestId("overview-governance");
  await expect(gov.getByTestId("gov-decision")).toHaveText("Recorded (Review #1)");
  await expect(gov.getByTestId("gov-impact")).toHaveText("To be determined");
  await expect(gov.getByTestId("gov-draft-review")).toHaveText("None");
  await expect(page.getByTestId("overview-next-action")).toContainText(
    "Determine the Value Case impact of the Review #1 decision",
  );
  await page.getByTestId("overview-next-action").click();
  await expect(page).toHaveURL(/\/assurance\/[0-9a-f-]{36}#value-change$/);

  // The determination: explicit, with a rationale; no Value Change form unless a change is proposed.
  const impact = page.getByTestId("value-case-impact");
  await expect(impact.getByTestId("impact-stage")).toHaveAttribute("data-stage", "awaiting_determination");
  await expect(impact).toContainText("Decision recorded — the Value Case impact must now be determined.");
  await expect(impact.getByTestId("create-change-form")).toHaveCount(0);
  const form = page.getByTestId("determination-form");
  await form.getByLabel("No Value Change Required").check();
  await form.getByLabel("Rationale").fill("Management action protects the existing authorised commitment.");
  await form.getByRole("button", { name: "Record determination" }).click();
  await expect(impact.getByTestId("impact-stage")).toHaveAttribute("data-stage", "no_value_change");
  await expect(impact.getByTestId("determination")).toContainText("No Value Change Required");
  await expect(impact.getByTestId("determination-rationale")).toHaveText(
    "Management action protects the existing authorised commitment.",
  );
  await expect(impact.getByTestId("determination-unchanged")).toContainText("remains $1.5m (V1)");
  await expect(page.getByTestId("determination-form")).toHaveCount(0); // permanent, once per decision
  await expect(impact.getByTestId("create-change-form")).toHaveCount(0);
  await expect(page.getByTestId("story-determination")).toContainText("No Value Change Required");

  // Overview: nothing pending; Authorised Value unchanged.
  await tab(page, "Overview").click();
  await expect(page.getByTestId("overview-authorised-value")).toHaveText("$1.5m");
  await expect(gov.getByTestId("gov-impact")).toHaveText("No Value Change Required");
  await expect(page.getByTestId("overview-next-action-none")).toBeVisible();

  // Cadence: an Ad hoc draft while Kick-off is due is called out; a matching draft reads In progress.
  await tab(page, "Assurance").click();
  const create = page.getByTestId("create-review-form");
  await create.getByLabel("Why is this review happening?").selectOption({ label: "Ad hoc" });
  await create.getByRole("button", { name: "Open review" }).click();
  await expect(page.getByTestId("review-state")).toContainText("Assurance Review #2");
  await tab(page, "Assurance").click();
  await expect(page.getByTestId("requirement-kickoff")).toContainText("Due");
  await expect(page.getByTestId("requirement-draft-mismatch")).toContainText("Review #2 is open as Ad hoc");
  await page.getByTestId("active-draft-review").getByRole("link").click();
  const details = page.getByTestId("review-details-form");
  await details.locator(`select[name="trigger"]`).selectOption({ label: "Kick-off" });
  await details.getByRole("button", { name: "Save review details" }).click();
  await expect(details.getByRole("status")).toContainText("Review saved");
  await tab(page, "Assurance").click();
  await expect(page.getByTestId("requirement-kickoff")).toContainText("In progress");
  await expect(page.getByTestId("requirement-draft-mismatch")).toHaveCount(0);

  // Overview next action follows the draft review; Assurance continues against Authorised V1.
  await tab(page, "Overview").click();
  await expect(page.getByTestId("overview-next-action")).toContainText("Continue draft Assurance Review #2");
  await expect(page.getByTestId("overview-governance").getByTestId("gov-draft-review")).toHaveText("Review #2 (draft)");
  await page.getByTestId("overview-next-action").click();
  await expect(page.getByTestId("context-authorised")).toHaveText("$1.5m");
});
