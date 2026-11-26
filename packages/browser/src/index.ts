// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the browser clients share (apps/extension, apps/web):
 *
 * - `BrowserClient`  the provider key, the pairings, "Is this you?" and the syncs, kept in a storage
 * - `HcpClient`      the handicap record read along on golf.de, and its pairings (spec/hcp.md)
 * - `ProClient`      a professional's own pages (world rankings) sent on the player's tap, and their pairings (spec/prores.md)
 * - `i18n`, `messages` English and German texts
 * - `view`           what a state says, as text (pure); `@glmsync/browser/render` puts it on a page
 * - `wizard`         connecting as steps (the service, which is the yes to the app; sign in, the account, the first data, done), the same for every service
 * - `focus`          a link's focus: only the kind (and the launch monitors) it came for, from the first step to *Done*
 * - `connections`    the main view's list of connections and where each stands
 * - `config`         where the web app lives, the project's links
 */

export * from './client.ts';
export * from './config.ts';
export * from './hcp.ts';
export * from './hcpView.ts';
export * from './pro.ts';
export * from './proView.ts';
export * from './i18n.ts';
export * from './messages.ts';
export * from './view.ts';
export * from './wizard.ts';
export * from './focus.ts';
export * from './connections.ts';
export * from './blobs.ts';
export * from './proPages.ts';
