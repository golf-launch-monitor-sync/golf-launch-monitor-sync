// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The olmd/1 check as source code, compiled ahead of time, for bundles that may not evaluate code
 * at runtime (a Manifest V3 extension, a page with a strict content security policy). Same schema,
 * same options as `check.ts`; `tools/browser-build.mjs` puts it in check.ts's place, and a test
 * holds the two to the same answers on every example.
 *
 * The source `require`s two small runtime helpers of ajv and ajv-formats; a bundler resolves them
 * from this package.
 */

import standaloneCode from 'ajv/dist/standalone/index.js';
import schema from '../../../spec/olmd/olmd-1.schema.json' with { type: 'json' };
import { makeAjv } from './check.ts';

const toSource = ((standaloneCode as unknown as { default?: typeof standaloneCode }).default ?? standaloneCode) as typeof standaloneCode;

/** An ES module whose `check` is the compiled schema check. */
export function standaloneCheckSource(): string {
  const ajv = makeAjv({ code: { source: true, esm: true } });
  const validate = ajv.compile(schema);
  return `${toSource(ajv, validate)}\nexport const check = validate;\n`;
}
