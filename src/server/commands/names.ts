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
  createLeakage: "leakage.create",
  updateLeakage: "leakage.update",
  setLeakageDrivers: "leakage.setDrivers",
  assessLeakage: "leakage.assess",
  upsertScenario: "options.upsertScenario",
  removeScenario: "options.removeScenario",
  saveRecommendation: "options.saveRecommendation",
  issueRecommendation: "options.issueRecommendation", // trigger-checked
  recordDecision: "options.recordDecision",
  createValueChange: "valueChange.create", // trigger-checked
  updateValueChange: "valueChange.update",
  proposeValueChange: "valueChange.propose", // trigger-checked
  returnValueChange: "valueChange.return", // trigger-checked
  authoriseValueChange: "valueChange.authorise", // trigger-checked
  rejectValueChange: "valueChange.reject", // trigger-checked
  withdrawValueChange: "valueChange.withdraw", // trigger-checked
  issueReport: "reports.issue", // trigger-checked
  setPassword: "user.setPassword", // trigger-checked
  disableUser: "user.disable", // trigger-checked
  signIn: "auth.signIn", // trigger-checked
  signOut: "auth.signOut", // trigger-checked
} as const;

export type CommandName = (typeof COMMANDS)[keyof typeof COMMANDS];
