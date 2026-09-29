import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";

import { closeDb, db, schema } from "@/server/db/client";
import { buildReport } from "@/server/queries/reports";
import { htmlToPdf } from "@/server/reports/pdf";
import { renderReportDocument } from "@/ui/reports/render";

import { loadLocalEnv } from "./load-env";

// PDF generation smoke test: renders Horizon's Re-Qualification Report, Value Assurance
// Report and VC-002 Notice to PDF from DATABASE_URL. Read-only — nothing is issued or stored.
loadLocalEnv();

try {
  const [project] = await db().select().from(schema.project).where(eq(schema.project.code, "HORIZON"));
  if (!project) throw new Error("Project Horizon is not seeded (npm run db:seed:horizon)");
  const [v1] = await db()
    .select()
    .from(schema.valueCaseVersion)
    .where(and(eq(schema.valueCaseVersion.projectId, project.id), eq(schema.valueCaseVersion.versionNumber, 1)));
  const [review] = await db()
    .select()
    .from(schema.assuranceReview)
    .where(eq(schema.assuranceReview.projectId, project.id));
  const [change] = await db().select().from(schema.valueChange).where(eq(schema.valueChange.projectId, project.id));

  const out = mkdtempSync(path.join(tmpdir(), "vo-report-smoke-"));
  const subjects = [
    ["requalification", v1!.id],
    ["assurance", review!.id],
    ["value_change_notice", change!.id],
  ] as const;
  for (const [type, id] of subjects) {
    const built = await buildReport(type, project.id, id);
    if (!built) throw new Error(`No ${type} report for Horizon`);
    const pdf = await htmlToPdf(renderReportDocument(built.model, { state: "preview" }), `${type} smoke test`);
    if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error(`${type}: output is not a PDF`);
    const file = path.join(out, `${type}.pdf`);
    writeFileSync(file, pdf);
    console.log(`✓ ${type}: ${pdf.byteLength} bytes → ${file}`);
  }
} finally {
  await closeDb();
}
