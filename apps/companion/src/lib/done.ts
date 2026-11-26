// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Where the app goes once connecting is done (spec/deep-links.md, *The focus of a link*, 1.18.0). A player a target app
 * sent here for one thing stays with that thing: *Back to <app>* jumps back, and where that can't be (the link named no
 * way back, the target didn't name the address as its own, the app to go back to is gone) the app shows the card of this
 * one connection - not the list with *Connect new*, the other connections and their notices. The list comes when the
 * player opens the app themselves (also: once the app went to the back).
 *
 * Pure, so the rule is tested without a phone.
 */

/** How *Done* ended: jumped back to the app, the app to go back to is gone, or there was no way back. */
export type DoneHow = 'back' | 'stayed' | 'here';

/** The main view: the list, or (`focus`) one connection's card; `linked`: a link's focus - its card alone, no way to the list. */
export interface HomeScreen {
  name: 'home';
  focus?: string;
  linked?: true;
}

/**
 * The screen after *Done*. `focus`: the connection the link was for (`lm:<provider>`, `hcp`, `pro`); null: the player
 * came by themselves, and the list is where they started.
 */
export function afterDone(focus: string | null | undefined, how: DoneHow): HomeScreen {
  // Jumped back: whoever comes here next opens the app themselves.
  if (!focus || how === 'back') return { name: 'home' };
  return { name: 'home', focus, linked: true };
}

/** The app went to the back: a link's focus ends there, the next look at the app is the player's own. */
export function afterLeaving<S extends { name: string; linked?: true }>(screen: S): S | HomeScreen {
  return screen.name === 'home' && screen.linked ? { name: 'home' } : screen;
}

/** The connection a launch monitor's pairings are for, as a card's focus: `lm:<provider>` when they share one. */
export function lmFocus(pairings: readonly { provider: string }[]): string | null {
  const providers = [...new Set(pairings.map((p) => p.provider))];
  return providers.length === 1 ? `lm:${providers[0]}` : null;
}
