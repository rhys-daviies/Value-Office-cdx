import { expect, test, type Locator, type Page } from "@playwright/test";

// Phase 4D.10G: internal Cardaxia review of the recommendation before issue — Mike's journey. The reviewer asks for an
// additional delayed option BEFORE issue; the consultant adds it and resubmits; only then is it issued and frozen.
// Synthetic "Recommendation Compact" project (Authorised V1 $1.5m: VD-01 $1.0m, VD-02 $0.5m, VD-03 non-financial).

const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Project" }).getByRole("link", { name, exact: true });

async function done(form: Locator, button: string, status: string | RegExp) {
  await form.getByRole("button", { name: button }).click();
  await expect(form.getByRole("status")).toContainText(status);
}

async function addOption(page: Page, label: string, kind: string, total: string) {
  const panel = page.getByTestId("add-scenario");
  if ((await panel.getAttribute("open")) === null) await panel.locator("summary").click(); // stays open after an add
  const form = page.getByTestId("add-scenario-form");
  await form.getByLabel("Option").fill(label);
  await form.getByLabel("Kind").selectOption({ label: kind });
  await form.getByLabel("Projected total value").fill(total);
  await form.getByRole("button", { name: "Add option" }).click();
  await expect(page.getByTestId("scenario-row").filter({ hasText: label })).toHaveCount(1);
}

const state = (page: Page) => page.getByTestId("recommendation-state");

test("draft → submit → returned (add delayed option) → resubmit → returned → resubmit → ready → issue → decision", async ({
  page,
}) => {
  page.on("dialog", (d) => void d.accept());
  await page.goto("/projects");
  await page.getByRole("link", { name: "Recommendation Compact" }).click();
  await tab(page, "Assurance").click();
  const create = page.getByTestId("create-review-form");
  await create.getByLabel("Why is this review happening?").selectOption({ label: "Ad hoc" });
  await create.getByRole("button", { name: "Open review" }).click();
  await expect(page.getByTestId("review-state")).toContainText("Assurance Review #1");

  // Options and a draft recommendation.
  await addOption(page, "Current trajectory", "Current trajectory", "1.3m");
  await addOption(page, "Act now", "Proposed recommendation", "1.5m");
  const rec = page.getByTestId("recommendation-form");
  await rec.getByLabel("Recommendation").fill("Act now to protect $0.2m.");
  await done(rec, "Save draft recommendation", "Recommendation saved");
  await expect(state(page)).toHaveAttribute("data-state", "draft");
  await expect(page.getByTestId("decision")).toHaveCount(0);
  await expect(page.locator("#decision")).toContainText("recorded after Cardaxia's recommendation is issued");

  // Submit: read-only for review, not issued, no decision possible.
  await page.getByRole("button", { name: "Submit for Internal Review" }).click();
  await expect(state(page)).toHaveAttribute("data-state", "in_internal_review");
  await expect(state(page)).toHaveAttribute("data-state", "in_internal_review");
  await expect(state(page)).toHaveText("In Internal Cardaxia Review");
  await expect(page.getByTestId("recommendation-form")).toHaveCount(0);
  await expect(page.getByTestId("add-scenario")).toHaveCount(0);
  await expect(page.locator("#options")).toContainText(
    "read-only while the recommendation is in Internal Cardaxia Review",
  );
  await expect(page.locator("#decision")).toContainText("recorded after Cardaxia's recommendation is issued");

  // Reviewer returns it: another (delayed) option is needed. Feedback is required.
  const ret = page.getByTestId("return-recommendation-form");
  await ret.getByRole("button", { name: "Return for revision" }).click();
  await expect(state(page)).toHaveAttribute("data-state", "in_internal_review"); // blank feedback refused
  await ret.getByLabel("Return for revision — reviewer feedback").fill("Add a delayed-action option for management.");
  await ret.getByRole("button", { name: "Return for revision" }).click();
  await expect(state(page)).toHaveAttribute("data-state", "returned");
  await expect(page.getByTestId("recommendation-feedback")).toContainText(
    "Add a delayed-action option for management.",
  );

  // Consultant adds the delayed option (existing options are kept) and resubmits.
  await expect(page.getByTestId("scenario-row")).toHaveCount(2);
  await addOption(page, "Delay one quarter", "Alternative", "1.4m");
  await expect(page.getByTestId("scenario-row")).toHaveCount(3);
  await page.getByRole("button", { name: "Resubmit for Internal Review" }).click();
  await expect(state(page)).toHaveAttribute("data-state", "in_internal_review");

  // Second cycle: returned again for clarification; the first feedback is kept in history.
  await page
    .getByTestId("return-recommendation-form")
    .getByLabel("Return for revision — reviewer feedback")
    .fill("Explain the timing assumption behind the delay.");
  await page.getByTestId("return-recommendation-form").getByRole("button", { name: "Return for revision" }).click();
  await expect(state(page)).toHaveAttribute("data-state", "returned");
  const rec2 = page.getByTestId("recommendation-form");
  await rec2.getByLabel("Recommendation").fill("Act now to protect $0.2m; a one-quarter delay costs $0.1m.");
  await done(rec2, "Save draft recommendation", "Recommendation saved");
  await page.getByRole("button", { name: "Resubmit for Internal Review" }).click();
  await expect(state(page)).toHaveAttribute("data-state", "in_internal_review");

  // Reviewer approves: Ready to Issue — still read-only, still no decision.
  await page.getByRole("button", { name: "Mark Ready to Issue" }).click();
  await expect(state(page)).toHaveAttribute("data-state", "ready_to_issue");
  await expect(page.getByTestId("ready-to-issue-panel")).toContainText("Internal review complete");
  await expect(page.getByTestId("add-scenario")).toHaveCount(0);
  await expect(page.locator("#decision")).toContainText("recorded after Cardaxia's recommendation is issued");

  // Issue to management: permanent; options frozen; a decision can now be recorded.
  await page.getByRole("button", { name: "Issue to management" }).click();
  await expect(state(page)).toHaveAttribute("data-state", "issued");
  await expect(page.getByTestId("recommendation")).toContainText("Act now: $1.5m");
  await expect(page.getByTestId("recommendation")).toContainText("a one-quarter delay costs $0.1m");
  await expect(page.locator("#options")).toContainText("Options are frozen");
  await expect(page.getByTestId("add-scenario")).toHaveCount(0);
  await expect(page.getByTestId("return-recommendation-form")).toHaveCount(0);
  await expect(page.getByTestId("recommendation-decision-status")).toHaveText("Awaiting management decision");

  const history = page.getByTestId("review-history-item");
  await expect(history).toHaveCount(6);
  await expect(page.getByTestId("review-history-item").and(page.locator('[data-kind="returned"]'))).toHaveCount(2);
  await expect(page.getByTestId("review-history")).toContainText("Add a delayed-action option for management.");
  await expect(page.getByTestId("review-history")).toContainText("Explain the timing assumption behind the delay.");

  const decision = page.getByTestId("decision-form");
  await decision.getByLabel("Selected option").selectOption({ label: "Delay one quarter ($1.4m)" });
  await decision.getByLabel("Decision maker").selectOption({ label: "Test VCO" });
  await decision.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByTestId("decision-difference")).toHaveText("-$0.1m");
  await expect(page.getByTestId("recommendation-decision-status")).toHaveText("Management decision recorded");
});
