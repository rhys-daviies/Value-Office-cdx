import { getCurrentActor, NotAuthenticatedError } from "@/server/auth/actor";
import { getDbHealth } from "@/server/queries/health";

export const metadata = { title: "Status" };

// Operational check: the app boots, reaches the database and resolves an actor.
export default async function StatusPage() {
  const health = await getDbHealth();
  let actor: string;
  try {
    actor = health.ok ? (await getCurrentActor()).email : "unavailable (database down)";
  } catch (err) {
    if (!(err instanceof NotAuthenticatedError)) throw err;
    actor = `not signed in — ${err.message}`;
  }
  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">System status</h1>
      <dl className="mt-6 grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
        <dt className="text-slate-500">Database</dt>
        <dd data-testid="db-status">
          {health.ok
            ? `connected — ${health.database} (PostgreSQL ${health.serverVersion}), ${health.migrationsApplied} migrations`
            : `error — ${health.error}`}
        </dd>
        <dt className="text-slate-500">Consultant</dt>
        <dd data-testid="status-actor">{actor}</dd>
      </dl>
    </div>
  );
}
