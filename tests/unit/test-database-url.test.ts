// The guard that keeps the integration suite (which runs unscoped
// deleteMany() calls) away from real databases.
import { describe, expect, it } from "vitest";
import {
  findTestDatabaseUrl,
  isSafeTestDatabaseUrl,
  resolveTestDatabaseUrl,
} from "../support/test-database-url.mjs";

const MISSING_FILE = "tests/unit/__does_not_exist__.env";

describe("test database URL guard", () => {
  it.each([
    "postgresql://postgres:postgres@localhost:5432/reelup_test?schema=test",
    "postgresql://postgres:postgres@localhost:5432/reelup_test",
    "postgresql://u:p@127.0.0.1/db",
    "postgresql://u:p@postgres:5432/db",
    "postgresql://u:p@db:5432/db",
    "postgresql://u:p@aws-0-eu.pooler.supabase.com:6543/postgres?pgbouncer=true&schema=test",
  ])("accepts disposable database %s", (url) => {
    expect(isSafeTestDatabaseUrl(url)).toBe(true);
  });

  it.each([
    "postgresql://u:p@aws-0-eu.pooler.supabase.com:6543/postgres?pgbouncer=true",
    "postgresql://u:p@prod.example.com:5432/app?schema=public",
    "postgresql://u:p@prod.example.com:5432/app?schema=testing",
    "postgresql://u:p@localhost.evil.com:5432/app",
  ])("refuses non-test database %s", (url) => {
    expect(isSafeTestDatabaseUrl(url)).toBe(false);
    expect(() => findTestDatabaseUrl({ env: { TEST_DATABASE_URL: url }, envFile: MISSING_FILE })).toThrow(/Refusing/);
  });

  it("returns undefined when nothing is configured, and resolve throws", () => {
    expect(findTestDatabaseUrl({ env: {}, envFile: MISSING_FILE })).toBeUndefined();
    expect(() => resolveTestDatabaseUrl({ env: {}, envFile: MISSING_FILE })).toThrow(/No test database configured/);
  });

  it("prefers TEST_DATABASE_URL", () => {
    const url = "postgresql://postgres:postgres@localhost:5432/x?schema=test";
    expect(findTestDatabaseUrl({ env: { TEST_DATABASE_URL: url }, envFile: MISSING_FILE })).toBe(url);
  });
});
