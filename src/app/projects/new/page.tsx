import { createProjectAction } from "@/server/actions/projects";
import { listClients } from "@/server/queries/projects";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { DateField, FormGrid, SelectField, TextArea, TextField } from "@/ui/components/fields";
import { PageHeader, Section, TextLink } from "@/ui/components/layout";

export const metadata = { title: "Create project" };

export default async function NewProjectPage() {
  const clients = await listClients();
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Create project"
        description={
          <>
            Establish the engagement. Only client, project name and currency are required — everything else can be added
            in Setup as it becomes known. <TextLink href="/projects">Back to projects</TextLink>
          </>
        }
      />
      <ActionForm action={createProjectAction} testId="create-project-form">
        <Section title="Client and project">
          <FormGrid>
            <SelectField
              name="clientId"
              label="Client"
              placeholder="— New client (enter name) —"
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
            />
            <TextField name="newClientName" label="New client name" hint="Only if the client is not listed" />
            <TextField name="name" label="Project name" required />
            <TextField name="code" label="Project code" hint="Optional — generated from the name if blank" />
          </FormGrid>
          <div className="mt-3">
            <TextArea
              name="context"
              label="Project context"
              rows={3}
              placeholder="What the programme is and why the Value Office is engaged"
            />
          </div>
        </Section>

        <Section
          title="Value Basis"
          description="Every financial Value Driver in this project is expressed on this common basis. It can be set later, but must exist before V1 is proposed, and is locked once proposed."
        >
          <FormGrid cols={3}>
            <TextField
              name="currency"
              label="Currency"
              required
              defaultValue=""
              placeholder="e.g. NZD, AUD, USD"
              hint="ISO code — one per project"
            />
            <DateField name="valuePeriodStart" label="Period start" />
            <DateField name="valuePeriodEnd" label="Period end" />
          </FormGrid>
          <div className="mt-3">
            <TextField
              name="valueBasisDescription"
              label="Value Basis description"
              placeholder='e.g. "Cumulative financial benefit over FY27–FY30"'
            />
          </div>
        </Section>

        <Section title="Key dates" description="Optional — add more in Setup.">
          <FormGrid>
            <DateField name="kickoffDate" label="Kick-off" />
            <DateField name="goLiveDate" label="Go-Live (if known)" />
          </FormGrid>
        </Section>

        <SubmitButton>Create project</SubmitButton>
      </ActionForm>
    </div>
  );
}
