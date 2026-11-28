// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { readEnv, envParam } from '@glmsync/spec';
import { describe, expect, it } from 'vitest';
import { systemEnv } from './env.ts';

describe('what the system allows, as a target hears it (spec 1.22.0, `power` 1.29.0)', () => {
  it.each([
    // iOS: Background App Refresh decides, Low Power Mode counts as restricted (the spec's `background`) and has its own key.
    [{ os: 'ios', task: 'available', power: { refresh: 'available', lowPower: false }, push: true }, { os: 'ios', background: 'available', push: 'on', power: 'normal' }],
    [{ os: 'ios', task: 'restricted', power: { refresh: 'denied', lowPower: false }, push: false }, { os: 'ios', background: 'denied', push: 'off', power: 'normal' }],
    [{ os: 'ios', task: 'restricted', power: { refresh: 'restricted', lowPower: null } }, { os: 'ios', background: 'restricted' }],
    [{ os: 'ios', task: 'available', power: { refresh: 'available', lowPower: true } }, { os: 'ios', background: 'restricted', power: 'low' }],
    // Without the native module only the task's own status: restricted is all it can tell.
    [{ os: 'ios', task: 'restricted', power: null }, { os: 'ios', background: 'restricted' }],
    [{ os: 'ios', task: null, power: null }, { os: 'ios' }],
    // Android: the task's status (the player restricted the app's background activity).
    [{ os: 'android', task: 'available', power: null, push: false }, { os: 'android', background: 'available', push: 'off' }],
    [{ os: 'android', task: 'restricted', power: null }, { os: 'android', background: 'restricted' }],
    [{ os: 'web', task: null, power: null }, { os: 'other' }],
  ] as const)('%j', (said, env) => {
    const got = systemEnv(said);
    expect(got).toEqual(env);
    // What it makes is what a target reads back.
    expect(readEnv([envParam(got)])).toEqual(env);
  });

  it('never guesses from what it was given wrong', () => {
    expect(systemEnv({ os: 'ios', task: 'maybe' as never, power: { refresh: 'sometimes' as never, lowPower: 'yes' as never } })).toEqual({ os: 'ios' });
  });
});
