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
        id time kind
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

export const SESSION_QUERY = `
query Session($id: ID!) {
  node(id: $id) {
    __typename
    ... on RangePracticeActivity { id time kind strokes { time club measurement { ${RANGE_MEASUREMENT} } } }
    ... on RangeFindMyDistanceActivity { id time kind strokes { time club measurement { ${RANGE_MEASUREMENT} } } }
    ... on SimulatorSessionActivity { id time kind strokes { time club measurement { ${BAY_MEASUREMENT} } } }
    ... on ShotAnalysisSessionActivity { id time kind strokes { time club measurement { ${BAY_MEASUREMENT} } } }
    ... on MapMyBagSessionActivity { id time kind strokes { time club measurement { ${BAY_MEASUREMENT} } } }
    ... on VirtualRangeSessionActivity { id time kind strokes { time club measurement { ${BAY_MEASUREMENT} } } }
    ... on SessionActivity { id time kind strokes { time club measurement { ${BAY_MEASUREMENT} } } }
  }
}
`;

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
export const ROUND_SHOTS_QUERY = `
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
          measurement { carry total targetDistance distanceFromPinTotal }
        }
      }
    }
  }
}
`;
