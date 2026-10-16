import { defineConfig } from "vitest/config";
import { findTestDatabaseUrl, UNREACHABLE_DATABASE_URL } from "./tests/support/test-database-url.mjs";

// Test pyramid (see TESTING.md). Each layer is a Vitest project, runnable on
// its own with `vitest run --project <name>` (or `npm run test:<name>`):
//
//   unit         pure logic, node, no database
//   integration  Prisma against a disposable Postgres, node, serial
//   components   admin React components, jsdom + Testing Library
//   storefront   theme-extension JS (scripts/extension-assets-src), jsdom
//   liquid       theme-extension Liquid rendered with liquidjs, node
//
// End-to-end tests are Playwright (playwright.config.ts), not Vitest.
//
// Database guard: the test database URL comes ONLY from TEST_DATABASE_URL
// or .env.test — never from .env — and must look disposable (`schema=test`
// or a local host), or loading this config throws. When no URL is set at
// all, every project except `integration` still runs (CI's fast jobs have
// no database); the integration project then fails with a clear message.
const testDatabaseUrl = findTestDatabaseUrl();

const exclude = ["**/node_modules/**", "**/build/**", ".claude/**", "tests/e2e/**"];

// Prisma auto-loads .env when DATABASE_URL is unset, so give every
// non-database project a URL that can never connect.
const noDatabase = { DATABASE_URL: UNREACHABLE_DATABASE_URL, DIRECT_URL: UNREACHABLE_DATABASE_URL };

export default defineConfig({
  test: {
    // Agent worktrees hold full repo copies; never run their tests here.
    exclude,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      include: ["app/**/*.{ts,tsx}", "scripts/extension-assets-src/**/*.js"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "app/routes/**",
        "app/entry.server.tsx",
        "app/root.tsx",
        "app/routes.ts",
        "app/globals.d.ts",
        "app/shopify.server.ts",
        "scripts/extension-assets-src/hls.min.js",
      ],
      // Ratchet: set just under what the suites reach today (see TESTING.md).
      // Raise these when coverage improves; never lower them to merge.
      thresholds: {
        // Admin components: ~97% today.
        "app/components/**": { statements: 95, branches: 92, functions: 92, lines: 95 },
        // Client-safe model logic (no Prisma).
        "app/models/{widget-kinds,brand,reel-media,reel-status}.ts": {
          statements: 95,
          branches: 85,
          functions: 95,
          lines: 95,
        },
        // Storefront theme-extension JS: ~83% statements / ~65% branches today.
        "scripts/extension-assets-src/**": { statements: 80, branches: 60, functions: 77, lines: 85 },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["app/**/*.test.ts", "tests/unit/**/*.test.ts"],
          exclude: [...exclude, "**/*.integration.test.ts"],
          env: noDatabase,
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["app/**/*.integration.test.ts"],
          setupFiles: ["tests/support/integration-setup.ts"],
          // Integration tests share one database and clean it with
          // deleteMany(); never run two files at once.
          fileParallelism: false,
          // A remote test Postgres (e.g. Supabase) can spike well past
          // Vitest's 5s default; local Docker is fast.
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: {
            DATABASE_URL: testDatabaseUrl ?? "",
            DIRECT_URL: testDatabaseUrl ?? "",
          },
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          include: ["app/**/*.test.tsx"],
          setupFiles: ["tests/support/dom-setup.ts"],
          env: noDatabase,
          css: { include: /\.module\.css$/, modules: { classNameStrategy: "non-scoped" } },
        },
      },
      {
        extends: true,
        test: {
          name: "storefront",
          environment: "jsdom",
          include: ["tests/storefront/**/*.test.ts"],
          setupFiles: ["tests/support/dom-setup.ts"],
          env: noDatabase,
        },
      },
      {
        extends: true,
        test: {
          name: "liquid",
          environment: "node",
          include: ["tests/liquid/**/*.test.ts"],
          env: noDatabase,
        },
      },
    ],
  },
});
