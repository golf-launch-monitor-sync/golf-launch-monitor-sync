// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The wake (spec/wake.md, since 1.9.0): what a client registers with `PUT /wake`, and whether a push is a
 * wake. Both read untrusted input strictly, as the reference does (spec/reference/wake.py, vectors in
 * wake.json). Whether a target wakes a client (`should_wake`) is the target's rule and lives there.
 */

/** The push services a client may name. */
export const WAKE_SERVICES = ['expo'] as const;
export type WakeService = (typeof WAKE_SERVICES)[number];
/** Between two wakes of the same client, at least this long (seconds). */
export const WAKE_GAP_S = 1200;
/** The first wake after the player came back to the target app may come this long after the last (spec 1.12.0). */
export const WAKE_BACK_GAP_S = 300;
/** The whole of a wake's data. */
export const WAKE_PAYLOAD = { kind: 'lm_plan' } as const;
export const WAKE_ADDRESS_MAX = 256;

export interface WakeRegistration {
  service: WakeService;
  address: string;
}

const EXPO = /^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,200}\]$/;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The body of `PUT /wake`, or null for anything that isn't one. Unknown keys are ignored. */
export function readWake(body: unknown): WakeRegistration | null {
  if (!isRecord(body)) return null;
  const { service, address } = body;
  if (typeof service !== 'string' || !(WAKE_SERVICES as readonly string[]).includes(service)) return null;
  if (typeof address !== 'string' || address.length > WAKE_ADDRESS_MAX || !EXPO.test(address)) return null;
  return { service: service as WakeService, address };
}

/** Whether a push's data is a wake: `kind` is exactly `lm_plan` (other keys are ignored). */
export function isWake(data: unknown): boolean {
  return isRecord(data) && data.kind === WAKE_PAYLOAD.kind;
}
