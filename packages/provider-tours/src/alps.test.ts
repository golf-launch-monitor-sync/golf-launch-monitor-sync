// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { checkRead, mergeRead, nameIn, onSite, pageOf, profileIdOf, readPage, refOf, shows, snapshotAt, type AlpsRead } from './alps.ts';
import { checkTourPage, TOUR_SITES } from './page.ts';
import { alpsHead, alpsOom, alpsRecord, alpsResults, alpsStatistics, h } from './testing.ts';
import type { Snapshot } from './snapshot.ts';

const TODAY = '2026-11-26';
const read = (snap: Snapshot): AlpsRead => {
  const r = readPage(snap);
  if (r?.kind !== 'alps') throw new Error(`not read: ${JSON.stringify(r)}`);
  return r;
};
const r = (gross: number[], par?: number) => gross.map((g, i) => (par ? { round_no: i + 1, gross: g, holes: 18, par } : { round_no: i + 1, gross: g, holes: 18 }));
const all = (): AlpsRead => [alpsResults(), alpsOom(), alpsRecord()].map(read).reduce<AlpsRead | null>((k, x) => mergeRead(k, x), null) as AlpsRead;

describe('Alps Tour: where a page is', () => {
  it('knows the site and a profile by its code, nothing else', () => {
    expect(onSite('https://www.alpstourgolf.com/stats')).toBe(true);
    expect(onSite('https://alpstourgolf.com/')).toBe(true);
    expect(onSite('http://www.alpstourgolf.com/')).toBe(false);
    expect(onSite('https://letaccess.com/')).toBe(false);
    expect(profileIdOf('https://www.alpstourgolf.com/playerprofile/VAN054')).toBe('van054');
    expect(profileIdOf('https://www.alpstourgolf.com/playerprofile/GOM009/')).toBe('gom009');
    expect(profileIdOf('https://www.alpstourgolf.com/tournament/QS25/2026')).toBeNull();
    expect(profileIdOf('https://evil.example/playerprofile/VAN054')).toBeNull();
    expect(profileIdOf('https://www.alpstourgolf.com/playerprofile/../x')).toBeNull();
    expect(TOUR_SITES['tour:alps']?.name).toBe('Alps Tour');
  });

  it('finds his name above *Represents* (no heading), and takes it with the snapshot', () => {
    expect(nameIn(alpsHead())).toBe('Paul Platzhalter');
    const snap = snapshotAt(alpsHead(), 'https://www.alpstourgolf.com/playerprofile/TST001');
    expect(snap.pairs['Player name']).toBe('Paul Platzhalter');
    expect(snap.selected).toEqual(['Results']);
    expect(read(snap).totals).toEqual([{ ref: 'alps-2026-02-17-sample-desert-open', total: 209, to_par: -7 }]);
    // Not a profile: no name looked for; a page without the box: none.
    expect(snapshotAt(alpsHead(), 'https://www.alpstourgolf.com/').pairs['Player name']).toBeUndefined();
    expect(nameIn(h('html', [h('body', [h('div', [h('h3', ['Age'])])])]))).toBeNull();
    expect(nameIn(alpsHead('42'))).toBeNull();
  });

  it('waits for his name and a report on a profile, for nothing elsewhere', () => {
    expect(shows(alpsRecord())).toBe(true);
    expect(shows(alpsRecord({ tables: [] }))).toBe(false);
    expect(shows(alpsRecord({ pairs: {} }))).toBe(false);
    expect(shows(alpsRecord({ url: 'https://www.alpstourgolf.com/stats' }))).toBe(true);
  });
});

describe('Alps Tour: his profile, a report at a time', () => {
  it('*This Season record*: every round of the season\'s tournaments, never the prize money', () => {
    const x = read(alpsRecord());
    expect(x).toMatchObject({ kind: 'alps', player_id: 'tst001', player_name: 'Paul Platzhalter', totals: [], oom: [] });
    expect(x.record).toEqual([
      { ref: 'alps-2026-02-17-sample-desert-open', name: 'Sample Desert Open', start: '2026-02-17', place: 6, tied: true, rounds: r([69, 67, 73]) },
      { ref: 'alps-2026-02-22-made-up-lagoon-open', name: 'Made-up Lagoon Open', start: '2026-02-22', place: 51, tied: true, rounds: r([70, 71]) },
      { ref: 'alps-2026-04-09-beispiel-alps-open', name: 'Beispiel Alps Open', start: '2026-04-09', place: 1, rounds: r([67, 65, 70]) },
    ]);
    expect(JSON.stringify(x)).not.toContain('1,000');
  });

  it('*Results*: each tournament\'s total and score to par; *Order of Merit*: a line per season', () => {
    expect(read(alpsResults()).totals).toEqual([
      { ref: 'alps-2026-02-17-sample-desert-open', total: 209, to_par: -7 },
      { ref: 'alps-2026-02-22-made-up-lagoon-open', total: 141, to_par: -3 },
      { ref: 'alps-2026-04-09-beispiel-alps-open', total: 202, to_par: -14 },
    ]);
    expect(read(alpsResults()).record).toBeUndefined();
    expect(read(alpsOom()).oom).toEqual([{ season: 2026, rank: 4, points: 26845.35, events: 9 }, { season: 2025, rank: 57, points: 3210, events: 14 }]);
  });

  it('reads another report as nothing new, a profile without his name as a changed page, another page as none', () => {
    expect(read(alpsStatistics())).toEqual({ kind: 'alps', player_id: 'tst001', player_name: 'Paul Platzhalter', totals: [], oom: [] });
    expect(readPage(alpsRecord({ pairs: {} }))).toEqual({ kind: 'unread', why: 'changed_page' });
    expect(readPage(alpsRecord({ url: 'https://www.alpstourgolf.com/stats' }))).toBeNull();
  });

  it('skips lines that aren\'t a played tournament, and reads E as level', () => {
    const cell = (...t: string[]) => t.map((text) => ({ text }));
    const x = read(alpsRecord({}, [cell('31/02/26', 'Bad Day Open', '1', '70 70 70', '210', '0'), cell('01/03/26', 'Withdrawn Open', 'W/D', '78', '78', '0'), cell('02/03/26', '', '3', '70', '70', '0')]));
    expect(x.record).toEqual([{ ref: 'alps-2026-03-01-withdrawn-open', name: 'Withdrawn Open', start: '2026-03-01', result: 'WD', rounds: r([78]) }]);
    expect(read(alpsResults({}, [cell('17/02/26', 'Sample Desert Open', '6=', '216', 'E', '0')])).totals[0]?.to_par).toBe(0);
  });
});

describe('Alps Tour: what goes', () => {
  it('sends the finished tournaments with their rounds, the par where *Results* gave it, and the season\'s rank', () => {
    const page = pageOf(all(), TODAY);
    expect(page).toEqual({
      site: 'tour:alps',
      id: 'tst001',
      name: 'Paul Platzhalter',
      ranking: { source: 'tour:alps', as_of: TODAY, rank: 4, points: 26845.35, events: 9 },
      tournaments: [
        { ref: 'alps-2026-02-17-sample-desert-open', tour: 'alps', name: 'Sample Desert Open', start: '2026-02-17', place: 6, tied: true, rounds: r([69, 67, 73], 72) },
        { ref: 'alps-2026-02-22-made-up-lagoon-open', tour: 'alps', name: 'Made-up Lagoon Open', start: '2026-02-22', place: 51, tied: true, rounds: r([70, 71], 72) },
        { ref: 'alps-2026-04-09-beispiel-alps-open', tour: 'alps', name: 'Beispiel Alps Open', start: '2026-04-09', place: 1, rounds: r([67, 65, 70], 72) },
      ],
      stats: [],
    });
    expect(page && checkTourPage(JSON.parse(JSON.stringify(page)))).toEqual(page);
  });

  it('gives no par where the total doesn\'t add up, isn\'t whole or isn\'t known', () => {
    const cell = (...t: string[]) => t.map((text) => ({ text }));
    const kept = mergeRead(read(alpsRecord()), read(alpsResults({}, [cell('17/02/26', 'Sample Desert Open', '6=', '210', '-6', '0'), cell('22/02/26', 'Made-up Lagoon Open', '51=', '141', '-2', '0')])));
    const page = pageOf(kept, TODAY);
    expect(page?.tournaments.map((t) => t.rounds?.[0]?.par)).toEqual([undefined, undefined, undefined]);
  });

  it('sends a tournament only three days after its first, and a past season as of its end', () => {
    expect(pageOf(read(alpsRecord()), '2026-04-12')?.tournaments.map((t) => t.start)).toEqual(['2026-02-17', '2026-02-22']);
    const old = read(alpsRecord({}, [[{ text: '05/09/25' }, { text: 'Old Sample Open' }, { text: '3' }, { text: '70 70 70' }, { text: '210' }, { text: '0' }]]));
    expect(pageOf(old, TODAY)?.ranking).toEqual({ source: 'tour:alps', as_of: '2025-09-08', events: 1 });
  });

  it('sends the rank alone when no season was read, and nothing when nothing was', () => {
    expect(pageOf(read(alpsOom()), TODAY)).toMatchObject({ ranking: { source: 'tour:alps', as_of: TODAY, rank: 4, points: 26845.35, events: 9 }, tournaments: [] });
    expect(pageOf(read(alpsStatistics()), TODAY)).toBeNull();
  });
});

describe('Alps Tour: what the client keeps', () => {
  it('merges the reports of his profile; another player\'s profile replaces it all', () => {
    const kept = all();
    expect(kept.record).toHaveLength(3);
    expect(kept.totals).toHaveLength(3);
    expect(kept.oom.map((l) => l.season)).toEqual([2026, 2025]);
    // A newer read of a report replaces its part, and leaves the rest.
    const again = mergeRead(kept, read(alpsRecord({}, [alpsRecord().tables[0]!.rows[0]!])));
    expect(again.record).toHaveLength(1);
    expect(again.totals).toHaveLength(3);
    expect(mergeRead(kept, read(alpsStatistics())).record).toHaveLength(3);
    const other = mergeRead(kept, read(alpsOom({ url: 'https://www.alpstourgolf.com/playerprofile/TST002', pairs: { 'Player name': 'Otto Erfunden' } })));
    expect(other).toMatchObject({ player_id: 'tst002', player_name: 'Otto Erfunden', totals: [] });
    expect(other.record).toBeUndefined();
  });

  it('reads what arrives again strictly', () => {
    const kept = all();
    expect(checkRead(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
    expect(checkRead({ ...kept, player_id: 'TST001' })).toBeNull();
    expect(checkRead({ ...kept, kind: 'page' })).toBeNull();
    expect(checkRead(null)).toBeNull();
    const bad = checkRead({
      ...kept,
      record: [{ ref: 'x y', name: 'a', start: '2026-01-01', rounds: [{ round_no: 1, gross: 70 }] }, { ref: 'ok', name: 'a', start: '2026-01-01', rounds: [{ round_no: 1, gross: 300 }] }],
      totals: [{ ref: 'ok', total: 1e6, to_par: 0 }],
      oom: [{ season: 2026 }, { season: 1800, rank: 1 }],
    });
    expect(bad).toEqual({ kind: 'alps', player_id: 'tst001', player_name: 'Paul Platzhalter', record: [], totals: [], oom: [] });
  });

  it('makes a ref of the first day and the name made plain', () => {
    expect(refOf('2026-06-25', 'UGolf Aravell Andorra Open')).toBe('alps-2026-06-25-ugolf-aravell-andorra-open');
    expect(refOf('2026-05-14', 'Gösser Open')).toBe('alps-2026-05-14-gosser-open');
  });
});
