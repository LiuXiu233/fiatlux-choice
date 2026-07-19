import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:46217";
const previewPort = new URL(baseURL).port || "46217";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.mock.spec.ts",
  fullyParallel: true,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["html", { open: "never", outputFolder: "playwright-report/mock" }], ["github"]]
    : "list",
  outputDir: "test-results/mock",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    { name: "mobile-chromium", use: { ...devices["iPhone 14"], browserName: "chromium" } },
  ],
  ...(process.env.PLAYWRIGHT_NO_SERVER
    ? {}
    : {
        webServer: {
          command: `pnpm build && pnpm exec vite preview --host 127.0.0.1 --port ${previewPort} --strictPort`,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }),
});
