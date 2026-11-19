// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The queries the Trackman web portal itself uses, sent from the player's own device with their own
 * sign-in, for their own account.
 *
 * Trackman has no public golf API. The portal loads its data from a GraphQL API at
 * api.trackmangolf.com with a Bearer access token from the player's portal sign-in. These are the
 * portal's queries, cut down to the fields the olmd mapping reads (mapping.ts): what isn't mapped
 * isn't asked for. A field added here needs its place there first (a test checks).
 *
 * Not an official, documented API: Trackman can change it at any time. Nothing here tries to look
 * like the portal - no copied User-Agent, no spoofing; a request says who it is by the token it
 * carries. Unofficial: this project is not affiliated with or endorsed by Trackman.
 */

/** "Is this you?" without the activities, for when Trackman refuses the longer question. */
export const PROFILE_QUERY = `
query Profile {
  me {
    profile { fullName playerName }
  }
}
`;

/**
 * "Is this you?" before a first connect, in one request: the name, and how many activities the
 * account holds with the newest of them - a player's second account often carries the same name.
 * Shown on the device, sent nowhere.
 */
export const WHO_QUERY = `
query Who($timeFrom: DateTime) {
  me {
    profile { fullName playerName }
    activities(skip: 0, take: 1, timeFrom: $timeFrom) {
      totalCount
      items {
        time
        ... on RangePracticeActivity { location { name } }
      }
    }
  }
}
`;

export const ACTIVITIES_QUERY = `
query Activities($skip: Int, $take: Int, $timeFrom: DateTime) {
  me {
    activities(skip: $skip, take: $take, timeFrom: $timeFrom) {
      totalCount
      items {
        __typename id time kind
        ... on RangePracticeActivity { location { name } }
      }
    }
  }
}
`;

// Bay/simulator kinds carry the club data too (club path, face angle ...); range kinds only ball
// data, with spin named `ballSpin`.
const BAY_MEASUREMENT = `
  clubSpeed clubPath faceAngle
  ballSpeed smashFactor carry total carrySide totalSide
  launchAngle spinRate spinAxis curve
`;
const RANGE_MEASUREMENT = `
  ballSpeed carry total carrySide totalSide
  launchAngle ballSpin spinAxis curve
`;

// One session, asked for with the fragment of its own type only (`__typename` from the list). With
// every type's fragment in one query Trackman has to merge the fields they share; once one type's
// stroke `time` became `DateTime!` while the others' stayed `DateTime`, the whole query was refused
// for every session (Nov 2026: "Fields `time` conflict because they return conflicting types"). A
// query with one fragment has nothing to merge, whatever Trackman tightens next.
const RANGE_TYPES = new Set(['RangePracticeActivity', 'RangeFindMyDistanceActivity']);
export const SESSION_TYPES: ReadonlySet<string> = new Set([
  ...RANGE_TYPES,
  'SimulatorSessionActivity',
  'ShotAnalysisSessionActivity',
  'MapMyBagSessionActivity',
  'VirtualRangeSessionActivity',
]);

/** The query for one session of the given type; a type the list didn't name goes by the interface. */
export function sessionQuery(type?: unknown): string {
  const on = typeof type === 'string' && SESSION_TYPES.has(type) ? type : 'SessionActivity';
  const measurement = RANGE_TYPES.has(on) ? RANGE_MEASUREMENT : BAY_MEASUREMENT;
  return `
query Session($id: ID!) {
  node(id: $id) {
    __typename
    ... on ${on} { id time kind strokes { time club measurement { ${measurement} } } }
  }
}
`;
}

export const ROUNDS_QUERY = `
query Rounds($skip: Int, $take: Int) {
  me {
    scorecards(skip: $skip, take: $take, completed: true) {
      id createdAt startedAt
      course { displayName }
      teeName par numberOfHolesPlayed grossScore toPar
      stat {
        driveAverage numberOfPutts greenInRegulation
        fairwayHitFairway fairwayHitLeft fairwayHitRight
      }
      holes { holeNumber par grossScore putts greenInRegulation }
    }
  }
}
`;

// Each shot of a round, five rounds a request. In simulator rounds Trackman leaves its own distances
// to the flag empty, so also where each shot was played from and came to rest and where the hole's
// flag is - x and z only, which lie flat: the mapping works the distances out from them. Nothing of
// the hole's player. The field names are Trackman's own.
function roundShotsQuery(measurement: string): string {
  return `
query RoundShots($skip: Int, $take: Int) {
  me {
    scorecards(skip: $skip, take: $take, completed: true) {
      id createdAt startedAt
      holes {
        holeNumber
        pinPosition { x z }
        shots {
          shotNumber club launchLie finalLie shotResult shotsToAdd
          dropPosition { x }
          launchPosition { x z }
          finalPosition { x z }
          measurement { ${measurement} }
        }
      }
    }
  }
}
`;
}

const ROUND_SHOT_DISTANCES = 'carry total targetDistance distanceFromPinTotal';
export const ROUND_SHOTS_QUERY = roundShotsQuery(ROUND_SHOT_DISTANCES);
// Since spec 1.4.0 also each shot's ball and club data, as a bay session's strokes have them. A field
// Trackman refuses for a round's shot is left out from then on (fetch.ts): the rest still come.
// `ballSpin` (a range's name for the spin) is not asked: a round shot's measurement has `spinRate`
// only - Trackman refused the other on the maintainer's first sync of 19 Nov 2026, costing a request.
export const MEASURED_FIELDS = [
  'clubSpeed', 'clubPath', 'faceAngle', 'ballSpeed', 'smashFactor', 'carrySide', 'totalSide',
  'launchAngle', 'spinRate', 'spinAxis', 'curve',
] as const;

export function roundShotsMeasuredQuery(fields: readonly string[]): string {
  return roundShotsQuery([ROUND_SHOT_DISTANCES, ...fields].join(' '));
}

export const ROUND_SHOTS_MEASURED_QUERY = roundShotsMeasuredQuery(MEASURED_FIELDS);
