// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** The native module as JavaScript sees it (the same shape as `PowerModule` of glmsync-engine). */
export interface GlmsyncPowerModule {
  getStateAsync(): Promise<unknown>;
  addListener(event: 'onTaskExpired', listener: () => void): { remove(): void };
}

/** The module on an iPhone build that has it; null elsewhere. Hand it to `powerOf` of glmsync-engine. */
export declare const GlmsyncPower: GlmsyncPowerModule | null;
