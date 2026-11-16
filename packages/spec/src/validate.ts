// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** Checking a batch against the olmd/1 schema (JSON Schema 2020-12). */

import { check } from './check.ts';
import schema from '../../../spec/olmd/olmd-1.schema.json' with { type: 'json' };
import type { Batch } from './olmd.ts';

export { schema as OLMD_SCHEMA };

export interface ValidationError {
  /** JSON pointer to the value, e.g. "/sessions/0/shots/3/flight/carry_m". */
  path: string;
  message: string;
}

export type Validation = { ok: true; batch: Batch } | { ok: false; errors: ValidationError[] };

/** Whether `data` is a valid olmd/1 batch; the errors say where it isn't. Never throws. */
export function validateBatch(data: unknown): Validation {
  if (check(data)) return { ok: true, batch: data };
  return {
    ok: false,
    errors: (check.errors ?? []).map((e) => ({
      path: e.instancePath || '/',
      message: [e.message ?? 'invalid', e.params && 'additionalProperty' in e.params ? String(e.params.additionalProperty) : '']
        .filter(Boolean)
        .join(': '),
    })),
  };
}
