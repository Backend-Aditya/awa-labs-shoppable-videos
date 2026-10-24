import prisma from "../db.server";

// Fly health check (fly.toml, [[http_service.checks]] path /healthz).
// Confirms the process is serving and can reach the database; anything else
// is a 503 so Fly keeps traffic off a machine that can't serve.
export const loader = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Health check failed: database unreachable", error);
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
};
