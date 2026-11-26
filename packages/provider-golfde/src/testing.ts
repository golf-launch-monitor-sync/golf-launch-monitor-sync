// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * For tests: golf.de's answers made up by hand in the shape the page receives them (the field names of the project's
 * notes on the page, never a recorded answer). They carry made-up names and numbers on purpose, so the tests can show
 * that none of them ever leaves the page script.
 */

/** Made-up personal values: none of them may ever appear in what the page script posts. */
export const PERSONAL = {
  firstName: 'Alexandra',
  lastName: 'Beispielspielerin',
  nameOnCard: 'Alexandra Beispielspielerin',
  memberNumber: '4711',
  homeClubNumber: '8888',
  participant: '048888804711',
  marker: 'Max Markersmann',
  other: 'Otto Mitspieler',
} as const;

export function memberId(n = 123456): string {
  return btoa(`ReportMemberDetails:${n}`);
}

export function memberAnswer(n = 123456, hcpi: unknown = 8.1, hcpiLow: unknown = 7.4) {
  return {
    data: {
      me: {
        __typename: 'Me',
        reports: {
          __typename: 'Reports',
          memberDetails: {
            __typename: 'ReportMemberDetails',
            id: memberId(n),
            firstName: PERSONAL.firstName,
            lastName: PERSONAL.lastName,
            nameAffix: null,
            nameOnCard: PERSONAL.nameOnCard,
            salutation: 'Frau',
            title: null,
            homeClubName: 'Golfclub Heimat',
            homeClubNumber: PERSONAL.homeClubNumber,
            memberNumber: PERSONAL.memberNumber,
            hcpi,
            hcpiCalc: hcpi,
            hcpiLow,
            hcpiLock: false,
            hcpiLockChanged: null,
            overrideHcpiBreak: false,
            overrideHcpiBreakChangedByDgv: null,
            overrideHcpiBreakChangedByPlayer: null,
          },
        },
      },
    },
  };
}

let seq = 0;
/** A made-up entry of the History Sheet (`HandicapHistoryRecord`); `over` changes or adds fields. */
export function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1;
  const n = String(seq).padStart(12, '0');
  return {
    __typename: 'HandicapHistoryRecord',
    id: btoa(`HandicapHistoryRecord:${seq}`),
    resultGuid: `c0ffee00-0000-4000-8000-${n}`,
    tournamentDate: '2026-10-03T09:30:00+02:00',
    dateCreated: '2026-10-03T18:00:00+02:00',
    dateModified: null,
    tournamentName: 'Herbstpreis',
    tournamentClubName: 'Golfclub Beispiel',
    tournamentClubNumber: 9999,
    tournamentCourse: 1,
    tournamentRound: 1,
    countryCode: 49,
    holesPerRound: 18,
    tournamentType: 1,
    tournamentMode: 'S',
    resultStatus: 'W',
    hcpiRelevant: true,
    usedForHcpiCalculation: true,
    startTeeColor: 'gelb',
    par: 72,
    courseRating: 71.4,
    slope: 131,
    hcpi: 8.4,
    courseHandicap: 10.3,
    playingHandicap: 10,
    ratedGrossResult: 85,
    ratedStablefordPoints: 33,
    wbe: null,
    comment: null,
    scorecardTournamentNumber: 5001,
    scorecardRoundNumber: 1,
    scorecardParticipantNumberCVS: PERSONAL.participant,
    ...over,
  };
}

/** A made-up cursor of the History Sheet's page `page` (golf.de's are opaque Base64; these only look alike). */
export const cursorOf = (page: number): string => btoa(`cursor:${(page - 1) * 10}`);

/** A made-up page of the History Sheet (ten entries a page on golf.de); `page` of `pages`, with the pager's cursors. */
export function historyAnswer(nodes: Record<string, unknown>[], totalCount = nodes.length, page = 1, pages = 1) {
  const pc = (n: number) => ({ __typename: 'PageCursor', cursor: cursorOf(n), page: n });
  const forward = [];
  for (let n = page + 1; n <= Math.min(pages, page + 3); n++) forward.push(pc(n));
  const backward = [];
  for (let n = Math.max(1, page - 3); n < page; n++) backward.push(pc(n));
  return {
    data: {
      me: {
        reports: {
          handicapHistorySheet: {
            __typename: 'HandicapHistoryRecordConnection',
            nodes,
            totalCount,
            pageInfo: { __typename: 'RelativePageInfo', currentCursor: pc(page), forwardCursors: forward, backwardCursors: backward, firstPageCursors: [pc(1)], lastPageCursors: [pc(pages)] },
          },
        },
      },
    },
  };
}

/** A made-up Scoring Record: the entries with a Score Differential. */
export function scoringAnswer(nodes: Record<string, unknown>[]) {
  return {
    data: {
      me: {
        reports: {
          scoringRecords: nodes.map((n) => ({
            ...n,
            __typename: 'ScoringRecord',
            scoreDifferential: 11.2,
            ratedScoreDifferential: 11.2,
            scoreDifferentialAdjustment: 0,
            pcc: 0,
            exceptionalScoreReduction: 0,
            kindOfData: 'T',
            eventStatus: 'W',
            tournamentNumber: n.scorecardTournamentNumber,
          })),
        },
      },
    },
  };
}

export const AUTH_FAILED = { data: null, errors: [{ message: 'Not authorized', extensions: { code: 'AUTH_FAILED' } }] };

/** A made-up result list of a tournament: the player's own line among others' (names and all). */
export function resultsAnswer(ownRef: string, ownRank = 7, others = 41) {
  const line = (ref: string, rank: number, first: string, last: string) => ({
    rank, displayRank: `${rank}.`, awardRank: rank, awardRankText: `${rank}.`, placement: rank, placementText: `${rank}.`,
    total: 33, totals: [{ roundNumber: 1, value: 33 }], result: 33, netPoints: 33, exactHandicap: 8.4, playingHandicap: 10,
    playingHandicapText: '10', playingHandicapTeam: null, teamNumber: null, partnerNumber: null, resultClassType: 'N',
    resultGuid: ref, cvsId: PERSONAL.participant, dgvPlayerId: 777, title: null, firstName: first, additionalName: null,
    lastName: last, homeClubNumber: PERSONAL.homeClubNumber, homeClubName: 'Golfclub Beispiel',
  });
  const net = [];
  for (let i = 1; i <= others + 1; i++) {
    net.push(i === ownRank ? line(ownRef, i, PERSONAL.firstName, PERSONAL.lastName) : line(`ffffffff-0000-4000-8000-${String(i).padStart(12, '0')}`, i, 'Otto', 'Mitspieler'));
  }
  return {
    tournament: { name: 'Herbstpreis', clubNumber: '9999', clubNameShort: 'GC Beispiel', clubNameLong: 'Golfclub Beispiel', date: '2026-10-03', description: '', eventStartDate: '2026-10-03', eventEndDate: '2026-10-03', roundCount: 1, lastUpdatedAt: '2026-10-03T18:00:00+02:00', tournamentMode: 1 },
    rounds: [
      {
        roundNumber: 1,
        tournamentDate: '2026-10-03',
        resultClasses: [
          {
            id: 1, resultClassName: 'Netto A', sortOrder: 1,
            grossResults: net.slice(0, 10).map((l, i) => ({ ...l, rank: i + 1 })),
            netResults: net,
            specialAssessmentResults: [],
            teamRankings: [],
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// A tournament's page (spec/hcp.md, *Taking one tournament*): made up by hand in the shape of golf.de's page of
// 26 Nov 2026 - the heading, *Turnierinformationen* with a row per line, and the registration box beside it, which
// shows the signed-in player's name here on purpose: it must never be read.
// ---------------------------------------------------------------------------

/** The lines of a made-up club tournament's page, as golf.de writes them. */
export const TOURNAMENT_LINES: [string, string][] = [
  ['Turnierdatum', 'Sa 12.06.2027 um 09:30 Uhr'],
  ['Turnierort', 'Golfclub Beispielstadt e.V.'],
  ['Turnierart', 'Einzel - Stableford; 18 Löcher'],
  ['Handicap-Relevant', 'Ja'],
  ['Starttee', '1'],
  ['Startzeit', '09:30 Uhr'],
  ['Teilnehmer maximal', '120'],
  ['Geschlecht', 'Damen & Herren'],
  ['Gäste', 'Ja'],
  ['Offenes / Geschlossenes Turnier', 'Offenes Turnier'],
  ['Altersklasse', 'Offen'],
  ['Meldeschluss Online', '09.06.2027, 18:00 Uhr'],
  ['Meldeschluss Club', '10.06.2027, 12:00 Uhr'],
];
export const TOURNAMENT_NAME = 'Sommerpreis des Clubs';

/** An element of a made-up page (tests only): its tag, its children or its text, its parent once placed. */
export class FakeNode {
  parentElement: FakeNode | null = null;
  nextElementSibling: FakeNode | null = null;
  readonly children: FakeNode[];
  private readonly text: string;
  constructor(
    readonly tagName: string,
    content: string | FakeNode[] = [],
  ) {
    this.children = typeof content === 'string' ? [] : content;
    this.text = typeof content === 'string' ? content : '';
    this.children.forEach((c, i) => {
      c.parentElement = this;
      c.nextElementSibling = this.children[i + 1] ?? null;
    });
  }
  get textContent(): string {
    return this.text + this.children.map((c) => ` ${c.textContent}`).join('');
  }
  /** Every element under this one in document order ('*'), or those of a tag. */
  querySelectorAll(selector: string): FakeNode[] {
    const out: FakeNode[] = [];
    const walk = (n: FakeNode) => {
      for (const c of n.children) {
        if (selector === '*' || c.tagName.toLowerCase() === selector.toLowerCase()) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

const n = (tag: string, content: string | FakeNode[] = []) => new FakeNode(tag, content);

/** golf.de's tournament page as a tree of `FakeNode`s (the document is its root). */
export function tournamentDoc(opts: { name?: string | null; lines?: [string, string][]; title?: string } = {}): FakeNode {
  const lines = opts.lines ?? TOURNAMENT_LINES;
  const head = opts.name === null ? [] : [n('H2', opts.name ?? TOURNAMENT_NAME)];
  return n('HTML', [
    n('BODY', [
      n('HEADER', [n('A', 'Login mein Bereich')]),
      n('MAIN', [
        n('DIV', [n('A', [n('BUTTON', 'Zurück')]), n('H1', 'Turnierdetails')]),
        n('DIV', [...head, n('SPAN', lines[0]?.[1] ?? ''), n('P', 'Golfclub Beispielstadt e.V.')]),
        n('DIV', [
          n('DIV', [
            n('DIV', [n('DIV', opts.title ?? 'Turnierinformationen'), n('DIV', lines.map(([l, v]) => n('DIV', [n('DIV', l), n('DIV', v)])))]),
          ]),
          n('DIV', [
            n('DIV', [n('DIV', 'Turnieranmeldung'), n('DIV', [n('SPAN', 'Angemeldet:'), n('P', PERSONAL.nameOnCard), n('P', 'Startzeit 09:30 Uhr')])]),
          ]),
        ]),
      ]),
      n('FOOTER', [n('H4', 'Service & Hilfe')]),
    ]),
  ]);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The same page as HTML (the click checks' world serves it), its lines appearing `delayMs` after the page loads. */
export function tournamentHtml(opts: { name?: string; lines?: [string, string][]; delayMs?: number } = {}): string {
  const lines = opts.lines ?? TOURNAMENT_LINES;
  const rows = lines.map(([l, v]) => `<div class="row"><div class="label">${esc(l)}</div><div class="value">${esc(v)}</div></div>`).join('');
  const block = `<div class="head"><h2>${esc(opts.name ?? TOURNAMENT_NAME)}</h2>${esc(lines[0]?.[1] ?? '')}<p>Golfclub Beispielstadt e.V.</p></div>`
    + `<div class="grid"><div class="cell"><div><div class="title">Turnierinformationen</div><div class="list">${rows}</div></div></div>`
    + `<div class="cell"><div><div class="title">Turnieranmeldung</div><div><span>Angemeldet:</span><p>${esc(PERSONAL.nameOnCard)}</p></div></div></div></div>`;
  // golf.de's page loads its lines after the page itself: they arrive a moment later here too.
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Clubturniere | Golf in Deutschland</title></head><body>`
    + `<main><div><a href="#/"><button>Zurück</button></a><h1>Turnierdetails</h1></div><div id="details"><p>Lade Daten ..</p></div></main>`
    + `<script>setTimeout(() => { document.getElementById('details').innerHTML = ${JSON.stringify(block)}; }, ${opts.delayMs ?? 300});</script>`
    + `</body></html>`;
}
