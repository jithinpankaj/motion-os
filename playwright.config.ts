import { defineConfig } from '@playwright/test';

/**
 * Browser integration + visual regression. Uses the locally installed Chrome (WebGL 2 + WebCodecs).
 * Start the stack first (`npm run dev`) or let webServer start it.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.03 } },
  use: { baseURL: 'http://localhost:5173', channel: 'chrome', viewport: { width: 1440, height: 900 }, launchOptions: { args: ['--use-angle=metal', '--enable-unsafe-webgpu'] } },
  webServer: [
    { command: 'npm run dev:api', port: 8787, reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm run dev:web', port: 5173, reuseExistingServer: true, timeout: 60_000 },
  ],
});
