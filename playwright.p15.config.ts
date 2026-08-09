import { defineConfig } from '@playwright/test'
const chrome = process.env.P06_CHROMIUM_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export default defineConfig({
  testDir: './e2e', testMatch: /p15-auth-frontend\.spec\.ts/, timeout: 60_000, fullyParallel: false, workers: 1,
  use: { baseURL: 'https://localhost:5176', browserName: 'chromium', ignoreHTTPSErrors: true, launchOptions: { executablePath: chrome } },
  webServer: [
    { command: `P06_CHROMIUM_PATH="${chrome}" node_modules/.bin/tsx tests/p15-e2e-api.ts`, url: 'http://127.0.0.1:3019/api/health', timeout: 60_000, reuseExistingServer: false },
    { command: 'P06_API_URL=http://127.0.0.1:3019 ORIGIN=http://localhost:5176 P15_BROWSER_ORIGIN=https://localhost:5176 node_modules/.bin/tsx tests/p15-e2e-web.ts', url: 'http://127.0.0.1:5177', timeout: 30_000, reuseExistingServer: false },
  ],
})
