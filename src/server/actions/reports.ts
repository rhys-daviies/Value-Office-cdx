"use server";

import { redirect } from "next/navigation";

import { REPORT_TYPES, type ReportType } from "@/domain/statuses";
import { issueReport } from "@/server/reports/issue";

import { bool, FormInputError, required } from "./form";
import { perform } from "./perform";
import type { ActionState } from "./state";

export async function issueReportAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const projectId = required(fd, "projectId");
  let issueId: string | undefined;
  const state = await perform(projectId, async (actor) => {
    if (!bool(fd, "confirm")) {
      throw new FormInputError("confirm", "Confirm that you have reviewed the report before issuing it");
    }
    const type = required(fd, "type") as ReportType;
    if (!REPORT_TYPES.includes(type)) throw new FormInputError("type", "Unknown report type");
    const issue = await issueReport(actor, { type, projectId, subjectId: required(fd, "subjectId") });
    issueId = issue.id;
    return `Issued ${issue.title} (issue ${issue.issueNumber})`;
  });
  if (state.status === "ok" && issueId) redirect(`/projects/${projectId}/reports/issued/${issueId}`);
  return state;
}
