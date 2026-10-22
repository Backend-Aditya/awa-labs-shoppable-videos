// `npm run test:integration`: migrate the disposable test database, then run
// the Vitest `integration` project against it. The URL comes from
// TEST_DATABASE_URL or .env.test and goes through the same safety guard as
// vitest.config.ts, this script never reads .env.
//
// Extra arguments are passed to Vitest, e.g.
//   npm run test:integration -- app/models/widget.server.integration.test.ts
import { spawnSync } from "node:child_process";
import { resolveTestDatabaseUrl } from "../tests/support/test-database-url.mjs";

let url;
try {
  url = resolveTestDatabaseUrl();
} catch (error) {
  console.error(`test:integration: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, TEST_DATABASE_URL: url };
const run = (args) => {
  const result = spawnSync("npx", args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(["prisma", "generate"]);
run(["prisma", "migrate", "deploy"]);
run(["vitest", "run", "--project", "integration", ...process.argv.slice(2)]);
