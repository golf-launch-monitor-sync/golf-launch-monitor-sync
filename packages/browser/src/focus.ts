// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The focus of a link (spec/deep-links.md, *The focus of a link*, 1.18.0): a player an app sent here for one thing sees
 * only that thing, from the first step to *Done* - its kind's steps and card, never *Connect new*, the list, or a card
 * or notice of another kind. A launch monitor link narrows further to the providers it names.
 *
 * Pure, the same rule for the extension, the web app and the companion app; each client hands in what it knows of the
 * link that brought the player (the extension's pending offer, the companion app's screen), null when the player
 * opened the client themselves - then nothing is in focus and everything shows as before.
 */

import { providersOf } from '@glmsync/spec';
import type { ServiceKind } from './wizard.ts';

export interface Focus {
  kind: ServiceKind;
  /** `lm` only: the providers the link names (in its order); empty: any launch monitor the client can connect. */
  providers: readonly string[];
}

/** What a client knows of the link that brought the player: its kind (none: a launch monitor) and `provider`. */
export interface FocusSource {
  kind?: ServiceKind | undefined;
  provider?: string | undefined;
}

/** The focus of the link that brought the player; null when they opened the client themselves (no link). */
export function focusOf(from: FocusSource | null | undefined): Focus | null {
  if (!from) return null;
  const kind = from.kind ?? 'lm';
  // A provider list that doesn't read never got this far (the link was invalid); read defensively all the same.
  return { kind, providers: kind === 'lm' ? (providersOf(from.provider) ?? []) : [] };
}

/** Whether a kind's steps, card or notices show: everything without a focus, else only the focus's own kind. */
export function inFocus(focus: Focus | null, kind: ServiceKind): boolean {
  return !focus || focus.kind === kind;
}

/**
 * The launch monitors the first step offers: the client's own that the focus names, in the client's order (all of
 * them without a focus or without names). Where the link names only providers this client doesn't know, those by their
 * id: the pairing then says it can't, rather than the step offering something the app never asked for.
 */
export function focusServices<S extends { id: string; name: string }>(focus: Focus | null, own: readonly S[]): (S | { id: string; name: string })[] {
  if (!focus || focus.kind !== 'lm' || !focus.providers.length) return [...own];
  const known = own.filter((o) => focus.providers.includes(o.id));
  return known.length ? known : focus.providers.map((id) => ({ id, name: id }));
}

/**
 * The provider a pairing goes out with (`POST /pair` names one): the one the player tapped when the link allows it (any,
 * without names), else the link's first. undefined: neither - the client's own default.
 */
export function pairingProvider(link: string | undefined, chosen: string | undefined): string | undefined {
  const named = providersOf(link) ?? [];
  if (chosen && (!named.length || named.includes(chosen))) return chosen;
  return named[0];
}
