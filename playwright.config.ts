import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    locale: "ar-EG",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
})
