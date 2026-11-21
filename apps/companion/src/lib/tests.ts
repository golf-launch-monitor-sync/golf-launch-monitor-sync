// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Test mode (spec/test-mode.md) in the companion app: the keeping is shared with the browser clients
 * (`@glmsync/provider-trackman`'s testMode.ts); what is the app's own is what it refuses.
 */

export { blobName, MemoryBlobs, Tests, type Blobs, type TestMode, type TestsOptions } from '@glmsync/provider-trackman';

/** What test mode itself refuses: no pairing to take the code for, or a scenario of a provider this app lacks. */
export class TestModeError extends Error {
  override name = 'TestModeError';
  constructor(readonly code: 'unpaired' | 'provider') {
    super(code === 'unpaired' ? 'Not paired with that app.' : 'A scenario of a provider this app does not have.');
  }
}
