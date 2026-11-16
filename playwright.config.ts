// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Click checks of the browser clients (each app's e2e folder): Chromium with the extension loaded, the web app
 * from its build - every request answered in the test (tools/e2e/world.ts), nothing reaches a network.
 * `pnpm e2e` builds first. `GLMSYNC_CHROMIUM` names a Chromium to use instead of Playwright's own.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'apps',
  testMatch: '*/e2e/**/*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  outputDir: 'test-results',
  use: {
    locale: 'en-US',
    testIdAttribute: 'data-test',
    ...(process.env.GLMSYNC_CHROMIUM ? { launchOptions: { executablePath: process.env.GLMSYNC_CHROMIUM } } : {}),
  },
});
