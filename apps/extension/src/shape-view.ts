// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** What the developer page says (shape.html): pure, so every sentence of a failure is tested. */

import type { T } from '@glmsync/browser';
import { portalOf } from '@glmsync/shape';
import type { ShapeError } from './shape-keeper.ts';

const ERRORS: readonly ShapeError[] = ['no_permission', 'unknown_portal', 'register_failed', 'already_recording', 'not_recording', 'storage_failed', 'full'];

export function portalName(id: string | undefined): string {
  return (id && portalOf(id)?.name) || id || '?';
}

/** A refused step, or a failure of the message itself (the background gone, the extension reloaded), as one sentence. */
export function errorText(error: string, portal: string | undefined, t: T): string {
  if (error === 'full') return t('shape.full');
  if ((ERRORS as readonly string[]).includes(error)) return t(`shape.error.${error}` as Parameters<T>[0], { portal: portalName(portal) });
  return t('shape.error.other', { reason: error || '?' });
}

/** The reason of something thrown, short enough for a sentence. */
export function reasonOf(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.length > 160 ? `${s.slice(0, 157)}…` : s || '?';
}
