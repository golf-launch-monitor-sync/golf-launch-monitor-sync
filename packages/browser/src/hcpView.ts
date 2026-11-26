// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the handicap record's state says, as text: the small line the extension shows on golf.de's pages, and the
 * popup's part. Pure, so it is tested without a browser. Little text: the line sits on someone else's page.
 */

import type { HcpEntry, HcpView, TakeOutcome } from './hcp.ts';
import { formatWhen, type Lang, type T } from './i18n.ts';
import type { MessageKey } from './messages.ts';
import { errorText } from './view.ts';

export interface Line {
  text: string;
  /** Offer *Send* (something new, and it doesn't go by itself, or the player may not want to wait). */
  send: boolean;
  warn: boolean;
  /** Offer *Confirm*: the account the pages named waits for the player's yes (given in the extension's own page). */
  confirm?: boolean;
  /** Offer *Fetch all*: signed in, the account confirmed, an app connected (spec/hcp.md, clicking for the player). */
  fetchAll?: boolean;
  /** Offer *Stop*: a run is under way. */
  stop?: boolean;
}

/** What a run under way is at, as the line's text. */
function runText(v: HcpView, t: T, name: string): string | null {
  const r = v.run;
  if (v.fetch_all !== 'running' || !r) return null;
  if (r.phase === 'history') {
    return r.total !== undefined ? t('line.runHistory', { name, done: Math.min(r.entries, r.total), total: r.total }) : t('line.runStart', { name });
  }
  if (r.phase === 'scoring') return t('line.runScoring', { name });
  if (r.phase === 'lists') return t('line.runLists', { name, done: Math.min(r.lists_done + 1, r.lists_total), total: r.lists_total });
  return null;
}

/** The line on golf.de's page; null when no app is connected (then the extension shows nothing there at all). */
export function lineOf(v: HcpView, t: T): Line | null {
  const live = v.pairings.filter((p) => !p.other_account);
  const first = v.pairings[0];
  if (!first) return null;
  const name = (live[0] ?? first).name;
  const label = (key: MessageKey, vars: Record<string, string | number> = {}) => `${t('line.label')}: ${t(key, { name, ...vars })}`;
  if (v.changed_page) return { text: label('line.changed'), send: false, warn: true };
  // Before the yes no count: "20 results seen" read as if they were on their way.
  if (v.account === 'rejected') return { text: label('line.rejected'), send: false, warn: true };
  if (v.account === 'asking') return { text: label('line.confirm'), send: false, warn: true, confirm: true };
  if (!live.length) return { text: label('line.other'), send: false, warn: true };
  const running = runText(v, t, name);
  if (running) return { text: `${t('line.label')}: ${running}`, send: false, warn: false, stop: true };
  if (v.sending) return { text: label('line.sending'), send: false, warn: false };
  const all = v.fetch_all === 'ready' ? { fetchAll: true } : {};
  const why = v.run?.phase === 'stopped' ? v.run.why : undefined;
  if (why && why !== 'cancelled') return { text: label(`line.runStopped.${why}`), send: v.fresh > 0, warn: true, ...all };
  if (v.signed_out && !v.seen) return { text: label('line.signedOut'), send: false, warn: false };
  if (v.waiting && !v.seen) return { text: label('line.waiting'), send: false, warn: false };
  const failed = live.find((p) => p.last?.status === 'failed');
  if (failed && v.fresh) return { text: label('line.failed', { error: errorText(failed.last?.error, t) }), send: true, warn: true };
  if (!v.seen) return { text: label('line.none'), send: false, warn: false, ...all };
  if (!v.fresh) return { text: label('line.all', { seen: v.seen }), send: false, warn: false, ...all };
  return { text: label(v.auto ? 'line.freshAuto' : 'line.fresh', { seen: v.seen, fresh: v.fresh }), send: true, warn: false, ...all };
}

/** What a target last answered, as one line; null before anything was sent. */
export function hcpLastText(e: HcpEntry, t: T, lang: Lang, now: number): string | null {
  const l = e.last;
  if (!l) return null;
  let what: string;
  switch (l.status) {
    case 'sent':
      what = l.brought ? t('hcp.brought', { count: l.brought }) : t('hcp.nothing');
      break;
    case 'not_due':
      what = t('hcp.notDue');
      break;
    case 'failed':
      what = t('hcp.failed', { error: errorText(l.error, t) });
      break;
    default:
      return null; // another account: said on its own line
  }
  const at = Date.parse(l.at);
  return t('hcp.last', { when: Number.isFinite(at) ? formatWhen(at, now, lang) : '–', what });
}

/** What taking one tournament came to, in words (spec 1.19.0); `warn` when nothing was added. */
export function eventText(o: TakeOutcome, t: T): { text: string; warn: boolean } {
  const name = o.name ?? '–';
  if (o.ok) {
    const said = t(`event.${o.result}`, { name });
    return { text: o.kept.length ? `${said} ${t('event.kept')}` : said, warn: false };
  }
  const minutes = Math.max(1, Math.ceil((o.retry_after_s ?? 3600) / 60));
  return { text: t(`event.error.${o.error}`, { name, minutes }), warn: true };
}
