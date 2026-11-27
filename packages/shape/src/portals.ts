// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The portals the shape recorder may be pointed at: a fixed list, each asked for at run time and only while recording
 * (`optional_host_permissions`). A new one is a new entry here, nothing else - unless the extension already has a script
 * of its own on that portal (Trackman's, where it reads the sign-in): then its sender also takes the recorder's shapes
 * (apps/extension `senders.ts`).
 */

export interface Portal {
  id: string;
  name: string;
  /** Where recording starts: the portal's own page. */
  start: string;
  /** The pages the recorder reads along on (permission patterns). */
  matches: string[];
}

export const PORTALS: readonly Portal[] = [
  {
    id: 'fsx-live',
    name: 'Foresight FSX Live',
    start: 'https://performance.foresightsports.com/',
    matches: ['https://performance.foresightsports.com/*'],
  },
  {
    id: 'myflightscope',
    name: 'FlightScope (myflightscope.com)',
    start: 'https://myflightscope.com/',
    matches: ['https://myflightscope.com/*', 'https://www.myflightscope.com/*'],
  },
  {
    // To see what the portal itself asks of Trackman for kinds the provider doesn't read in full yet (a combine's score,
    // Performance Center): the provider can only ask fields it knows by name.
    id: 'trackman',
    name: 'Trackman (portal.trackmangolf.com)',
    start: 'https://portal.trackmangolf.com/',
    matches: ['https://portal.trackmangolf.com/*'],
  },
];

export function portalOf(id: unknown): Portal | null {
  return PORTALS.find((p) => p.id === id) ?? null;
}

/** Whether an address is a page of the portal (its pattern's host and https). */
export function onPortal(portal: Portal, url: string | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  return portal.matches.some((m) => {
    const host = /^https:\/\/([^/]+)\/\*$/.exec(m)?.[1];
    return host !== undefined && host === u.host;
  });
}
