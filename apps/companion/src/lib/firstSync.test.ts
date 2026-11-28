// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * After the first sync the player goes back by a button (the wizard's last step); the app never jumps by itself.
 * The first sync's own rule is the engine's (packages/engine/src/firstSync.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { goBack } from './firstSync.ts';

describe('back to the app', () => {
  it('opens the address, or stays when the app to go back to is gone', async () => {
    const opened: string[] = [];
    expect(await goBack('target://back', async (url) => void opened.push(url))).toBe('back');
    expect(opened).toEqual(['target://back']);
    expect(await goBack('target://back', () => Promise.reject(new Error('gone')))).toBe('stayed');
  });
});
