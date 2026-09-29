// Every authoritative mutation runs under one of these names. The name is
// written to audit_event.command. Names used by DB triggers (state transitions)
// are also hard-coded in drizzle/0001_integrity_and_audit.sql — keep in sync.
export const COMMANDS = {
  ensureUser: "user.ensure",
  createClient: "client.create",
  createProject: "project.create",
  setProjectValueBasis: "project.setValueBasis",
  addKeyDate: "project.addKeyDate",
  addStakeholder: "stakeholder.add",
  setValueCaseOwner: "valueCase.setOwner",
  recordDocumentReference: "document.recordReference",
  recordEvidence: "evidence.record",
  createInformationRequest: "informationRequest.create",
  addInformationRequestItem: "informationRequest.addItem",
  createInheritedBusinessCase: "valueCase.createInheritedBusinessCase",
  recordInheritedBusinessCase: "valueCase.recordInheritedBusinessCase", // trigger-checked
  createDraftVersion: "valueCase.createDraftVersion",
  addValueDriver: "valueCase.addValueDriver",
  updateDriverVersion: "valueCase.updateDriverVersion",
  addAssumption: "valueCase.addAssumption",
  linkEvidence: "valueCase.linkEvidence",
  proposeVersion: "valueCase.proposeVersion", // trigger-checked
  returnVersionToDraft: "valueCase.returnVersionToDraft", // trigger-checked
  authoriseInitialVersion: "valueCase.authoriseInitialVersion", // trigger-checked
} as const;

export type CommandName = (typeof COMMANDS)[keyof typeof COMMANDS];
