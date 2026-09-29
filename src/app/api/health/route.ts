import { getDbHealth } from "@/server/queries/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getDbHealth();
  return Response.json(
    health.ok ? { status: "ok", migrationsApplied: health.migrationsApplied } : { status: "error" },
    { status: health.ok ? 200 : 503 },
  );
}
