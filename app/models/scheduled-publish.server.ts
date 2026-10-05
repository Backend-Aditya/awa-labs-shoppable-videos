import { timingSafeEqual } from "node:crypto";
import type { Reel } from "./reel.server";

// Compares the cron endpoint's Authorization header against CRON_SECRET.
// Refuses to authorize anything when the secret isn't configured — a
// missing env var must fail closed, not silently accept every caller.
export function isCronAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

// A reel is due to auto-publish when it has a schedule, that time has
// passed, and it isn't already published (manually publishing always wins
// over a pending schedule — see ReelConfig.publishAt's doc comment).
export function isReelDue(reel: Pick<Reel, "published" | "config">, now: number): boolean {
  if (reel.published) return false;
  const publishAt = reel.config.publishAt;
  if (!publishAt) return false;
  return new Date(publishAt).getTime() <= now;
}
