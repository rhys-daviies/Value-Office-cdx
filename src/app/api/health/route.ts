import { getDbHealth } from "@/server/queries/health";

export const dynamic = "force-dynamic";

/** Public liveness probe: reports only whether the app and its database are up. */
export async function GET() {
  const health = await getDbHealth();
  return Response.json(
    { status: health.ok ? "ok" : "error", database: health.ok ? "ok" : "unreachable" },
    { status: health.ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
