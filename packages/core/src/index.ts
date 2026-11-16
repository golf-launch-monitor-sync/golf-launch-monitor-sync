// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The client side of Golf Launch Monitor Sync, for every client alike (browser extension, web app,
 * companion app):
 *
 * - `sync`             one sync: the target's plan first, the provider through the guard, the batch handed over
 * - `Guard`            the load guard: limits from spec/, counts kept across restarts, a log without content
 * - `pair`, `HttpTarget` the target API (spec/target-api.md) with an import token
 * - `FileTarget`, `Cursor` a sync into a file, and what was written already
 * - `Provider`, `providerContext` what a provider module implements, and the guarded requests it makes
 * - `clean`, `split`   a batch made valid at the smallest cost, and cut to a target's limits
 * - values, clubs      reading untrusted values and club names alike in every implementation
 */

export * from './api.ts';
export * from './batch.ts';
export * from './clubs.ts';
export * from './errors.ts';
export * from './file.ts';
export * from './guard.ts';
export * from './http.ts';
export * from './provider.ts';
export * from './sha256.ts';
export * from './storage.ts';
export * from './sync.ts';
export * from './target.ts';
export * from './values.ts';
