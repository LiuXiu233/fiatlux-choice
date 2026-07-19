import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4175";
const ignoreHTTPSErrors = process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS === "true";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.real.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 45_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["html", { open: "never", outputFolder: "playwright-report/real" }], ["github"]]
    : "list",
  outputDir: "test-results/real",
  use: {
    baseURL,
    ignoreHTTPSErrors,
    trace: "off",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "real-desktop-chromium",
      grep: /@desktop-core/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "real-mobile-chromium",
      grep: /@mobile-core/,
      use: { ...devices["iPhone 14"], browserName: "chromium" },
    },
  ],
});
