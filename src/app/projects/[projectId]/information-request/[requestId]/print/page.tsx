import { notFound, redirect } from "next/navigation";

import { requireConsultant } from "@/server/auth/actor";
import { reportPreviewHref } from "@/ui/reports/routes";
import { isUuid } from "@/ui/require";

// Superseded by the Information Request report (preview → issue → PDF).
export default async function InformationRequestPrintPage({
  params,
}: PageProps<"/projects/[projectId]/information-request/[requestId]/print">) {
  await requireConsultant();
  const { projectId, requestId } = await params;
  if (!isUuid(projectId) || !isUuid(requestId)) notFound();
  redirect(reportPreviewHref(projectId, "information_request", requestId));
}
