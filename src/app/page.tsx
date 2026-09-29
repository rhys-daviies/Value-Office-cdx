import { connection } from "next/server";

import { getCurrentActor, NotAuthenticatedError } from "@/server/auth/actor";
import { getDbHealth } from "@/server/queries/health";

// Minimal shell: proves the app boots, reaches the database and resolves an actor.
export default async function Home() {
  await connection();
  const health = await getDbHealth();
  let actor: string;
  try {
    actor = health.ok ? (await getCurrentActor()).email : "unavailable (database down)";
  } catch (err) {
    if (!(err instanceof NotAuthenticatedError)) throw err;
    actor = `not signed in — ${err.message}`;
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Cardaxia Value Office</h1>
      <p className="mt-1 text-sm opacity-70">Phase 1 foundation</p>
      <dl className="mt-8 grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
        <dt className="opacity-70">Database</dt>
        <dd data-testid="db-status">
          {health.ok
            ? `connected — ${health.database} (PostgreSQL ${health.serverVersion}), ${health.migrationsApplied} migrations`
            : `error — ${health.error}`}
        </dd>
        <dt className="opacity-70">Consultant</dt>
        <dd data-testid="actor">{actor}</dd>
      </dl>
    </main>
  );
}
