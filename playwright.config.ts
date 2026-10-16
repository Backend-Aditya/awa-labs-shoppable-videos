import { defineConfig, devices } from "@playwright/test";

// Storefront end-to-end flows against a static harness (tests/e2e/server.mjs)
// that serves the BUILT theme-extension assets with real Liquid-rendered
// markup. `npm run test:e2e` builds the assets first.
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node tests/e2e/server.mjs ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
