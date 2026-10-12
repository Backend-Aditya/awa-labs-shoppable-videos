import prisma from "../db.server";

// Render health check (Settings > Health Check Path: /healthz). Confirms the
// process is serving and can reach the database; anything else is a 503 so
// Render holds traffic on the previous deploy instead of routing to a broken
// one.
export const loader = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Health check failed: database unreachable", error);
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
};
