// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { checkTourPage } from './page.ts';
import { checkOom, checkProfile, dayOf, isOomPage, placeOf, profileIdOf, readOom, readProfile, siteAt, siteRead, type OomLine, type Profile } from './ocs.ts';
import { ocsEntry, ocsOom, ocsProfile } from './testing.ts';

const profile = (snap = ocsProfile()): Profile => {
  const p = readProfile(snap);
  if (p?.kind !== 'profile') throw new Error(`no profile: ${JSON.stringify(p)}`);
  return p;
};
const oom = (snap = ocsOom()): OomLine => {
  const l = readOom(snap, '990001');
  if (l?.kind !== 'oom') throw new Error(`no line: ${JSON.stringify(l)}`);
  return l;
};
const r = (gross: number[], par?: number) => gross.map((g, i) => (par ? { round_no: i + 1, gross: g, par, holes: 18 } : { round_no: i + 1, gross: g, holes: 18 }));

describe('LET and LET Access: where a page is', () => {
  it('knows the two sites, her profile and the Order of Merit, nothing else', () => {
    expect(siteAt('https://letaccess.com/players')?.site).toBe('tour:let_access');
    expect(siteAt('https://ladieseuropeantour.com/')?.site).toBe('tour:let');
    expect(siteAt('https://www.progolftour.de/')).toBeNull();
    expect(siteAt('http://letaccess.com/')).toBeNull();
    expect(profileIdOf('https://letaccess.com/player-profiles/911221/')).toBe('911221');
    expect(profileIdOf('https://ladieseuropeantour.com/player-profiles/011067')).toBe('011067');
    expect(profileIdOf('https://letaccess.com/player-profiles/?player=911130')).toBeNull();
    expect(profileIdOf('https://evil.example/player-profiles/911221/')).toBeNull();
    expect(isOomPage('https://letaccess.com/letas-order-of-merits?id=2026&oom=LO')).toBe(true);
    expect(isOomPage('https://ladieseuropeantour.com/order-of-merit?id=2026&oom=PT')).toBe(true);
    expect(isOomPage('https://letaccess.com/letas-roty?id=2026&oom=LR')).toBe(false);
  });

  it('reads the sites\' days and places', () => {
    expect(dayOf('12/04/26')).toBe('2026-04-12');
    expect(dayOf('05/06/2026')).toBe('2026-06-05');
    expect(dayOf('31/02/26')).toBeUndefined();
    expect(dayOf('2026-04-12')).toBeUndefined();
    expect(placeOf('9=')).toEqual({ place: 9, tied: true });
    expect(placeOf('2')).toEqual({ place: 2 });
    expect(placeOf('MC')).toEqual({ result: 'MC' });
    expect(placeOf('W/D')).toEqual({ result: 'WD' });
    expect(placeOf('-')).toEqual({});
  });
});

describe('LET and LET Access: her profile', () => {
  it('reads the season\'s tournaments with every round, the par from the total, never the prize money', () => {
    const p = profile();
    expect(p).toMatchObject({ site: 'tour:let_access', player_id: '990001', player_name: 'Erika Erfunden', season: 2026 });
    expect(p.entries).toEqual([
      { ref: 'letas-9001-2026', name: 'Sample Ladies Open', start: '2026-04-12', place: 2, rounds: r([72, 69, 69], 72) },
      { ref: 'letas-9002-2026', name: 'Made-up Challenge', start: '2026-05-20', place: 9, tied: true, points: 12.5, rounds: r([69, 71, 72], 70) },
      { ref: 'letas-9003-2026', name: 'Beispiel Open', start: '2026-07-08', place: 53, tied: true, rounds: r([70, 75], 72) },
    ]);
    expect(JSON.stringify(p)).not.toContain('1,000');
  });

  it('gives no par where the total doesn\'t add up or the par isn\'t whole', () => {
    const p = profile(ocsProfile({}, [
      [...ocsEntry('9101', 'Odd total', '01/04/26', '5', [70, 70], '-1').slice(0, 4), { text: '141 (-3)' }, { text: '' }, { text: '' }],
      ocsEntry('9102', 'Half par', '02/04/26', '6', [70, 71], '-2'),
      ocsEntry('9103', 'Level', '03/04/26', '7', [72, 72], 'E'),
    ]));
    expect(p.entries.map((e) => e.rounds[0]?.par)).toEqual([undefined, undefined, 72]);
  });

  it('skips a line that is no played tournament and keeps one bad value from costing the rest', () => {
    const p = profile(ocsProfile({}, [
      [{ text: 'Sponsored' }, { text: '' }, { text: '' }],
      ocsEntry('9201', 'Bad date', '31/02/26', '3', [70, 70, 70], 'E'),
      ocsEntry('9202', 'No rounds yet', '01/12/26', '-', [], 'E'),
      [{ text: 'No link here' }, { text: '04/04/26' }, { text: '1000' }, { text: '68 abc 69' }, { text: '' }, { text: '' }, { text: 'n/a' }],
    ]));
    expect(p.entries).toEqual([{ ref: 'letas-2026-04-04-no-link-here', name: 'No link here', start: '2026-04-04', rounds: r([68, 69]) }]);
  });

  it('is no profile elsewhere; a page without results or of another shape says so instead of guessing', () => {
    expect(readProfile(ocsOom())).toBeNull();
    expect(readProfile(ocsProfile({ url: 'https://www.progolftour.de/player-profile/990001' }))).toBeNull();
    expect(readProfile(ocsProfile({ tables: [] }))).toEqual({ kind: 'unread', why: 'no_result' });
    expect(readProfile(ocsProfile({ lines: ['LETAS Results'] }))).toEqual({ kind: 'unread', why: 'changed_page' });
    const head = ['Tournaments', 'Rounds', 'Total'];
    expect(readProfile(ocsProfile({ tables: [{ head, rows: [] }] }))).toEqual({ kind: 'unread', why: 'changed_page' });
  });

  it('takes the season from its entries when the page shows no picker', () => {
    expect(profile(ocsProfile({ selected: [] })).season).toBe(2026);
    expect(profile(ocsProfile({ selected: ['2025 Season'] })).season).toBe(2025);
  });

  it('reads the LET\'s profile the same way, as a tour of its own', () => {
    const LET = 'https://ladieseuropeantour.com';
    const p = profile(ocsProfile({ url: `${LET}/player-profiles/990001/` }, [ocsEntry('8001', 'Sample Masters', '14/05/26', '12=', [70, 70, 70, 70], '-8', '', LET)]));
    expect(p).toMatchObject({ site: 'tour:let', entries: [{ ref: 'let-8001-2026', rounds: r([70, 70, 70, 70], 72) }] });
  });
});

describe('LET and LET Access: her line of the Order of Merit', () => {
  it('takes only her line, found by the link to her profile', () => {
    expect(oom()).toEqual({ kind: 'oom', site: 'tour:let_access', player_id: '990001', season: 2026, rank: 3, points: 1807.42, events: 18 });
  });

  it('takes nothing when she isn\'t on it, or the page is of another shape', () => {
    expect(readOom(ocsOom(), '990099')).toEqual({ kind: 'unread', why: 'not_him' });
    expect(readOom(ocsOom({ tables: [] }), '990001')).toEqual({ kind: 'unread', why: 'changed_page' });
    expect(readOom(ocsProfile(), '990001')).toBeNull();
  });

  it('takes the season from the address when the page shows no picker', () => {
    expect(oom(ocsOom({ selected: [], url: 'https://letaccess.com/letas-order-of-merits?id=2025&oom=LO' })).season).toBe(2025);
    expect(readOom(ocsOom({ selected: [], url: 'https://letaccess.com/letas-order-of-merits' }), '990001')).toEqual({ kind: 'unread', why: 'changed_page' });
  });
});

describe('LET and LET Access: what a read hands on', () => {
  it('sends the finished tournaments with their rounds and the ranking of her line, as a page the target takes', () => {
    const page = siteRead(profile(), oom(), '2026-07-11');
    expect(page.ranking).toEqual({ source: 'tour:let_access', as_of: '2026-07-11', rank: 3, points: 1807.42, events: 18 });
    // The Beispiel Open started on 8 July: on the 11th it may still run.
    expect(page.tournaments.map((t) => t.ref)).toEqual(['letas-9001-2026', 'letas-9002-2026']);
    expect(page.tournaments[1]).toEqual({ ref: 'letas-9002-2026', tour: 'let_access', name: 'Made-up Challenge', start: '2026-05-20', place: 9, tied: true, points: 12.5, rounds: r([69, 71, 72], 70) });
    expect(checkTourPage(JSON.parse(JSON.stringify(page)))).toEqual(page);
  });

  it('leaves out a line of another season or another player; a past season is as of its end', () => {
    const p = profile(ocsProfile({ selected: ['2025 Season'] }));
    const page = siteRead(p, oom(), '2026-11-25');
    expect(page.ranking).toEqual({ source: 'tour:let_access', as_of: '2026-07-11', events: 3 });
    expect(siteRead(profile(), { ...oom(), player_id: '990099' }, '2026-11-25').ranking.rank).toBeUndefined();
    expect(page.tournaments).toHaveLength(3);
  });
});

describe('LET and LET Access: what a content script sends, read again', () => {
  it('keeps what holds, drops what doesn\'t', () => {
    expect(checkProfile(JSON.parse(JSON.stringify(profile())))).toEqual(profile());
    expect(checkOom(JSON.parse(JSON.stringify(oom())))).toEqual(oom());
    const bad = { ...profile(), entries: [{ ref: 'x y', name: 'n', start: '2026-01-01', rounds: r([70]) }, { ref: 'ok', name: 'n', start: '2026-01-02', rounds: [{ round_no: 1, gross: 300 }] }, { ref: 'ok2', name: 'n', start: '2026-01-03', place: 4, tied: true, points: -1, rounds: r([70], 72) }] };
    expect(checkProfile(bad)?.entries).toEqual([{ ref: 'ok2', name: 'n', start: '2026-01-03', place: 4, tied: true, rounds: r([70], 72) }]);
    expect(checkProfile({ ...profile(), site: 'tour:pro_golf_tour' })).toBeNull();
    expect(checkProfile({ ...profile(), player_id: 'abc' })).toBeNull();
    expect(checkOom({ ...oom(), rank: undefined, points: undefined })).toBeNull();
    expect(checkOom({ ...oom(), kind: 'profile' })).toBeNull();
    expect(checkOom('{}')).toBeNull();
  });
});
