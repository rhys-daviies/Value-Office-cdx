import type { EvidenceStatus, QualificationStatus, VersionStatus } from "@/domain/statuses";

// Consultant-facing labels. Presentation only — no methodology lives here.

export const QUALIFICATION_LABELS: Record<QualificationStatus, string> = {
  unqualified: "Unqualified",
  partially_qualified: "Partially qualified",
  qualified: "Qualified",
};

export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  unevidenced: "Unevidenced",
  partially_evidenced: "Partially evidenced",
  evidenced: "Evidenced",
};

export const VERSION_STATUS_LABELS: Record<VersionStatus, string> = {
  draft: "Draft",
  recorded: "Recorded",
  proposed: "Proposed",
  authorised: "Authorised",
  superseded: "Superseded",
};

export const IR_ITEM_STATUS_LABELS = {
  open: "Open",
  partially_received: "Partial",
  received: "Received",
  not_available: "Not available",
} as const;

export const IR_STATUS_LABELS = { draft: "Draft", issued: "Issued", closed: "Closed" } as const;

export const KEY_DATE_LABELS = {
  kickoff: "Kick-off",
  go_live: "Go-Live",
  six_month_review: "Six-month review",
  other: "Other",
} as const;

export const COMMAND_LABELS: Record<string, string> = {
  "user.ensure": "Consultant account created",
  "client.create": "Client created",
  "project.create": "Project created",
  "project.setValueBasis": "Value Basis set",
  "project.updateDetails": "Project details updated",
  "project.addKeyDate": "Key date added",
  "project.removeKeyDate": "Key date removed",
  "stakeholder.add": "Stakeholder added",
  "stakeholder.update": "Stakeholder updated",
  "valueCase.setOwner": "Value Case Owner nominated",
  "document.recordReference": "Document reference recorded",
  "evidence.record": "Evidence recorded",
  "evidence.update": "Evidence updated",
  "informationRequest.create": "Information Request created",
  "informationRequest.addItem": "Request item added",
  "informationRequest.updateItem": "Request item updated",
  "informationRequest.removeItem": "Request item removed",
  "informationRequest.issue": "Information Request issued",
  "informationRequest.close": "Information Request closed",
  "valueCase.createInheritedBusinessCase": "Inherited Business Case (V0) started",
  "valueCase.recordInheritedBusinessCase": "Inherited Business Case (V0) recorded",
  "valueCase.createDraftVersion": "Draft Value Case version created",
  "valueCase.updateVersionDetails": "Version details updated",
  "valueCase.addValueDriver": "Value Driver added",
  "valueCase.updateDriverVersion": "Value Driver updated",
  "valueCase.removeValueDriver": "Value Driver removed",
  "valueCase.addAssumption": "Assumption added",
  "valueCase.updateAssumption": "Assumption updated",
  "valueCase.removeAssumption": "Assumption removed",
  "valueCase.linkEvidence": "Evidence linked",
  "valueCase.unlinkEvidence": "Evidence unlinked",
  "valueCase.proposeVersion": "Value Case proposed for authorisation",
  "valueCase.returnVersionToDraft": "Proposed Value Case returned to draft",
  "valueCase.authoriseInitialVersion": "VCO authorisation recorded",
};

export const TABLE_AREAS: Record<string, string> = {
  client: "Project",
  project: "Project",
  key_date: "Project",
  person: "Stakeholders",
  project_stakeholder: "Stakeholders",
  value_case: "Value Case",
  document: "Evidence",
  evidence: "Evidence",
  evidence_link: "Evidence",
  information_request: "Information Request",
  information_request_item: "Information Request",
  value_case_version: "Value Case",
  value_driver: "Value Case",
  value_driver_version: "Value Case",
  assumption: "Value Case",
};

export const TABLE_LABELS: Record<string, string> = {
  client: "Client",
  project: "Project",
  key_date: "Key date",
  person: "Person",
  project_stakeholder: "Stakeholder",
  value_case: "Value Case",
  document: "Document",
  evidence: "Evidence",
  evidence_link: "Evidence link",
  information_request: "Information Request",
  information_request_item: "Request item",
  value_case_version: "Value Case version",
  value_driver: "Value Driver identity",
  value_driver_version: "Value Driver",
  assumption: "Assumption",
};
