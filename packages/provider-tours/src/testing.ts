// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Pages of the tours made up by hand in their shape, as `snapshotOf` gives them: made-up players, made-up
 * tournaments, made-up numbers. Never a recorded page.
 */

import type { Cell, DomElement, DomNode, Snapshot, Table } from './snapshot.ts';

const PGT = 'https://www.progolftour.de';
const cells = (...t: (string | Cell)[]): Cell[] => t.map((c) => (typeof c === 'string' ? { text: c } : c));

/** A season's line of the profile: start, end, the tournament's page, place, Order of Merit points. */
export function pgtEntry(start: string, end: string, slug: string, name: string, place: string, points = '—'): Cell[] {
  return cells('', start, '—', end, { text: name, href: `${PGT}/tournament-details/${slug}` }, place, points === '—' ? '—' : `€ ${points}`, points);
}

/** Lena Beispiel's profile, season 2026: 7th of the Order of Merit, three tournaments. */
export function pgtProfile(over: Partial<Snapshot> = {}, rows?: Cell[][]): Snapshot {
  const table: Table = {
    head: ['', 'Start', '', 'End', 'Tournament', 'Position', 'Prize money', 'Score'],
    rows: rows ?? [
      pgtEntry('02.03.2026', '04.03.2026', 'sample-desert-open-2026', 'Sample Desert Open 2026', 'T6', '1,027.50'),
      pgtEntry('16.06.2026', '18.06.2026', 'beispiel-k%C3%B6ln-classic-2026', 'Beispiel Köln Classic 2026', 'MC'),
      pgtEntry('29.09.2026', '01.10.2026', 'made-up-final-2026', 'Made-up Final 2026', '1', '5,833.33'),
    ],
  };
  return {
    url: `${PGT}/player-profile/99001?year=2026`,
    title: 'Lena Beispiel',
    lines: ['Beispiel', 'Lena', 'Lena Beispiel Year 2026', 'Statistics - Lena Beispiel Year 2026', 'Winner', 'Missed cut'],
    pairs: { 'Order of Merit': '7th', 'Season points': '17,290.60', 'Season prize money': '€ 17,580.46' },
    selected: [],
    tables: [table],
    links: [],
    ...over,
  };
}

const RESULT_HEAD = ['', '#', '', 'Player', 'Today', 'To Par', 'Hole', 'R1', 'R2', 'R3', 'Total', 'Prize money', 'Score'];

/** A field's line of a final result: place, player, then R1-R3 (fewer for a missed cut). */
export function pgtLine(place: string, player: string, ...rounds: number[]): Cell[] {
  const r = [0, 1, 2].map((i) => (rounds[i] === undefined ? '' : String(rounds[i])));
  const total = rounds.reduce((a, b) => a + b, 0);
  return cells('', place, '', player, '-1', '-4', 'F', ...r, String(total), '€ 1.00', '1.00');
}

/** The final result of a made-up tournament: three made-up players besides Lena Beispiel (unless `rows`). */
export function pgtResult(slug = 'sample-desert-open-2026', rows?: Cell[][], over: Partial<Snapshot> = {}): Snapshot {
  return {
    url: `${PGT}/tournament-details/${slug}`,
    title: '',
    lines: ['Sample Desert Open 2026', 'Sample Desert Golf Club', 'Final result Sample Desert Open 2026', 'Sample Desert Golf Club PAR 71'],
    pairs: { 'Golfclub:': 'Sample Desert Golf Club Desert Road 1, 12345 Sampletown, Egypt', 'Date:': '02.03.2026 - 04.03.2026' },
    selected: [],
    tables: [{
      head: RESULT_HEAD,
      rows: rows ?? [
        pgtLine('1', 'Otto Erfunden', 66, 67, 68),
        pgtLine('T6', 'Lena Beispiel', 69, 70, 70),
        pgtLine('T6', 'Max Ausgedacht', 70, 70, 69),
        pgtLine('MC', 'Paul Platzhalter', 75, 77),
      ],
    }],
    links: [
      `${PGT}/tournament-details/${slug}?tab=livescoring&tournament=5101#livescoring-5101`,
      `${PGT}/tournament-details/${slug}?tab=tee-times&tournament=5101#livescoring-5101`,
    ],
    ...over,
  };
}

// A tiny DOM, enough for the selectors snapshotOf uses ("a b" as descendant, "a[href]", lists with commas): for the
// tests of a page's script, which reads a document where the pure parts read a snapshot.
class TextNode implements DomNode {
  nodeType = 3;
  constructor(public textContent: string) {}
}

export class El implements DomElement {
  nodeType = 1;
  parent: El | null = null;
  nextElementSibling: El | null = null;
  previousElementSibling: El | null = null;
  childNodes: (El | TextNode)[] = [];
  constructor(public tagName: string, public attrs: Record<string, string> = {}, kids: (El | string)[] = []) {
    let prev: El | null = null;
    for (const k of kids) {
      const n = typeof k === 'string' ? new TextNode(k) : k;
      if (n instanceof El) {
        n.parent = this;
        if (prev) prev.nextElementSibling = n;
        n.previousElementSibling = prev;
        prev = n;
      }
      this.childNodes.push(n);
    }
  }
  /** As the browser's: a page script's `figuresOf` walks up from a label. */
  get parentElement(): El | null {
    return this.parent;
  }
  get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join('');
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  all(): El[] {
    return this.childNodes.flatMap((n) => (n instanceof El ? [n, ...n.all()] : []));
  }
  private matches(sel: string): boolean {
    const parts = sel.trim().split(/\s+/);
    const one = (e: El, p: string) => {
      // ":checked" stands for the option chosen now (here: one with the attribute).
      const m = /^([a-z0-9]+)(\[([a-z]+)\])?(:checked)?$/.exec(p);
      return !!m && e.tagName === m[1] && (!m[3] || e.getAttribute(m[3]) !== null) && (!m[4] || e.getAttribute('checked') !== null);
    };
    if (!one(this, parts[parts.length - 1] ?? '')) return false;
    let up = this.parent;
    for (let i = parts.length - 2; i >= 0; i -= 1) {
      while (up && !one(up, parts[i] ?? '')) up = up.parent;
      if (!up) return false;
      up = up.parent;
    }
    return true;
  }
  querySelectorAll(sel: string): El[] {
    return this.all().filter((e) => sel.split(',').some((s) => e.matches(s)));
  }
}

/** An element: `h('td', [h('a', { href }, ['text'])])`. */
export const h = (tag: string, attrs: Record<string, string> | (El | string)[] = {}, kids: (El | string)[] = []): El =>
  Array.isArray(attrs) ? new El(tag, {}, attrs) : new El(tag, attrs, kids);

/**
 * A made-up page's document from its snapshot, as a site might build it: the title as the h1, the lines as list items,
 * the labelled values as a definition list, the tables with their heads, the links. `snapshotOf` of it reads back what
 * the tour's module needs of the snapshot.
 */
export function docOf(snap: Snapshot): El {
  const cell = (c: Cell, tag: string) => h(tag, c.href ? [h('a', { href: c.href }, [c.text])] : [c.text]);
  const inTables = new Set(snap.tables.flatMap((t) => t.rows.flatMap((r) => r.map((c) => c.href ?? ''))));
  return h('html', [
    h('body', [
      ...(snap.title ? [h('h1', [snap.title])] : []),
      h('ul', snap.lines.map((l) => h('li', [l]))),
      h('dl', Object.entries(snap.pairs).flatMap(([k, v]) => [h('dt', [k]), h('dd', [v])])),
      ...snap.tables.map((t) =>
        h('table', [h('thead', [h('tr', t.head.map((x) => h('th', [x])))]), h('tbody', t.rows.map((r) => h('tr', r.map((c) => cell(c, 'td')))))]),
      ),
      ...snap.links.filter((l) => !inTables.has(l)).map((l) => h('a', { href: l }, ['link'])),
      ...snap.selected.map((o) => h('select', [h('option', { checked: '' }, [o])])),
    ]),
  ]);
}

const ET = 'https://www.europeantour.com';
const ET_HEAD = ['', 'End Date', 'Tournament', 'Pos.', 'R2DR Points', 'R2MR Points', 'Prize Money', 'R1', 'R2', 'R3', 'R4', 'Total', 'To Par', 'History'];
/** The made-up player's title on europeantour.com, as the document's title writes it on his results. */
export const ET_TITLE = 'Wins & Results - Jonas BEISPIEL - Players - European Tour';

/**
 * A line of his results: end date, the tournament's path (its tour first), place, the tour's points (R2DR or R2MR by the
 * path), then the rounds; a missed cut as the site writes it (place after two rounds, dashes after).
 */
export function etLine(end: string, path: string, name: string, place: string, points: string, ...rounds: number[]): Cell[] {
  const dp = path.startsWith('dpworld-tour/') || path.startsWith('european-tour/');
  const r = [0, 1, 2, 3].map((i) => (rounds[i] === undefined ? '-' : String(rounds[i])));
  const total = rounds.length === 4 ? String(rounds.reduce((a, b) => a + b, 0)) : '-';
  const toPar = rounds.length === 4 ? String(rounds.reduce((a, b) => a + b, 0) - 4 * 72) : '-';
  return cells('', end, { text: name, href: `${ET}/${path}/` }, place, dp ? points : '', dp ? '' : points, '€1,000.00', ...r, total, toPar, '');
}

/** Jonas Beispiel's results of the season 2026 (made up): the HotelPlanner Tour mostly, one DP World Tour event, one Legends. */
export function etResults(over: Partial<Snapshot> = {}, rows?: Cell[][]): Snapshot {
  return {
    url: `${ET}/players/jonas-beispiel-99002/results?tour=hotelplanner-tour`,
    title: '',
    lines: ['Jonas BEISPIEL', 'Wins and Results', 'Tournament Wins', 'Tournament Results'],
    pairs: { R2M: '12th' },
    selected: ['2026'],
    tables: [
      // The wins (no place column): not read, the results have them too.
      { head: ET_HEAD.filter((h) => h !== 'Pos.'), rows: [] },
      {
        head: ET_HEAD,
        rows: rows ?? [
          etLine('01/11/2026', 'hotelplanner-tour/made-up-grand-final-2026', 'Made-up Grand Final', '9T', '63.25', 70, 69, 68, 71),
          etLine('11/10/2026', 'hotelplanner-tour/sample-open-2026', 'Sample Open', '80T', '', 72, 75),
          etLine('05/07/2026', 'dpworld-tour/beispiel-international-2026', 'Beispiel International', '43T', '12.5', 70, 71, 72, 73),
          etLine('21/06/2026', 'legends-tour/made-up-senior-open-2026', 'Made-up Senior Open', '5', '', 70, 70, 70, 70),
          etLine('16/08/2015', 'challenge-tour/old-sample-challenge-2015', 'Old Sample Challenge', '1', '27,200.0', 65, 69, 69, 67),
        ],
      },
    ],
    links: [],
    ...over,
  };
}

/** His overview with ?tour=hotelplanner-tour: the head's rank, the tour's *Rankings*, the last five (here two). */
export function etOverview(over: Partial<Snapshot> = {}): Snapshot {
  return {
    url: `${ET}/players/jonas-beispiel-99002/?tour=hotelplanner-tour`,
    title: '',
    lines: ['Jonas BEISPIEL', 'Latest on Jonas', 'Last 5 performances', 'Meet Jonas'],
    pairs: { R2M: '12th', 'Current Rank': '12', 'Tournaments Played': '18', 'HotelPlanner Tour Rankings Points': '1,044.11' },
    selected: [],
    tables: [{ head: ET_HEAD, rows: [etLine('01/11/2026', 'hotelplanner-tour/made-up-grand-final-2026', 'Made-up Grand Final', '9T', '63.25', 70, 69, 68, 71)] }],
    links: [],
    ...over,
  };
}

/** His statistics of the HotelPlanner Tour (picked in the page's select): two seasons, and one without statistics. */
export function etStats(over: Partial<Snapshot> = {}): Snapshot {
  const t = (season: string, rows: [string, string][]): Table => ({
    head: [season, 'Stat', 'Tour Average', 'Rank'],
    rows: rows.map(([k, v]) => cells(k, v, '1.00', '10')),
  });
  return {
    url: `${ET}/players/jonas-beispiel-99002/stats?tour=hotelplanner-tour`,
    title: '',
    lines: ['Jonas BEISPIEL', 'Performance this season'],
    pairs: { R2M: '12th' },
    selected: ['HotelPlanner Tour'],
    tables: [
      { head: ['2027', 'Stat', 'Tour Average', 'Rank'], rows: [] },
      t('2026', [['Driving Accuracy (%)', '61.20'], ['Driving Distance (Yards)', '300.00'], ['Greens in Regulation (%)', '70.10'],
        ['Putts Per Gir', '1.76'], ['Average Putts Per Round', '29.10'], ['Sand Saves (% / Total Save attempts)', '50.00'],
        ['Stroke Average', '70.45'], ['Longest Drive', '350']]),
      t('2025', [['Stroke Average', '71.02']]),
    ],
    links: [],
    ...over,
  };
}
export * from './testing-season.ts';

const LETAS = 'https://letaccess.com';
const OCS_HEAD = ['Tournaments', 'Date', 'Position', 'Rounds', 'Total', 'Prize Money', 'Points'];

/** A line of her season's results on an OCS profile: the tournament's page, its start, her place, rounds, total. */
export function ocsEntry(code: string, name: string, date: string, place: string, rounds: number[], toPar: string, points = '', origin = LETAS): Cell[] {
  const total = rounds.reduce((a, b) => a + b, 0);
  return cells({ text: name, href: `${origin}/tournaments-information/${code}/2026` }, date, place, rounds.join(' '), `${total} (${toPar})`, '1,000.00', points);
}

/** Erika Erfunden's profile on the LET Access Series, season 2026: three tournaments, one a missed cut. */
export function ocsProfile(over: Partial<Snapshot> = {}, rows?: Cell[][]): Snapshot {
  return {
    url: `${LETAS}/player-profiles/990001/`,
    title: '',
    lines: ['Erika Erfunden', '17 Tournaments Played', '0 Wins', '2 Top Ten Finishes', '67 Lowest Round', 'Sample Ladies Open', 'Made-up Challenge', 'Beispiel Open', 'LETAS Results', 'Partners & Suppliers'],
    pairs: {},
    tables: [{
      head: OCS_HEAD,
      rows: rows ?? [
        ocsEntry('9001', 'Sample Ladies Open', '12/04/26', '2', [72, 69, 69], '-6'),
        ocsEntry('9002', 'Made-up Challenge', '20/05/26', '9=', [69, 71, 72], '+2', '12.50'),
        ocsEntry('9003', 'Beispiel Open', '08/07/26', '53=', [70, 75], '+1'),
      ],
    }],
    links: [],
    selected: ['2026 Season'],
    ...over,
  };
}

/** A season's Order of Merit: Erika Erfunden third, among made-up players. */
export function ocsOom(over: Partial<Snapshot> = {}, origin = LETAS): Snapshot {
  const line = (pos: string, name: string, id: string, points: string, played: string): Cell[] =>
    cells(pos, name, '', points, played, { text: '', href: `${origin}/player-profiles/${id}` });
  return {
    url: `${origin}/letas-order-of-merits?id=2026&oom=LO`,
    title: '',
    lines: ['Otto Platzhalter', '12 Tournaments Played'],
    pairs: {},
    tables: [{
      head: ['Pos', 'Name', 'Nat', 'Points', 'Played', ''],
      rows: [
        line('1', 'Anna Ausgedacht (FRA)', '990010', '2,145.14', '17'),
        line('2', 'Berta Beispiel (SWE)', '990011', '1,885.25', '12'),
        line('3', 'Erika Erfunden (SUI)', '990001', '1,807.42', '18'),
      ],
    }],
    links: [],
    selected: ['2026 Season'],
    ...over,
  };
}

const ALPS = 'https://www.alpstourgolf.com';
const ALPS_REPORTS = ['Statistics', 'Results', 'Order of Merit', 'This Season record', 'Last Season Highlights', 'Career Highlights'];

/** Paul Platzhalter's profile on the Alps Tour (code TST001), the report picked in *Select Report*, his name taken. */
function alpsProfile(report: string, table: Snapshot['tables'][number], over: Partial<Snapshot> = {}): Snapshot {
  return {
    url: `${ALPS}/playerprofile/TST001`,
    title: '',
    lines: ['Represents', 'Age', '27', 'Tournament Wins', 'Tournaments 9', '1', `Select Report ${report}`],
    pairs: { 'Player name': 'Paul Platzhalter' },
    tables: [table],
    links: [],
    selected: [report],
    ...over,
  };
}

/** *This Season record*: the season's tournaments, every round in one cell; one missed cut (two rounds). */
export function alpsRecord(over: Partial<Snapshot> = {}, rows?: Cell[][]): Snapshot {
  const line = (date: string, name: string, pos: string, rounds: number[]): Cell[] =>
    cells(date, name, pos, rounds.join(' '), String(rounds.reduce((a, b) => a + b, 0)), '1,000.00');
  return alpsProfile('This Season record', {
    head: ['Date', 'Name', 'Pos', 'Rounds', 'Score', 'Winnings (EUR)'],
    rows: rows ?? [
      line('17/02/26', 'Sample Desert Open', '6=', [69, 67, 73]),
      line('22/02/26', 'Made-up Lagoon Open', '51=', [70, 71]),
      line('09/04/26', 'Beispiel Alps Open', '1', [67, 65, 70]),
    ],
  }, over);
}

/** *Results* of a season: total and score to par, no rounds. */
export function alpsResults(over: Partial<Snapshot> = {}, rows?: Cell[][]): Snapshot {
  return alpsProfile('Results', {
    head: ['Date', 'Name', 'Pos', 'Score', 'Par', 'Winnings (EUR)'],
    rows: rows ?? [
      cells('17/02/26', 'Sample Desert Open', '6=', '209', '-7', '1,507.50'),
      cells('22/02/26', 'Made-up Lagoon Open', '51=', '141', '-3', '0.00'),
      cells('09/04/26', 'Beispiel Alps Open', '1', '202', '-14', '7,120.00'),
    ],
  }, over);
}

/** *Order of Merit*: a line per season. */
export function alpsOom(over: Partial<Snapshot> = {}): Snapshot {
  return alpsProfile('Order of Merit', {
    head: ['Season Name', 'Pos', 'Points', 'Tournament'],
    rows: [cells('2026 Season', '4', '26,845.35', '9'), cells('2025 Season', '57', '3,210.00', '14')],
  }, over);
}

/** *Statistics* (his career, not a season's): nothing of it is read. */
export function alpsStatistics(over: Partial<Snapshot> = {}): Snapshot {
  return alpsProfile('Statistics', {
    head: ['Description', 'Seasons', 'Tournaments', 'Result'],
    rows: [cells('Stroke Average', '2', '23', '70.41'), cells('Total Prize Money', '2', '23', '12,000.00')],
  }, over);
}

/** His profile's head as the site builds it: the name with the flag, then the boxes headed *Represents*, *Age*. */
export function alpsHead(name = 'Paul Platzhalter'): El {
  return h('html', [
    h('body', [
      h('div', [
        h('div', [h('div', [name]), h('img', { src: 'flag.svg' })]),
        h('div', [h('h3', ['Represents']), h('div', [h('h3', [''])])]),
        h('div', [h('h3', ['Age']), h('h3', ['27'])]),
      ]),
      h('select', ALPS_REPORTS.map((r) => (r === 'Results' ? h('option', { checked: '' }, [r]) : h('option', [r])))),
      h('table', [
        h('thead', [h('tr', ['Date', 'Name', 'Pos', 'Score', 'Par', 'Winnings (EUR)'].map((x) => h('th', [x])))]),
        h('tbody', [h('tr', ['17/02/26', 'Sample Desert Open', '6=', '209', '-7', '1,507.50'].map((x) => h('td', [x])))]),
      ]),
    ]),
  ]);
}
