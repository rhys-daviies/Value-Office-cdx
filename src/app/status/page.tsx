import { requireConsultant } from "@/server/auth/actor";
import { getDbHealth } from "@/server/queries/health";

export const metadata = { title: "Status" };

// Operational check for signed-in consultants: database reachable, migrations applied, identity.
export default async function StatusPage() {
  const consultant = await requireConsultant();
  const health = await getDbHealth();
  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">System status</h1>
      <dl className="mt-6 grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
        <dt className="text-slate-500">Database</dt>
        <dd data-testid="db-status">
          {health.ok ? `connected — ${health.migrationsApplied} migrations applied` : "error — see server logs"}
        </dd>
        <dt className="text-slate-500">Consultant</dt>
        <dd data-testid="status-actor">{consultant.email}</dd>
      </dl>
    </div>
  );
}
