import { expect, test, type Page } from "@playwright/test";

// Phase 2 golden path on the synthetic "Assurance Compact" project (Authorised V1:
// Alpha $1.0m, Beta $0.5m, Gamma non-financial; authorised total $1.5m).

function tab(page: Page, name: string) {
  return page.getByRole("navigation", { name: "Project" }).getByRole("link", { name, exact: true });
}

async function enterPositions(
  page: Page,
  values: Record<string, { forecast?: string; realised?: string; note?: string; why?: string }>,
) {
  const form = page.getByTestId("positions-form");
  for (const [code, v] of Object.entries(values)) {
    const block = form.getByTestId(`position-editor-${code}`);
    if (v.forecast !== undefined) await block.getByLabel("Current Forecast").fill(v.forecast);
    if (v.realised !== undefined) await block.getByLabel("Realised Value (cumulative)").fill(v.realised);
    if (v.note !== undefined) await block.getByLabel("Outcome outlook").fill(v.note);
    if (v.why !== undefined) await block.getByLabel("Why the forecast changed (or why Not Assessed)").fill(v.why);
  }
  await form.getByRole("button", { name: "Save Value Positions" }).click();
  await expect(form.getByRole("status")).toContainText("Value Positions saved");
}

function row(page: Page, code: string) {
  return page.getByTestId("position-row").filter({ hasText: code });
}

test("Authorised V1 → review → positions → finalise → second review compares with the first", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());

  await page.goto("/projects");
  await page.getByRole("link", { name: "Assurance Compact" }).click();

  // Before any review the overview shows Authorised Value only — no fake forecast, realised or gap.
  await expect(page.getByTestId("overview-authorised-value")).toHaveText("$1.5m");
  await expect(page.getByTestId("overview-formal-position")).toHaveText("No formal Assurance position yet.");
  for (const id of ["overview-forecast", "overview-realised", "overview-gap"]) {
    await expect(page.getByTestId(id)).toHaveCount(0);
  }

  // ---- Review #1 (kick-off) -------------------------------------------------------
  await tab(page, "Assurance").click();
  await expect(page.getByTestId("assurance-forecast")).toHaveText("Not yet assessed");
  await expect(page.getByTestId("requirement-material_evidence_change")).toContainText("E-002");
  const create = page.getByTestId("create-review-form");
  await create.getByLabel("Why is this review happening?").selectOption({ label: "Kick-off" });
  await create.getByRole("button", { name: "Open review" }).click();

  await expect(page.getByTestId("review-state")).toContainText("Assurance Review #1");
  await expect(page.getByTestId("previous-position")).toHaveText("Authorised Value V1 — first review");
  await expect(page.getByRole("button", { name: "Finalise review" })).toBeDisabled(); // no positions yet

  await enterPositions(page, {
    "VD-01": { forecast: "0.9m", realised: "100k" },
    "VD-02": { forecast: "400,000" },
    "VD-03": { note: "Customer feedback trending positive" },
  });
  // First review: movement = forecast − Authorised Value
  await expect(row(page, "VD-01").getByTestId("position-movement")).toHaveText("-$0.1m");
  await expect(row(page, "VD-01").getByTestId("position-gap")).toHaveText("$0.1m");
  await expect(row(page, "VD-02").getByTestId("position-movement")).toHaveText("-$0.1m");
  await expect(row(page, "VD-03")).toContainText("Non-financial");
  await expect(page.getByTestId("review-authorised")).toHaveText("$1.5m");
  await expect(page.getByTestId("review-forecast")).toHaveText("$1.3m");
  await expect(page.getByTestId("review-realised")).toHaveText("$0.1m");
  await expect(page.getByTestId("review-gap")).toHaveText("$0.2m");
  await expect(page.getByTestId("review-movement")).toHaveText("-$0.2m");

  // 4D.10F: What changed and Why it matters are one reasoning step.
  const reasoning = page.getByTestId("reasoning-form");
  await reasoning.getByLabel("What changed?").fill("Beta volumes below plan in Q3.");
  await reasoning.getByLabel("Why does it matter?").fill("$0.2m below Authorised Value.");
  await reasoning.getByRole("button", { name: "Save" }).click();
  await expect(reasoning.getByRole("status")).toContainText("Review saved");
  const link = page.getByTestId("review-evidence-form");
  await link.getByLabel("Link evidence").selectOption({ label: "E-002 Quarterly benefits report" });
  await link.getByRole("button", { name: "Link" }).click();
  await expect(page.getByText("Evidence relied on in this review (1)")).toBeVisible();

  // 4D.10E: both forecasts moved from the authorised value — finalisation needs the governed "why".
  await expect(page.getByTestId("finalise-why")).toContainText("VD-01, VD-02: forecast moved from its formal baseline");
  await expect(page.getByRole("button", { name: "Finalise review" })).toBeDisabled();
  await enterPositions(page, {
    "VD-01": { why: "Ramp-up slower than planned" },
    "VD-02": { why: "Beta volumes below plan in Q3" },
  });
  await expect(page.getByTestId("finalise-why")).toContainText("Every forecast movement has a reason");
  await expect(row(page, "VD-02").getByTestId("position-why")).toHaveText(
    "Why it moved: Beta volumes below plan in Q3",
  );

  await page.getByRole("button", { name: "Finalise review" }).click();
  await expect(page.getByTestId("review-state")).toContainText("Finalised");
  await expect(page.getByTestId("positions-form")).toHaveCount(0);
  await expect(page.getByTestId("what-changed")).toHaveText("Beta volumes below plan in Q3.");
  await expect(page.getByTestId("why-it-matters")).toHaveText("$0.2m below Authorised Value.");

  // ---- Assurance overview reflects Review #1 --------------------------------------
  await tab(page, "Assurance").click();
  await expect(page.getByTestId("assurance-forecast")).toHaveText("$1.3m");
  await expect(page.getByTestId("assurance-gap")).toHaveText("$0.2m");
  await expect(page.getByTestId("assurance-movement")).toHaveText("-$0.2m");
  await expect(page.getByTestId("requirement-material_evidence_change")).toHaveCount(0); // E-002 now reviewed

  // ---- Review #2 (six-month): movement vs Review #1, not vs V1 ----------------------
  const create2 = page.getByTestId("create-review-form");
  await create2.getByLabel("Why is this review happening?").selectOption({ label: "Six-month" });
  await create2.getByRole("button", { name: "Open review" }).click();
  await expect(page.getByTestId("review-state")).toContainText("Assurance Review #2");
  await expect(page.getByTestId("previous-position")).toContainText("Review #1");

  await enterPositions(page, {
    "VD-01": { forecast: "1.0m", realised: "300k", why: "Recovered after the vendor fix" },
    "VD-02": { forecast: "0.4m" },
    "VD-03": { note: "Unchanged" },
  });
  // VD-01: 1.0m vs Review #1's 0.9m = +$0.1m (vs V1 it would have been $0)
  await expect(row(page, "VD-01").getByTestId("position-baseline")).toContainText("$0.9m");
  await expect(row(page, "VD-01").getByTestId("position-baseline-source")).toHaveText("Review #1");
  await expect(row(page, "VD-01").getByTestId("position-movement")).toHaveText("+$0.1m");
  await expect(row(page, "VD-01").getByTestId("position-gap")).toHaveText("$0");
  await expect(row(page, "VD-02").getByTestId("position-movement")).toHaveText("$0");
  await expect(page.getByTestId("review-forecast")).toHaveText("$1.4m");
  await expect(page.getByTestId("review-movement")).toHaveText("+$0.1m");
  await expect(page.getByTestId("review-gap")).toHaveText("$0.1m");

  await page.getByRole("button", { name: "Finalise review" }).click();
  await expect(page.getByTestId("review-state")).toContainText("Finalised");

  // ---- History and overview ---------------------------------------------------------
  await tab(page, "Assurance").click();
  await expect(page.getByTestId("review-row")).toHaveCount(2);
  await expect(page.getByTestId("assurance-forecast")).toHaveText("$1.4m");
  await expect(page.getByTestId("assurance-movement")).toHaveText("+$0.1m");
  await tab(page, "Overview").click();
  await expect(page.getByTestId("overview-forecast")).toHaveText("$1.4m");
  await expect(page.getByTestId("overview-realised")).toHaveText("$0.3m");
  await expect(page.getByTestId("overview-gap")).toHaveText("$0.1m");

  // Authorised V1 is untouched
  await tab(page, "Value Case").click();
  await expect(page.getByTestId("timeline-v1-total")).toHaveText("$1.5m");
});
