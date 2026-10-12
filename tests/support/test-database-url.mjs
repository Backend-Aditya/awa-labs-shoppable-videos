// Single source of truth for "which database may the test suite touch?".
// Shared by vitest.config.ts and scripts/test-integration.mjs.
//
// The test database URL comes ONLY from TEST_DATABASE_URL or .env.test —
// never from .env. Vite's loadEnv merges .env into test mode (and Prisma
// auto-loads .env), so a missing test URL used to fall back to production,
// and the suite runs unscoped deleteMany() calls. The URL must also look
// like a test database (schema=test, or a local host) or the run is refused.
import { readFileSync } from "node:fs";

export const NO_TEST_DATABASE_MESSAGE =
  "No test database configured. Set TEST_DATABASE_URL, or DATABASE_URL in .env.test " +
  "(see .env.test.example). Locally: `docker compose -f docker-compose.test.yml up -d`.";

/** @param {string} url */
export function isSafeTestDatabaseUrl(url) {
  const isTestSchema = /[?&]schema=test(&|$)/.test(url);
  const isLocal = /@(localhost|127\.0\.0\.1|postgres|db)(:\d+)?\//.test(url);
  return isTestSchema || isLocal;
}

/**
 * Returns the configured test database URL, or undefined when none is set.
 * Throws when one IS set but does not look disposable.
 * @param {{ env?: Record<string, string | undefined>, envFile?: string }} [options]
 * @returns {string | undefined}
 */
export function findTestDatabaseUrl({ env = process.env, envFile = ".env.test" } = {}) {
  let url = env.TEST_DATABASE_URL;
  if (!url) {
    try {
      url = readFileSync(envFile, "utf-8").match(/^DATABASE_URL\s*=\s*"?([^"\n]*)"?\s*$/m)?.[1];
    } catch {
      url = undefined;
    }
  }
  if (!url) return undefined;
  if (!isSafeTestDatabaseUrl(url)) {
    throw new Error(
      "Refusing to run tests: the test DATABASE_URL is neither a local database nor a `schema=test` schema. " +
        "Tests delete data — point them at a disposable database.",
    );
  }
  return url;
}

/**
 * Like findTestDatabaseUrl but throws when nothing is configured.
 * @param {{ env?: Record<string, string | undefined>, envFile?: string }} [options]
 * @returns {string}
 */
export function resolveTestDatabaseUrl(options) {
  const url = findTestDatabaseUrl(options);
  if (!url) throw new Error(NO_TEST_DATABASE_MESSAGE);
  return url;
}

// Given to every non-integration project so an accidental Prisma query from
// a unit/component test fails fast instead of reaching a real database
// (Prisma would otherwise fall back to .env).
export const UNREACHABLE_DATABASE_URL = "postgresql://unit-tests-must-not-use-the-db@127.0.0.1:1/none?schema=test";
