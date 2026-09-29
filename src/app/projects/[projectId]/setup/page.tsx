import {
  addKeyDateAction,
  addStakeholderAction,
  recordDocumentAction,
  removeKeyDateAction,
  setValueBasisAction,
  setVcoAction,
  updateProjectDetailsAction,
  updateStakeholderAction,
} from "@/server/actions/setup";
import { getMobiliseWorkspace } from "@/server/queries/mobilise";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { PlainBadge } from "@/ui/components/badges";
import { Checkbox, DateField, FormGrid, Hidden, SelectField, TextArea, TextField } from "@/ui/components/fields";
import { Empty, Expander, KeyValues, Missing, Notice, Section, Table } from "@/ui/components/layout";
import { formatDate, formatPeriod } from "@/ui/format";
import { KEY_DATE_LABELS } from "@/ui/labels";
import { requireProject } from "@/ui/require";

export const metadata = { title: "Setup" };

export default async function SetupPage({ params }: PageProps<"/projects/[projectId]/setup">) {
  const { projectId } = await params;
  const { project, valueCase, valueBasisLocked } = await requireProject(projectId);
  const { stakeholders, keyDates, documents } = await getMobiliseWorkspace(projectId);
  const vco = stakeholders.find((s) => s.personId === valueCase.vcoPersonId);

  return (
    <>
      <p className="mb-4 max-w-3xl text-sm text-slate-600">
        Mobilise: just enough to establish the engagement and proceed to Re-Qualification.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Project details">
          <ActionForm action={updateProjectDetailsAction}>
            <Hidden name="projectId" value={projectId} />
            <div className="space-y-3">
              <TextField name="name" label="Project name" required defaultValue={project.name} />
              <TextArea name="context" label="Project context" rows={4} defaultValue={project.context} />
              <SubmitButton>Save details</SubmitButton>
            </div>
          </ActionForm>
        </Section>

        <Section
          id="value-basis"
          title="Value Basis"
          description="The common basis on which every financial Value Driver is expressed."
        >
          {valueBasisLocked ? (
            <>
              <Notice tone="locked" title="Locked">
                The Value Basis and currency cannot change once a Value Case version has been proposed or authorised.
              </Notice>
              <KeyValues
                items={[
                  ["Currency", project.currency],
                  ["Basis", project.valueBasisDescription],
                  ["Period", formatPeriod(project.valuePeriodStart, project.valuePeriodEnd)],
                ]}
              />
            </>
          ) : (
            <ActionForm action={setValueBasisAction} testId="value-basis-form">
              <Hidden name="projectId" value={projectId} />
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  Currency: <strong>{project.currency}</strong> (set at project creation)
                </p>
                <TextField
                  name="valueBasisDescription"
                  label="Basis description"
                  required
                  defaultValue={project.valueBasisDescription}
                  placeholder='e.g. "Annual run-rate benefit at full implementation"'
                />
                <FormGrid>
                  <DateField name="valuePeriodStart" label="Period start" defaultValue={project.valuePeriodStart} />
                  <DateField name="valuePeriodEnd" label="Period end" defaultValue={project.valuePeriodEnd} />
                </FormGrid>
                <SubmitButton>Save Value Basis</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Section>
      </div>

      <Section
        id="stakeholders"
        title="Stakeholders"
        description="Client people involved in the engagement. The Value Case Owner (VCO) is the only role that can authorise the Value Case."
      >
        <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm" data-testid="vco-panel">
          <span className="font-semibold">Value Case Owner: </span>
          {vco ? (
            <span data-testid="vco-name">
              {vco.name}
              {vco.title ? `, ${vco.title}` : ""}
              {vco.organisation ? ` (${vco.organisation})` : ""}
            </span>
          ) : (
            <Missing>Not nominated</Missing>
          )}
        </div>

        {stakeholders.length === 0 ? (
          <Empty>No stakeholders recorded yet.</Empty>
        ) : (
          <div className="space-y-2">
            {stakeholders.map((s) => (
              <Expander
                key={s.personId}
                testId="stakeholder"
                summary={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span>{s.name}</span>
                    {s.personId === valueCase.vcoPersonId && <PlainBadge tone="emerald">VCO</PlainBadge>}
                    <span className="font-normal text-slate-500">
                      {[s.title, s.organisation, s.roleDescription].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                }
              >
                <ActionForm action={updateStakeholderAction}>
                  <Hidden name="projectId" value={projectId} />
                  <Hidden name="personId" value={s.personId} />
                  <FormGrid cols={3}>
                    <TextField name="name" label="Name" required defaultValue={s.name} />
                    <TextField name="title" label="Title" defaultValue={s.title} />
                    <TextField name="organisation" label="Organisation" defaultValue={s.organisation} />
                    <TextField name="email" label="Email" type="email" defaultValue={s.email} />
                    <TextField name="roleDescription" label="Role on this project" defaultValue={s.roleDescription} />
                  </FormGrid>
                  <div className="mt-3">
                    <SubmitButton variant="secondary">Save stakeholder</SubmitButton>
                  </div>
                </ActionForm>
              </Expander>
            ))}
          </div>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Expander summary="Add stakeholder" open={stakeholders.length === 0} testId="add-stakeholder">
            <ActionForm action={addStakeholderAction} resetOnSuccess testId="add-stakeholder-form">
              <Hidden name="projectId" value={projectId} />
              <FormGrid>
                <TextField name="name" label="Name" required />
                <TextField name="title" label="Title" />
                <TextField name="organisation" label="Organisation" />
                <TextField name="email" label="Email" type="email" />
              </FormGrid>
              <div className="mt-3 space-y-3">
                <TextField
                  name="roleDescription"
                  label="Role on this project"
                  placeholder="e.g. Programme Sponsor, AVO for Retention"
                />
                <Checkbox name="makeVco" label="This person is the Value Case Owner" />
                <SubmitButton>Add stakeholder</SubmitButton>
              </div>
            </ActionForm>
          </Expander>

          {stakeholders.length > 0 && (
            <Expander summary={vco ? "Change Value Case Owner" : "Nominate Value Case Owner"} open={!vco}>
              <ActionForm action={setVcoAction} testId="set-vco-form">
                <Hidden name="projectId" value={projectId} />
                <div className="space-y-3">
                  <SelectField
                    name="personId"
                    label="Value Case Owner"
                    required
                    defaultValue={valueCase.vcoPersonId}
                    placeholder="— Choose stakeholder —"
                    options={stakeholders.map((s) => ({ value: s.personId, label: s.name }))}
                  />
                  <SubmitButton>Set VCO</SubmitButton>
                </div>
              </ActionForm>
            </Expander>
          )}
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section id="key-dates" title="Key dates" description="Kick-off and Go-Live drive later mandatory reviews.">
          {keyDates.length === 0 ? (
            <Empty>No key dates yet.</Empty>
          ) : (
            <Table>
              <tbody>
                {keyDates.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium">{d.kind === "other" ? d.label : KEY_DATE_LABELS[d.kind]}</td>
                    <td>{formatDate(d.date)}</td>
                    <td className="text-slate-500">{d.notes}</td>
                    <td className="text-right">
                      <ActionForm action={removeKeyDateAction} confirm="Remove this key date?" showSuccess={false}>
                        <Hidden name="projectId" value={projectId} />
                        <Hidden name="keyDateId" value={d.id} />
                        <SubmitButton variant="danger">Remove</SubmitButton>
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <div className="mt-3">
            <Expander summary="Add key date">
              <ActionForm action={addKeyDateAction} resetOnSuccess>
                <Hidden name="projectId" value={projectId} />
                <FormGrid>
                  <SelectField
                    name="kind"
                    label="Type"
                    required
                    defaultValue="kickoff"
                    options={Object.entries(KEY_DATE_LABELS).map(([value, label]) => ({ value, label }))}
                  />
                  <DateField name="date" label="Date" required />
                  <TextField name="label" label="Label" hint="Required for “Other”" />
                  <TextField name="notes" label="Notes" />
                </FormGrid>
                <div className="mt-3">
                  <SubmitButton>Add key date</SubmitButton>
                </div>
              </ActionForm>
            </Expander>
          </div>
        </Section>

        <Section
          id="documents"
          title="Document references"
          description="Where key documents live (URL, SharePoint path, or a description). Files are not uploaded in this phase."
        >
          {documents.length === 0 ? (
            <Empty>No document references yet.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {documents.map(({ document: d, sourcePersonName }) => (
                <li key={d.id} className="rounded border border-slate-200 p-2" data-testid="document">
                  <p className="font-medium">{d.title}</p>
                  <p className="text-xs text-slate-500">
                    {d.sourceDescription}
                    {sourcePersonName ? ` · from ${sourcePersonName}` : ""}
                    {d.receivedOn ? ` · received ${formatDate(d.receivedOn)}` : ""}
                  </p>
                  {d.uri && <p className="truncate text-xs text-sky-800">{d.uri}</p>}
                  {d.sha256 && <p className="truncate font-mono text-xs text-slate-400">sha256 {d.sha256}</p>}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <Expander summary="Add document reference" testId="add-document">
              <ActionForm action={recordDocumentAction} resetOnSuccess testId="add-document-form">
                <Hidden name="projectId" value={projectId} />
                <div className="space-y-3">
                  <TextField name="title" label="Title" required placeholder="e.g. Original Business Case v3.2" />
                  <TextField
                    name="sourceDescription"
                    label="Source"
                    required
                    placeholder="e.g. Provided by client PMO"
                  />
                  <TextField name="uri" label="Location / URL" placeholder="https://… or SharePoint path" />
                  <FormGrid>
                    <SelectField
                      name="sourcePersonId"
                      label="Provided by"
                      placeholder="—"
                      options={stakeholders.map((s) => ({ value: s.personId, label: s.name }))}
                    />
                    <DateField name="receivedOn" label="Received on" />
                    <TextField name="originalFilename" label="File name" />
                    <TextField name="sha256" label="SHA-256" hint="Optional file hash" />
                  </FormGrid>
                  <SubmitButton>Record document reference</SubmitButton>
                </div>
              </ActionForm>
            </Expander>
          </div>
        </Section>
      </div>
    </>
  );
}
