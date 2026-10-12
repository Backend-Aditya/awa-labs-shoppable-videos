// Runs before every integration test file. vitest.config.ts already refuses
// an unsafe URL; this turns "nothing configured" into one clear failure
// instead of a Prisma connection error per test.
import { NO_TEST_DATABASE_MESSAGE, isSafeTestDatabaseUrl } from "./test-database-url.mjs";

const url = process.env.DATABASE_URL ?? "";
if (!url) throw new Error(NO_TEST_DATABASE_MESSAGE);
if (!isSafeTestDatabaseUrl(url)) throw new Error("Refusing to run integration tests against a non-test database.");
