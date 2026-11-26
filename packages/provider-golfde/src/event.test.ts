// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { readVectors } from '../../spec/src/vectors.ts';
import { EVENT_LABELS, EVENT_LOADING_MS, eventBody, eventLinesOf, eventOnPage, eventPageOf, offerEvent, readEvent, readEventPage } from './event.ts';
import { FakeNode, PERSONAL, TOURNAMENT_LINES, TOURNAMENT_NAME, tournamentDoc } from './testing.ts';

type PageCase = { name: string; input: unknown; expected: unknown };
const vectors = readVectors<PageCase>('dgvevent-page.json');
const PAGE = 'https://www.golf.de/sport/turnierkalender/clubturniere.html#/490000000001?endtage=180&latitude=53.55&longitude=9.99';

describe('a tournament’s page, read by its labels (spec/testvectors/dgvevent-page.json)', () => {
  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    expect(readEventPage(c.input)).toEqual(c.expected);
  });

  it('knows the labels the reference knows', () => {
    expect(EVENT_LABELS).toEqual(vectors.labels);
  });
});

describe('the page’s address', () => {
  it('is a tournament’s page, and its url leaves out the search the player came from', () => {
    expect(eventPageOf(PAGE)).toEqual({ id: '490000000001', url: 'https://www.golf.de/sport/turnierkalender/clubturniere.html#/490000000001' });
    expect(eventPageOf('https://www.golf.de/sport/turnierkalender/clubturniere.html#/490000000001/ergebnisse')).toBeNull();
    expect(eventPageOf(`https://www.golf.de/sport/turnierkalender/clubturniere.html#/1?${'x'.repeat(3000)}`)).toBeNull();
    expect(eventPageOf(undefined)).toBeNull();
  });
});

describe('finding the heading and the lines in golf.de’s page', () => {
  it('reads the heading and every line under Turnierinformationen, in the page’s order', () => {
    expect(eventLinesOf(tournamentDoc())).toEqual({ heading: TOURNAMENT_NAME, lines: TOURNAMENT_LINES });
  });

  it('never reads the registration box beside it, which may show the signed-in player', () => {
    const read = eventOnPage(PAGE, tournamentDoc());
    expect(JSON.stringify(read)).not.toContain(PERSONAL.nameOnCard);
    expect(read).toEqual({
      event: {
        id: '490000000001',
        url: 'https://www.golf.de/sport/turnierkalender/clubturniere.html#/490000000001',
        name: TOURNAMENT_NAME,
        date: '2027-06-12',
        time: '09:30',
        venue: 'Golfclub Beispielstadt e.V.',
        play_form: 'Einzel - Stableford',
        holes: 18,
        hcp_relevant: true,
        tee: '1',
        max_players: 120,
        gender: 'Damen & Herren',
        guests: true,
        open: true,
        age_class: 'Offen',
        entry_close_online: '2027-06-09T18:00',
        entry_close_club: '2027-06-10T12:00',
      },
    });
  });

  it('reads the English page too', () => {
    const lines: [string, string][] = [['Tournament Date', 'Sat 12.06.2027 at 09:30'], ['Guests', 'Yes']];
    expect(eventOnPage(PAGE, tournamentDoc({ title: 'Tournament Information', lines }))).toMatchObject({ event: { date: '2027-06-12', time: '09:30', guests: true } });
  });

  it('reads a label and its value as dt and dd, each a row of its own', () => {
    const dl = new FakeNode('HTML', [
      new FakeNode('H2', 'Herbstpreis'),
      new FakeNode('SECTION', [new FakeNode('H3', 'Turnierinformationen'), new FakeNode('DL', [new FakeNode('DT', 'Turnierdatum'), new FakeNode('DD', 'So 19.09.2027'), new FakeNode('DT', 'Gäste'), new FakeNode('DD', 'Nein')])]),
    ]);
    expect(eventLinesOf(dl)).toEqual({ heading: 'Herbstpreis', lines: [['Turnierdatum', 'So 19.09.2027'], ['Gäste', 'Nein']] });
  });

  it('is nothing to take while the lines are loading, on another page, or on a result list', () => {
    const loading = new FakeNode('HTML', [new FakeNode('MAIN', [new FakeNode('H1', 'Turnierdetails'), new FakeNode('P', 'Lade Daten ..')])]);
    expect(eventOnPage(PAGE, loading)).toEqual({ refused: 'not_a_tournament' });
    expect(eventOnPage('https://www.golf.de/mein-bereich.html', tournamentDoc())).toEqual({ refused: 'not_a_tournament' });
    expect(eventOnPage('https://www.golf.de/sport/turnierkalender/clubturniere.html#/490000000001/ergebnisse', tournamentDoc())).toEqual({ refused: 'not_a_tournament' });
  });

  it('says golf.de changed its page when the block is there but the heading or the day isn’t', () => {
    expect(eventOnPage(PAGE, tournamentDoc({ name: null }))).toEqual({ refused: 'changed_page' });
    expect(eventOnPage(PAGE, tournamentDoc({ lines: [['Datum des Turniers', 'Sa 12.06.2027']] }))).toEqual({ refused: 'changed_page' });
  });

  it('never throws, whatever the page is', () => {
    const broken = { querySelectorAll: () => { throw new Error('gone'); } };
    expect(eventOnPage(PAGE, broken)).toEqual({ refused: 'not_a_tournament' });
  });
});

describe('the body', () => {
  it('is dgvevent/1 from golf.de, with the client that wrote it', () => {
    const event = { id: '1', url: 'https://www.golf.de/sport/turnierkalender/clubturniere.html#/1', name: 'X', date: '2027-05-01' };
    expect(eventBody(event, { name: 'Golf Stats Sync', version: '1.0.0' })).toEqual({ format: 'dgvevent/1', provider: 'golfde', generator: { name: 'Golf Stats Sync', version: '1.0.0' }, event });
    expect(eventBody(event)).toEqual({ format: 'dgvevent/1', provider: 'golfde', event });
  });
});

describe('an event read again strictly (it may come from a page script)', () => {
  it('takes every event the page rule writes, as it is', () => {
    for (const c of vectors.cases) {
      const e = (c.expected as { event?: unknown }).event;
      if (e) expect([c.name, readEvent(e)]).toEqual([c.name, e]);
    }
  });

  it('refuses one that isn’t as the schema has it', () => {
    const good = (readEventPage(vectors.cases[0]?.input) as unknown as { event: Record<string, unknown> }).event;
    for (const bad of [
      { ...good, id: '2' },
      { ...good, url: `${good.url}?radius=50` },
      { ...good, name: ' padded ' },
      { ...good, date: '12.06.2027' },
      { ...good, holes: 27 },
      { ...good, max_players: 0 },
      { ...good, guests: 'Ja' },
      { ...good, time: null },
      { ...good, start_list: [PERSONAL.other] },
      [good],
      null,
      'event',
    ]) expect(readEvent(bad)).toBeNull();
  });
});

describe('when a client offers to take the page’s tournament', () => {
  const loading = new FakeNode('HTML', [new FakeNode('MAIN', [new FakeNode('P', 'Lade Daten ..')])]);
  it('once its lines are there, or a few seconds after the address became a tournament’s; never elsewhere', () => {
    expect(offerEvent(PAGE, tournamentDoc(), 0, 0)).toBe(true);
    expect(offerEvent(PAGE, loading, 0, EVENT_LOADING_MS - 1)).toBe(false);
    expect(offerEvent(PAGE, loading, 0, EVENT_LOADING_MS)).toBe(true);
    expect(offerEvent('https://www.golf.de/sport/turnierkalender/clubturniere.html#/1/ergebnisse', tournamentDoc(), 0, 60_000)).toBe(false);
  });
});
