// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { defineConfig } from 'vitest/config';

// Every package's tests in one run; all of them offline (no provider, no target is ever reached).
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
});
