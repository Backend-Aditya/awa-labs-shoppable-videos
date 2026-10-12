import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// The test database URL comes ONLY from .env.test (or TEST_DATABASE_URL) —
// never from .env. Vite's loadEnv merges .env into test mode, so a missing
// DATABASE_URL in .env.test used to fall back to production, and the suite
// runs unscoped deleteMany() calls. The URL must also look like a test
// database (schema=test, or a local host) or the run is refused outright.
function resolveDatabaseUrl(): string {
  const fromEnv = process.env.TEST_DATABASE_URL;
  let url = fromEnv;
  if (!url) {
    try {
      url = readFileSync(".env.test", "utf-8").match(/^DATABASE_URL\s*=\s*"?([^"\n]*)"?\s*$/m)?.[1];
    } catch {
      url = undefined;
    }
  }
  if (!url) {
    throw new Error("No test database configured. Set DATABASE_URL in .env.test (see .env.test.example) or TEST_DATABASE_URL.");
  }
  const isTestSchema = /[?&]schema=test(&|$)/.test(url);
  const isLocal = /@(localhost|127\.0\.0\.1|postgres|db)(:\d+)?\//.test(url);
  if (!isTestSchema && !isLocal) {
    throw new Error(
      "Refusing to run tests: the test DATABASE_URL is neither a local database nor a `schema=test` schema. " +
        "Tests delete data — point them at a disposable database.",
    );
  }
  return url;
}

export default defineConfig(() => {
  return {
    test: {
      environment: "node",
      // Agent worktrees hold full repo copies; never run their tests here.
      exclude: ["**/node_modules/**", "**/build/**", ".claude/**"],
      fileParallelism: false,
      // The suite talks to a remote Postgres (Supabase); its connection
      // latency can spike well past Vitest's 5s default and fail tests
      // that are otherwise fine.
      testTimeout: 30_000,
      hookTimeout: 60_000,
      env: {
        DATABASE_URL: resolveDatabaseUrl(),
      },
    },
  };
});
