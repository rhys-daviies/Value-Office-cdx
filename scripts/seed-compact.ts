import { eq } from "drizzle-orm";

import {
  seedCompactAuthorised,
  seedCompactDecided,
  seedCompactDecision,
  seedCompactEvolution,
  seedCompactOperating,
  seedCompactTrajectory,
  seedCompactTrajectoryDraft,
} from "@/fixtures/compact";
import { seedCanonicalJourney } from "@/fixtures/canonical";
import { ensureUser } from "@/server/commands/users";
import { closeDb, db, schema } from "@/server/db/client";

import { loadLocalEnv } from "./load-env";

// Seeds the synthetic "Assurance Compact", "Response Compact", "Matters Compact", "Evidence Compact", "Drivers Compact", "Office Compact", "Evolution Compact", "Decision Compact", "Trajectory Compact", "Trajectory Draft" and "Trajectory Executive" projects (Authorised V1; Drivers Compact adds a decided review, Office Compact live Assurance work, Evolution Compact V1→V2 governed history, Decision Compact a decided review with four options). Idempotent by code.
loadLocalEnv();

const email = process.env.VO_DEV_USER_EMAIL ?? "consultant@cardaxia.ai";
try {
  const actor = await ensureUser(email, process.env.VO_DEV_USER_NAME ?? email);
  // Identical synthetic engagements so the Phase 2, Phase 3, Phase 4D.1–4D.6 journeys stay independent.
  for (const [code, name] of [
    ["COMPACT", "Assurance Compact"],
    ["RESPONSE", "Response Compact"],
    ["MATTERS", "Matters Compact"],
    ["EVIDENCE", "Evidence Compact"],
    ["DRIVERS", "Drivers Compact"],
    ["OFFICE", "Office Compact"],
    ["WORKSPACE", "Workspace Compact"],
    ["RECOMMEND", "Recommendation Compact"],
    ["IMPACT", "Impact Compact"],
    ["EVOLVE", "Evolution Compact"],
    ["DECIDE", "Decision Compact"],
    ["TRAJ", "Trajectory Compact"],
    ["TRAJD", "Trajectory Draft"],
    ["TRAJX", "Trajectory Executive"],
    ["CANON", "Canonical Value Journey"],
  ] as const) {
    const [existing] = await db().select().from(schema.project).where(eq(schema.project.code, code));
    if (existing) {
      console.log(`${name} already seeded; nothing to do.`);
    } else {
      if (code === "CANON") {
        await seedCanonicalJourney(actor, { code, name });
        console.log(
          `Seeded ${name}: V0 $32.0m → V1 $30.0m → Reviews #1–#2 → VC-001 −$3.0m (adopted Delay path) → V2 $27.0m → Review #3`,
        );
      } else if (code === "TRAJX") {
        await seedCompactTrajectory(actor, { code, name, formal: true });
        console.log(
          `Seeded ${name}: finalised reviews 31 Mar and 30 Sep 2026; three option paths; client selects Delay`,
        );
      } else if (code === "TRAJ") {
        await seedCompactTrajectory(actor, { code, name });
        console.log(
          `Seeded ${name}: Authorised V1 $30m with plan milestones; draft review with forecast and option paths`,
        );
      } else if (code === "TRAJD") {
        await seedCompactTrajectoryDraft(actor, { code, name });
        console.log(`Seeded ${name}: draft V1 $30m, unclassified, project Value Period set`);
      } else if (code === "DECIDE") {
        await seedCompactDecision(actor, { code, name });
        console.log(`Seeded ${name}: Review #1 finalised with four options, recommendation ≠ client selection`);
      } else if (code === "EVOLVE") {
        await seedCompactEvolution(actor, { code, name });
        console.log(`Seeded ${name}: V0, Authorised V1 → V2, three finalised reviews, pending VC-002`);
      } else if (code === "OFFICE" || code === "WORKSPACE") {
        await seedCompactOperating(actor, { code, name });
        console.log(`Seeded ${name}: Authorised V1, Review #1 finalised, live Continuous Assurance`);
      } else if (code === "DRIVERS" || code === "IMPACT") {
        await seedCompactDecided(actor, { code, name });
        console.log(`Seeded ${name}: Authorised V1, Review #1 finalised with a client decision`);
      } else {
        await seedCompactAuthorised(actor, { code, name });
        console.log(`Seeded ${name}: Authorised V1, no Assurance Reviews`);
      }
    }
  }
} finally {
  await closeDb();
}
