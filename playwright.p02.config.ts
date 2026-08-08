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
  webServer: [
    {
      command: 'P02_API_PORT=3017 node_modules/.bin/tsx tests/p02-e2e-api.ts',
      url: 'http://127.0.0.1:3017/api/health',
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: 'P06_API_URL=http://127.0.0.1:3017 node_modules/.bin/vite dev --host 127.0.0.1 --port 5174 --strictPort',
      cwd: 'apps/web',
      url: 'http://127.0.0.1:5174/',
      timeout: 30_000,
      reuseExistingServer: false,
    },
  ],
})
