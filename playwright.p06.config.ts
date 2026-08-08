import { defineConfig } from '@playwright/test'

const chromiumExecutablePath = process.env.P06_CHROMIUM_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export default defineConfig({
  testDir: './e2e',
  testMatch: /p0[67]-(asset-library|presentations)\.spec\.ts/,
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5175',
    browserName: 'chromium',
    launchOptions: { executablePath: chromiumExecutablePath },
  },
  webServer: [
    {
      command: `P06_CHROMIUM_PATH="${chromiumExecutablePath}" P06_API_PORT=3018 node_modules/.bin/tsx tests/p06-e2e-api.ts`,
      url: 'http://127.0.0.1:3018/api/health',
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      command: 'P06_API_URL=http://127.0.0.1:3018 node_modules/.bin/vite dev --host 127.0.0.1 --port 5175 --strictPort',
      cwd: 'apps/web',
      url: 'http://127.0.0.1:5175/',
      timeout: 30_000,
      reuseExistingServer: false,
    },
  ],
})
