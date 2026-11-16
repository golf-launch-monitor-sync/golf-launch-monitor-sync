// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** Reading spec/testvectors/ in tests (Node only; not exported from the package). */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SPEC_DIR = fileURLToPath(new URL('../../../spec/', import.meta.url));

export interface VectorFile<C = Record<string, unknown>> {
  spec_version: string;
  cases: C[];
  [key: string]: unknown;
}

export function readVectors<C = Record<string, unknown>>(name: string): VectorFile<C> {
  return JSON.parse(readFileSync(`${SPEC_DIR}testvectors/${name}`, 'utf8')) as VectorFile<C>;
}

export function specVersion(): string {
  return readFileSync(`${SPEC_DIR}VERSION`, 'utf8').trim();
}
