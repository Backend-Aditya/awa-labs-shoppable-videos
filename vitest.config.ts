import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

// Vitest's default mode is "test", so loadEnv("test", ...) should pick up
// .env.test automatically (Vite loads .env, .env.[mode], .env.local,
// .env.[mode].local from the given directory). Fall back to parsing
// .env.test directly if that ever resolves to undefined, so the test
// database URL never silently drifts from what `test:migrate` uses.
function resolveDatabaseUrl(mode: string): string | undefined {
  const fromLoadEnv = loadEnv(mode, process.cwd(), "").DATABASE_URL;
  if (fromLoadEnv) return fromLoadEnv;

  const match = readFileSync(".env.test", "utf-8").match(
    /^DATABASE_URL\s*=\s*"?([^"\n]*)"?\s*$/m,
  );
  return match?.[1];
}

export default defineConfig(({ mode }) => {
  return {
    test: {
      environment: "node",
      fileParallelism: false,
      // The suite talks to a remote Postgres (Supabase); its connection
      // latency can spike well past Vitest's 5s default and fail tests
      // that are otherwise fine.
      testTimeout: 30_000,
      hookTimeout: 60_000,
      env: {
        DATABASE_URL: resolveDatabaseUrl(mode),
      },
    },
  };
});
