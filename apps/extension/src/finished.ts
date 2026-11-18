// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** When the connect window has nothing left to do. Pure, so it is tested without a browser. */

import type { ClientStatus } from '@glmsync/browser';
import type { Pending } from './messages.ts';

/**
 * Paired, signed in and confirmed, nothing asked of the player: the connect window says "done" and offers to
 * close its tab (18 Nov: too many tabs, and nothing ever said it was finished).
 */
export function finished(p: Pending | null, s: Pick<ClientStatus, 'pairings' | 'key' | 'attention'> | null): boolean {
  if (!s || !s.pairings.length || s.key.state !== 'ready' || s.attention !== null) return false;
  return !p || p.state === 'paired' || p.state === 'cancelled';
}
