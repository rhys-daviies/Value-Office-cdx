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
  rejected: "Rejected",
  withdrawn: "Withdrawn",
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

export const TRIGGER_LABELS = {
  kickoff: "Kick-off",
  go_live: "Go-Live",
  six_month: "Six-month",
  material_evidence_change: "Material evidence change",
  ad_hoc: "Ad hoc",
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
  "assurance.createReview": "Assurance Review opened",
  "assurance.updateReview": "Assurance Review updated",
  "assurance.upsertValuePositions": "Value Positions saved",
  "assurance.linkEvidence": "Evidence linked to review",
  "assurance.unlinkEvidence": "Evidence unlinked from review",
  "assurance.finaliseReview": "Assurance Review finalised",
  "leakage.create": "Value Leakage identified",
  "leakage.update": "Value Leakage updated",
  "leakage.setDrivers": "Leakage affected drivers updated",
  "leakage.assess": "Value Leakage assessed",
  "options.upsertScenario": "Scenario saved",
  "options.removeScenario": "Scenario removed",
  "options.saveRecommendation": "Recommendation drafted",
  "options.issueRecommendation": "Cardaxia recommendation issued",
  "options.recordDecision": "Client decision recorded",
  "valueChange.create": "Value Change opened",
  "valueChange.update": "Value Change updated",
  "valueChange.propose": "Value Change proposed to the VCO",
  "valueChange.return": "Value Change returned for revision",
  "valueChange.authorise": "Value Change authorised by the VCO",
  "valueChange.reject": "Value Change rejected by the VCO",
  "valueChange.withdraw": "Value Change withdrawn",
  "reports.issue": "Report issued",
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
  assurance_review: "Value Assurance",
  value_position: "Value Assurance",
  value_leakage: "Value Leakage",
  value_leakage_driver: "Value Leakage",
  leakage_assessment: "Value Leakage",
  scenario: "Options",
  recommendation: "Recommendation",
  decision: "Decision",
  value_change: "Value Change",
  report_issue: "Reports",
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
  assurance_review: "Assurance Review",
  value_position: "Value Position",
  value_leakage: "Value Leakage item",
  value_leakage_driver: "Leakage affected driver",
  leakage_assessment: "Leakage assessment",
  scenario: "Scenario",
  recommendation: "Recommendation",
  decision: "Client decision",
  value_change: "Value Change",
  report_issue: "Issued report",
};
export const SCENARIO_KIND_LABELS = {
  current: "Current trajectory",
  recommended: "Recommended",
  alternative: "Alternative",
  no_action: "No action",
} as const;
