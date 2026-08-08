import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Default "lazy" mode fetches an extra /__manifest request the first time
  // the client navigates to a route it doesn't already know about — this
  // dev environment's tunnel/proxy has shown repeated network instability
  // (WebSocket failures, 421s) all session, and a silently-failed manifest
  // fetch would leave the URL updated (pushState already happened) while
  // the old route's content stays rendered, exactly matching what was
  // observed live: URL changes to /app/reels/<id>, page content doesn't.
  // "initial" bundles the full route manifest upfront, removing this
  // extra runtime fetch from the client-side navigation path entirely.
  routeDiscovery: { mode: "initial" },
} satisfies Config;
