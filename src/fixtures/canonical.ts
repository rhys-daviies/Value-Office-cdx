import { and, eq } from "drizzle-orm";

import { todayIso } from "@/domain/attention";
import {
  createReview,
  finaliseReview,
  linkReviewEvidence,
  updateReview,
  upsertValuePositions,
} from "@/server/commands/assurance";
import { recordEvidence } from "@/server/commands/evidence";
import { assessLeakage } from "@/server/commands/leakage";
import { documentMatterEvidence } from "@/server/commands/matter-evidence";
import { createMatter, setMatterStage } from "@/server/commands/matters";
import { issueRecommendation, recordDecision, saveRecommendation, upsertScenario } from "@/server/commands/options";
import { createProject } from "@/server/commands/project";
import type { Actor } from "@/server/commands/run";
import { addStakeholder, setValueCaseOwner } from "@/server/commands/stakeholders";
import { setForecastPoint, setPlanPoint, setScenarioPoint, setVersionBasis } from "@/server/commands/trajectory";
import {
  addValueDriver,
  authoriseInitialVersion,
  createDraftVersion,
  createInheritedBusinessCase,
  proposeVersion,
  recordInheritedBusinessCase,
  updateDriverVersion,
} from "@/server/commands/value-case";
import { authoriseValueChange, createValueChange, proposeValueChange } from "@/server/commands/value-change";
import { db, schema } from "@/server/db/client";

// Canonical end-to-end Value Office journey (Phase 4D.9K). ONE synthetic engagement, built only through commands, in
// the order the methodology requires — so every lifecycle invariant is exercised, not seeded around. Stages can be run
// one at a time (tests issue client reports between them). "Trajectory Executive" is this journey up to Review #2.
// Synthetic only: no client data. Dates are fixed historical dates, except the events that the domain timestamps
// "now" (recommendation issue, finalisation) and the ones that must follow them: the management decision, the Value
// Change authorisation and the post-V2 review all fall on the day the journey runs.

/** The canonical economic story (synthetic). Money is exact decimal strings. */
export const CANONICAL = {
  valuePeriod: { start: "2026-01-01", end: "2028-12-31" },
  originalBusinessCase: "32000000.00",
  v1: {
    authorisedOn: "2026-01-15",
    total: "30000000.00",
    drivers: [
      ["VD-01", "Procurement Savings", "15000000.00"],
      ["VD-02", "Revenue Uplift", "10000000.00"],
      ["VD-03", "Working Capital", "5000000.00"],
    ],
    plan: [
      ["2026-01-01", "0.00"],
      ["2026-12-31", "6000000.00"],
      ["2027-12-31", "18000000.00"],
      ["2028-12-31", "30000000.00"],
    ],
  },
  review1: {
    date: "2026-03-31",
    forecast: ["14000000.00", "9500000.00", "4500000.00"], // $28.0m
    realised: ["600000.00", "300000.00", "100000.00"], // $1.0m
  },
  review2: {
    date: "2026-09-30",
    forecast: ["13000000.00", "9000000.00", "4000000.00"], // $26.0m → Value Gap $4.0m against V1 $30.0m
    realised: ["2500000.00", "1000000.00", "500000.00"], // $4.0m
    forecastPath: [
      ["2027-12-31", "16000000.00"],
      ["2028-12-31", "26000000.00"],
    ],
    leakage: { total: "700000.00", unrecoverable: "250000.00" }, // recoverable $450,000
    /**
     * Options assessed at Review #2 (branch point: 30 Sept 2026, formal realised $4.0m). Every dated milestone is
     * explicit scenario data entered by the consultant; nothing is inferred from an option's name (4D.9N.1A, PMO).
     * No action and Delay 3 months share the 30 Dec 2026 scenario assessment ($5.0m): Delay follows the no-action path
     * to that decision point, where management acts (the stored note), then recovers to its $27.0m outcome.
     */
    options: [
      {
        label: "Act now",
        kind: "recommended",
        total: "29000000.00",
        narrative: null,
        points: [
          ["2027-12-31", "18000000.00", null],
          ["2028-12-31", "29000000.00", null],
        ],
      },
      {
        label: "Delay 3 months",
        kind: "alternative",
        total: "27000000.00",
        narrative:
          "Synthetic: follows the no-action path to the 30 Dec 2026 decision point, then management acts; recovery to $27.0m.",
        points: [
          ["2026-12-30", "5000000.00", "Management acts — delayed action"],
          ["2027-12-31", "16500000.00", null],
          ["2028-12-31", "27000000.00", null],
        ],
      },
      {
        label: "No action",
        kind: "no_action",
        total: "23000000.00",
        narrative:
          "Consultant scenario assessment: if no corrective action is taken during the next three months, cumulative value progression is expected to reach approximately $5.0m by the delayed decision point.",
        points: [
          ["2026-12-30", "5000000.00", null],
          ["2027-12-31", "15000000.00", null],
          ["2028-12-31", "23000000.00", null],
        ],
      },
    ],
  },
  /**
   * Governed Value Change (4D.9N.1A, PMO): VC-001 formalises the ADOPTED management path (Delay 3 months) as its own
   * governed act — the decision alone never changes the Authorised Value Case. V2 = $27.0m with the Delay path's
   * phasing; only Procurement Savings (VD-01, the driver affected by VL-001) is re-baselined.
   */
  valueChange: {
    code: "VC-001",
    stated: "-3000000.00",
    vd01To: "12000000.00", // VD-01 $15.0m → $12.0m: V2 total $27.0m, reconciles with the stated −$3.0m
    reason:
      "Synthetic: formalises the adopted Delay 3 months path. Vendor sequencing (VL-001) defers procurement onboarding; the VCO re-baselines Procurement Savings to $12.0m and re-phases the plan to the delayed-action path.",
    v2Plan: [
      ["2026-01-01", "0.00"],
      ["2026-12-31", "5000000.00"],
      ["2027-12-31", "16500000.00"],
      ["2028-12-31", "27000000.00"],
    ],
  },
  /**
   * Review #3 against V2 ($27.0m). Realised $4.6m is unchanged (realised value is independent of the authorised total).
   * The re-baselined Procurement Savings is forecast on plan ($12.0m); Revenue Uplift and Working Capital continue the
   * shortfalls already formally recorded at Review #2 ($9.0m vs $10.0m, $4.0m vs $5.0m), which VC-001 did not re-baseline.
   * Formal Forecast $25.0m → Value Gap $2.0m, explained entirely by those two drivers. Path (4D.9N.1B.1): $5.0m at
   * 31 Dec 2026 — near-term formal forecast remains aligned with the V2 authorised milestone of $5.0m; the remaining
   * $2.0m period-end shortfall emerges later through the continuing Revenue Uplift and Working Capital underperformance
   * — then $15.5m at 31 Dec 2027 (V2 plan $16.5m less the $1.0m of the shortfall expected by then), $25.0m at the Value
   * Period end. A deliberate synthetic forecast assumption.
   */
  review3: {
    forecast: ["12000000.00", "9000000.00", "4000000.00"], // $25.0m → Value Gap $2.0m against V2 $27.0m
    realised: ["2800000.00", "1200000.00", "600000.00"], // $4.6m
    forecastPath: [
      ["2026-12-31", "5000000.00"],
      ["2027-12-31", "15500000.00"],
      ["2028-12-31", "25000000.00"],
    ],
  },
} as const;

export function canonicalJourney(actor: Actor, opts: { code: string; name: string }) {
  const today = todayIso();
  type Row<F extends (...a: never[]) => unknown> = Awaited<ReturnType<F>>;
  const s = {} as {
    project: Row<typeof createProject>["project"];
    vco: Row<typeof addStakeholder>["person"];
    lead: Row<typeof addStakeholder>["person"];
    v0: Row<typeof recordInheritedBusinessCase> | null;
    v1: Row<typeof createDraftVersion>;
    drivers: string[];
    matter: Row<typeof createMatter>;
    review1: Row<typeof createReview>;
    review2: Row<typeof createReview>;
    scenarios: Record<string, Row<typeof upsertScenario>>;
    decision: Row<typeof recordDecision>;
    change: Row<typeof createValueChange>["change"];
    v2: Row<typeof createValueChange>["version"];
    review3: Row<typeof createReview>;
  };
  const positions = (forecast: readonly string[], realised: readonly string[]) =>
    s.drivers.map((id, i) => ({ valueDriverId: id, currentForecast: forecast[i]!, realisedValue: realised[i]! }));

  return {
    state: s,
    today,

    /** 1–7: project, V0, drivers (qualified), Value Basis and Period, V1 plan, proposal, VCO authorisation. */
    async establish(o: { inherited?: boolean } = {}) {
      const { project } = await createProject(actor, {
        newClientName: "Synthetic Test Client",
        code: opts.code,
        name: opts.name,
        currency: "USD",
        valueBasisDescription: "Synthetic: cumulative benefit over FY26–FY28",
        valuePeriodStart: CANONICAL.valuePeriod.start,
        valuePeriodEnd: CANONICAL.valuePeriod.end,
      });
      s.project = project;
      const { person: vco } = await addStakeholder(actor, {
        projectId: project.id,
        name: "Test VCO",
        roleDescription: "VCO",
      });
      s.vco = vco;
      await setValueCaseOwner(actor, { projectId: project.id, personId: vco.id });
      s.v0 = null;
      if (o.inherited) {
        const draft = await createInheritedBusinessCase(actor, {
          projectId: project.id,
          title: "Original Business Case",
          summary: "Synthetic: headline figure only.",
          statedTotalValue: CANONICAL.originalBusinessCase,
        });
        s.v0 = await recordInheritedBusinessCase(actor, { versionId: draft.id });
      }
      const v1 = await createDraftVersion(actor, {
        projectId: project.id,
        title: "Re-Qualified Value Case",
        ...(s.v0 ? { basedOnVersionId: s.v0.id } : {}),
      });
      s.v1 = v1;
      s.drivers = [];
      for (const [i, [code, name, value]] of CANONICAL.v1.drivers.entries()) {
        const { driver, driverVersion } = await addValueDriver(actor, {
          versionId: v1.id,
          code,
          name,
          financialValue: value,
          sortOrder: i + 1,
        });
        s.drivers.push(driver.id);
        if (o.inherited) {
          await updateDriverVersion(actor, {
            driverVersionId: driverVersion.id,
            qualificationStatus: i === 0 ? "qualified" : "partially_qualified",
            evidenceStatus: i === 0 ? "evidenced" : "partially_evidenced",
          });
        }
      }
      await setVersionBasis(actor, {
        versionId: v1.id,
        valueBasisKind: "cumulative_benefit",
        valuePeriodStart: CANONICAL.valuePeriod.start,
        valuePeriodEnd: CANONICAL.valuePeriod.end,
      });
      for (const [asOf, value] of CANONICAL.v1.plan) await setPlanPoint(actor, { versionId: v1.id, asOf, value });
      await proposeVersion(actor, { versionId: v1.id });
      const evidence = await recordEvidence(actor, {
        projectId: project.id,
        code: "E-001",
        title: "Synthetic authorisation",
      });
      await authoriseInitialVersion(actor, {
        versionId: v1.id,
        authorisedByPersonId: vco.id,
        authorisedOn: CANONICAL.v1.authorisedOn,
        authorisationEvidenceId: evidence.id,
      });
      return s;
    },

    /**
     * 9–20: Continuous Assurance matter with working evidence; Review #1 and Review #2 finalised; formal leakage;
     * three phased options; Cardaxia's recommendation (Act now) issued; management selects Delay 3 months.
     */
    async assure() {
      const p = s.project.id;
      s.review1 = await createReview(actor, { projectId: p, trigger: "kickoff", reviewDate: CANONICAL.review1.date });
      await upsertValuePositions(actor, {
        reviewId: s.review1.id,
        positions: positions(CANONICAL.review1.forecast, CANONICAL.review1.realised),
      });
      await finaliseReview(actor, { reviewId: s.review1.id });

      const { person: lead } = await addStakeholder(actor, {
        projectId: p,
        name: "Test Delivery Lead",
        roleDescription: "Risk / Leakage Owner",
      });
      s.lead = lead;
      s.matter = await createMatter(actor, {
        projectId: p,
        code: "VL-001",
        title: "Vendor sequencing risk",
        identifiedOn: "2026-08-14",
        responseOwnerPersonId: lead.id,
        driverIds: [s.drivers[0]!],
      });
      await setMatterStage(actor, { matterId: s.matter.id, stage: "escalated" });
      // Working evidence on the living matter (never formal review evidence by itself).
      await documentMatterEvidence(actor, { matterId: s.matter.id, code: "E-003", title: "Vendor delivery schedule" });

      const r2 = await createReview(actor, { projectId: p, trigger: "ad_hoc", reviewDate: CANONICAL.review2.date });
      s.review2 = r2;
      await upsertValuePositions(actor, {
        reviewId: r2.id,
        positions: positions(CANONICAL.review2.forecast, CANONICAL.review2.realised),
      });
      for (const [asOf, value] of CANONICAL.review2.forecastPath)
        await setForecastPoint(actor, { reviewId: r2.id, asOf, value });
      s.scenarios = {};
      for (const [i, o] of CANONICAL.review2.options.entries()) {
        const sc = await upsertScenario(actor, {
          reviewId: r2.id,
          label: o.label,
          kind: o.kind,
          totalValue: o.total,
          sortOrder: i + 1,
          ...(o.narrative ? { narrative: o.narrative } : {}),
        });
        for (const [asOf, value, note] of o.points)
          await setScenarioPoint(actor, { scenarioId: sc.id, asOf, value, ...(note ? { note } : {}) });
        s.scenarios[o.label] = sc;
      }
      await saveRecommendation(actor, {
        reviewId: r2.id,
        scenarioId: s.scenarios["Act now"]!.id,
        narrative: "Act now to protect the plan",
      });
      const plan = await recordEvidence(actor, {
        projectId: p,
        code: "E-002",
        title: "Revised mobilisation plan",
        isMaterialChange: true,
      });
      await updateReview(actor, {
        reviewId: r2.id,
        trigger: "material_evidence_change",
        triggerEvidenceId: plan.id,
        whatChanged: "Synthetic: the vendor's revised mobilisation plan moves procurement onboarding by two quarters.",
      });
      await linkReviewEvidence(actor, { reviewId: r2.id, evidenceId: plan.id });
      await assessLeakage(actor, {
        leakageId: s.matter.id,
        reviewId: r2.id,
        totalAmount: CANONICAL.review2.leakage.total,
        unrecoverableAmount: CANONICAL.review2.leakage.unrecoverable,
        unrecoverableRationale: "Synthetic: one quarter of savings is lost under the revised plan (E-002)",
      });
      await issueRecommendation(actor, { reviewId: r2.id });
      await finaliseReview(actor, { reviewId: r2.id });
      // Management selects a different option from Cardaxia's recommendation, after it was issued.
      s.decision = await recordDecision(actor, {
        reviewId: r2.id,
        selectedScenarioId: s.scenarios["Delay 3 months"]!.id,
        decidedByPersonId: s.vco.id,
        decidedOn: today,
        rationale: "Synthetic: delay to align with the budget cycle",
      });
      return s;
    },

    /** 22–23: a DRAFT Value Change from Review #2 / the decision; V2's driver re-baselined and plan re-phased. */
    async change() {
      const { change, version } = await createValueChange(actor, {
        projectId: s.project.id,
        code: CANONICAL.valueChange.code,
        reason: CANONICAL.valueChange.reason,
        statedChangeAmount: CANONICAL.valueChange.stated,
        assuranceReviewId: s.review2.id,
        decisionId: s.decision.id,
      });
      s.change = change;
      s.v2 = version;
      const [vd01] = await db()
        .select({ id: schema.valueDriverVersion.id })
        .from(schema.valueDriverVersion)
        .where(
          and(
            eq(schema.valueDriverVersion.valueCaseVersionId, version.id),
            eq(schema.valueDriverVersion.valueDriverId, s.drivers[0]!),
          ),
        );
      await updateDriverVersion(actor, { driverVersionId: vd01!.id, financialValue: CANONICAL.valueChange.vd01To });
      for (const [asOf, value] of CANONICAL.valueChange.v2Plan)
        await setPlanPoint(actor, { versionId: version.id, asOf, value });
      return s;
    },

    /** 24: proposed for VCO authorisation (the stated change reconciles with V2's driver movement). */
    async proposeChange() {
      await proposeValueChange(actor, { changeId: s.change.id });
      return s;
    },

    /** 25: VCO authorisation — V2 becomes the Authorised Value Case in force; V1 is superseded, unchanged. */
    async authoriseChange() {
      const ev = await recordEvidence(actor, {
        projectId: s.project.id,
        code: "E-004",
        title: "VCO approval of VC-001",
      });
      await authoriseValueChange(actor, {
        changeId: s.change.id,
        authorisedByPersonId: s.vco.id,
        authorisedOn: today,
        authorisationEvidenceId: ev.id,
      });
      return s;
    },

    /** 35: Assurance continues against V2 (Review #3, on the day V2 was authorised). */
    async continueAssurance() {
      const r3 = await createReview(actor, { projectId: s.project.id, trigger: "ad_hoc", reviewDate: today });
      s.review3 = r3;
      await upsertValuePositions(actor, {
        reviewId: r3.id,
        positions: positions(CANONICAL.review3.forecast, CANONICAL.review3.realised),
      });
      for (const [asOf, value] of CANONICAL.review3.forecastPath)
        await setForecastPoint(actor, { reviewId: r3.id, asOf, value });
      await finaliseReview(actor, { reviewId: r3.id });
      return s;
    },
  };
}

/** The whole canonical journey (demo / seed): V1 → Review #2 → VC-001 → Authorised V2 → Review #3. */
export async function seedCanonicalJourney(actor: Actor, opts: { code: string; name: string }) {
  const j = canonicalJourney(actor, opts);
  await j.establish({ inherited: true });
  await j.assure();
  await j.change();
  await j.proposeChange();
  await j.authoriseChange();
  await j.continueAssurance();
  return j.state;
}
