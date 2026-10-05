import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { listReels, upsertReel } from "../models/reel.server";
import { isCronAuthorized, isReelDue } from "../models/scheduled-publish.server";

// Runs on a schedule (see .github/workflows/publish-scheduled-reels.yml —
// this app has no background worker of its own, so a free external cron
// hitting this endpoint is the whole scheduling mechanism). For every
// installed shop, publishes any reel that isReelDue() says is ready.
//
// Authenticated by a shared secret (isCronAuthorized) rather than a
// merchant session, since there's no merchant request driving this — it's
// called by GitHub Actions, not a browser.
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!isCronAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = Date.now();
  // Offline sessions are the one-per-shop, long-lived tokens this app
  // already stores for every install (see shopify.server.ts's future flag
  // and PrismaSessionStorage) — online sessions are per-staff-member and
  // not what we want here.
  const offlineSessions = await prisma.session.findMany({ where: { isOnline: false } });
  const shopsSeen = new Set<string>();

  let shopsChecked = 0;
  let reelsPublished = 0;
  const errors: string[] = [];

  for (const session of offlineSessions) {
    if (shopsSeen.has(session.shop)) continue;
    shopsSeen.add(session.shop);
    shopsChecked += 1;

    try {
      const { admin } = await unauthenticated.admin(session.shop);
      const reels = await listReels(admin, 50);

      for (const reel of reels) {
        if (!isReelDue(reel, now)) continue;
        await upsertReel(admin, reel.handle, reel.title, true, {
          ...reel.config,
          publishAt: undefined,
        });
        reelsPublished += 1;
      }
    } catch (e) {
      // One shop's failure (revoked token, rate limit, etc.) shouldn't stop
      // the rest from being checked — cron runs again in a few minutes
      // regardless, so a single missed cycle for one shop is low-stakes.
      errors.push(`${session.shop}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return Response.json({ shopsChecked, reelsPublished, errors });
};
