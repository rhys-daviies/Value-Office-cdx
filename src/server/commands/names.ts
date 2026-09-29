// Every authoritative mutation runs under one of these names. The name is
// written to audit_event.command. Names used by DB triggers (state transitions)
// are also hard-coded in drizzle/0001_integrity_and_audit.sql — keep in sync.
export const COMMANDS = {
  ensureUser: "user.ensure",
  createClient: "client.create",
  createProject: "project.create",
  setProjectValueBasis: "project.setValueBasis",
  addKeyDate: "project.addKeyDate",
  removeKeyDate: "project.removeKeyDate",
  updateProjectDetails: "project.updateDetails",
  addStakeholder: "stakeholder.add",
  updateStakeholder: "stakeholder.update",
  setValueCaseOwner: "valueCase.setOwner",
  recordDocumentReference: "document.recordReference",
  recordEvidence: "evidence.record",
  updateEvidence: "evidence.update",
  createInformationRequest: "informationRequest.create",
  addInformationRequestItem: "informationRequest.addItem",
  updateInformationRequestItem: "informationRequest.updateItem",
  removeInformationRequestItem: "informationRequest.removeItem",
  issueInformationRequest: "informationRequest.issue",
  closeInformationRequest: "informationRequest.close",
  createInheritedBusinessCase: "valueCase.createInheritedBusinessCase",
  recordInheritedBusinessCase: "valueCase.recordInheritedBusinessCase", // trigger-checked
  createDraftVersion: "valueCase.createDraftVersion",
  updateVersionDetails: "valueCase.updateVersionDetails",
  addValueDriver: "valueCase.addValueDriver",
  updateDriverVersion: "valueCase.updateDriverVersion",
  addAssumption: "valueCase.addAssumption",
  updateAssumption: "valueCase.updateAssumption",
  removeAssumption: "valueCase.removeAssumption",
  removeValueDriver: "valueCase.removeValueDriver",
  unlinkEvidence: "valueCase.unlinkEvidence",
  linkEvidence: "valueCase.linkEvidence",
  proposeVersion: "valueCase.proposeVersion", // trigger-checked
  returnVersionToDraft: "valueCase.returnVersionToDraft", // trigger-checked
  authoriseInitialVersion: "valueCase.authoriseInitialVersion", // trigger-checked
  createAssuranceReview: "assurance.createReview",
  updateAssuranceReview: "assurance.updateReview",
  upsertValuePositions: "assurance.upsertValuePositions",
  linkAssuranceEvidence: "assurance.linkEvidence",
  unlinkAssuranceEvidence: "assurance.unlinkEvidence",
  finaliseAssuranceReview: "assurance.finaliseReview", // trigger-checked
} as const;

export type CommandName = (typeof COMMANDS)[keyof typeof COMMANDS];
