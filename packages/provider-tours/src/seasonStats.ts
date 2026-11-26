// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The season statistics of the tours whose player page has a *Stats* tab beside *Results* (pgatour.com, lpga.com,
 * epsontour.com): a table with one statistic a row, its label first and its value in a column of its own, as the
 * site's own scripts built it in the player's tab. Each site's labels are mapped to prores/1's keys (spec/prores.md),
 * metric: yards and feet to metres. What a site writes that has no key is left out. Pure.
 */

import { clean, type Table } from './snapshot.ts';

/** How a value is written: a plain number (also a share in %), yards, feet (`36' 4`: feet and inches), a count. */
export type StatUnit = 'number' | 'yards' | 'feet' | 'count';

export interface StatRule {
  key: string;
  /** The labels the site writes for it, as `statLabel` gives them. */
  labels: readonly string[];
  unit?: StatUnit;
}

/** A label as the rules know it: lower case, hyphens as spaces, the hidden text of the row's arrow icon dropped. */
export function statLabel(s: string): string {
  return clean(s)
    .replace(/(?:\s*right arrow)+$/i, '')
    .toLowerCase()
    .replace(/[-‐‑–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NUMBER = /^[+-]?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?$/;
const FEET = /^([0-9]{1,3})'\s*([0-9]{1,2})(?:"|'')?$/;
const metres = (n: number): number => Math.round(n * 10) / 10;

/** A value as the sites write it ("2.249", "-0.71", "63.94%", "72.52 %", "1,112.377", "36' 4"); none for "-" or anything else. */
export function statValue(s: string | undefined, unit: StatUnit = 'number'): number | undefined {
  const t = clean(s).replace(/−/g, '-');
  if (unit === 'feet') {
    const m = FEET.exec(t);
    if (m) return metres((Number(m[1]) + Number(m[2]) / 12) * 0.3048);
  }
  const plain = t.replace(/\s*%$/, '');
  if (!NUMBER.test(plain)) return undefined;
  const n = Number(plain.replace(/,/g, ''));
  if (!Number.isFinite(n) || Math.abs(n) > 1e6) return undefined;
  if (unit === 'yards') return metres(n * 0.9144);
  if (unit === 'feet') return metres(n * 0.3048);
  if (unit === 'count') return Number.isInteger(n) && n >= 0 ? n : undefined;
  return n;
}

/** The rule of a label, if any. */
export const ruleOf = (rules: readonly StatRule[], label: string): StatRule | undefined => {
  const l = statLabel(label);
  return rules.find((r) => r.labels.includes(l));
};

/**
 * A statistics table's values by key: the label in column `at.label`, the value in `at.value`; the first row of a key
 * counts (a site lists some twice).
 */
export function statsOfTable(table: Table, at: { label: number; value: number }, rules: readonly StatRule[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (at.label < 0 || at.value < 0) return out;
  for (const row of table.rows) {
    const rule = ruleOf(rules, row[at.label]?.text ?? '');
    if (!rule || rule.key in out) continue;
    const v = statValue(row[at.value]?.text, rule.unit);
    if (v !== undefined) out[rule.key] = v;
  }
  return out;
}

/** Values written beside their label outside a table (`Snapshot.pairs`, e.g. lpga.com's strokes gained cards). */
export function statsOfPairs(pairs: Readonly<Record<string, string>>, rules: readonly StatRule[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [label, text] of Object.entries(pairs)) {
    const rule = ruleOf(rules, label);
    if (!rule || rule.key in out) continue;
    const v = statValue(text, rule.unit);
    if (v !== undefined) out[rule.key] = v;
  }
  return out;
}

/** A season's statistics as of: a past season's at its year's end, the running one (or a later one) as read today. */
export function statsAsOf(season: number, today: string): string {
  return season < Number(today.slice(0, 4)) ? `${season}-12-31` : today;
}
