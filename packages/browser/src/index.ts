// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the browser clients share (apps/extension, apps/web):
 *
 * - `BrowserClient`  the provider key, the pairings, "Is this you?" and the syncs, kept in a storage
 * - `i18n`, `messages` English and German texts
 * - `view`           what a state says, as text (pure); `@glmsync/browser/render` puts it on a page
 * - `config`         where the web app lives, the project's links
 */

export * from './client.ts';
export * from './config.ts';
export * from './i18n.ts';
export * from './messages.ts';
export * from './view.ts';
