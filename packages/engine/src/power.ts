// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the iPhone says about waking the app, read through the native module `glmsync-power` (its *Background App
 * Refresh* and Low Power Mode), and when iOS ends a background task's time - which `expo-background-task`'s own
 * listener never hears (longRun.ts). The module itself is native; the app hands it in (`GlmsyncPower` of the package
 * `glmsync-power`, null where there is none: Android, an older build, Expo Go), and the rules live here.
 */

export type Refresh = 'available' | 'denied' | 'restricted';

/** What the native module answers; null for a value it didn't give. */
export interface PowerState {
  refresh: Refresh | null;
  lowPower: boolean | null;
}

const REFRESH: readonly Refresh[] = ['available', 'denied', 'restricted'];

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The native module's answer, taken value by value: anything else is unknown. */
export function readPowerState(raw: unknown): PowerState | null {
  if (!isRecord(raw)) return null;
  const refresh = REFRESH.includes(raw.refresh as Refresh) ? (raw.refresh as Refresh) : null;
  const lowPower = typeof raw.lowPower === 'boolean' ? raw.lowPower : null;
  return { refresh, lowPower };
}

/** The native module as JavaScript sees it. */
export interface PowerModule {
  getStateAsync(): Promise<unknown>;
  addListener(event: 'onTaskExpired', listener: () => void): { remove(): void };
}

export interface Power {
  /** The phone's state now, or null when this build can't tell. Never throws. */
  powerState(): Promise<PowerState | null>;
  /** Calls `listener` when iOS ends the background task's time; null when this build can't tell. Never throws. */
  onTaskExpired(listener: () => void): { remove(): void } | null;
}

/** The rules around the native module; without one (null) nothing is said, and a long run ends by its own time. */
export function powerOf(native: PowerModule | null): Power {
  return {
    async powerState() {
      if (!native) return null;
      try {
        return readPowerState(await native.getStateAsync());
      } catch {
        return null;
      }
    },
    onTaskExpired(listener) {
      if (!native) return null;
      try {
        return native.addListener('onTaskExpired', listener);
      } catch {
        return null;
      }
    },
  };
}
