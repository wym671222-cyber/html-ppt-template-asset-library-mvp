import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: /p02-foundation\.spec\.ts/,
  timeout: 30_000,
  use: {
    baseURL: process.env.P02_WEB_URL ?? 'http://127.0.0.1:5174',
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.P02_CHROMIUM_PATH,
    },
  },
})
