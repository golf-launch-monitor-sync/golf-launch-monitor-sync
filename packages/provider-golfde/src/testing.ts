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
