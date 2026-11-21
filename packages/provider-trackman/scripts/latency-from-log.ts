// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A test scenario's `latency` out of a request log the companion app exported (*Export the log*): the median and
 * spread of Trackman's answers per query, nothing else (the log holds times, kinds, statuses and durations only).
 *
 *   node --experimental-strip-types packages/provider-trackman/scripts/latency-from-log.ts glmsync-requests-2026-11-21.json
 */
import { readFileSync } from 'node:fs';
import { latencyFromLog } from '../src/latency.ts';

const file = process.argv[2];
if (!file) {
  console.error('Usage: latency-from-log.ts <exported request log .json>');
  process.exit(2);
}
let log: unknown;
try {
  log = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`Could not read ${file}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
const profile = latencyFromLog(log);
if (!profile.default) {
  console.error('Too few answers in that log to say anything (at least three of a kind).');
  process.exit(1);
}
console.log(JSON.stringify(profile, null, 2));
