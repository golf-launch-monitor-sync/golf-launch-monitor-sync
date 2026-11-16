// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The compiled olmd/1 schema check. Its own module so that a browser extension can swap it for the
 * same check compiled ahead of time (`standalone.ts`): ajv compiles with `new Function`, which an
 * extension's content security policy forbids (Manifest V3 allows no eval at all).
 */

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '../../../spec/olmd/olmd-1.schema.json' with { type: 'json' };
import type { Batch } from './olmd.ts';

// ajv and ajv-formats are CommonJS: their default export arrives wrapped under some bundlers.
const AjvClass = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020) as typeof Ajv2020;
const withFormats = ((addFormats as unknown as { default?: typeof addFormats }).default ?? addFormats) as typeof addFormats;

/** The options both checks are compiled with: the one at runtime and the one ahead of time. */
export const AJV_OPTIONS = { allErrors: true, strict: true } as const;

export function makeAjv(extra: Record<string, unknown> = {}): InstanceType<typeof Ajv2020> {
  const ajv = new AjvClass({ ...AJV_OPTIONS, ...extra });
  withFormats(ajv);
  return ajv;
}

export const check = makeAjv().compile<Batch>(schema);
