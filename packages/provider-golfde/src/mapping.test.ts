// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { dayOf, memberOf, num, resultOf, subjectOf } from './mapping.ts';
import { entry, memberAnswer, PERSONAL } from './testing.ts';

describe('an entry of the History Sheet', () => {
  it('becomes a dgvhcp/1 result, field by field', () => {
    const e = entry();
    expect(resultOf(e, 'history')).toEqual({
      played_on: '2026-10-03', ref: e.resultGuid, name: 'Herbstpreis', format: 'single', kind: 'tournament',
      club_name: 'Golfclub Beispiel', club_no: '9999', course_no: '1', country: '49', round_no: 1, holes_read: 18,
      art: 'S', hcp_relevant: true, counting: true, tee: 'gelb', par: 72, cr: 71.4, slope: 131, hcp_index: 8.4, ph: 10, gbe: 85,
    });
  });

  it('keeps no name and no number of a person', () => {
    const text = JSON.stringify(resultOf(entry(), 'history'));
    for (const v of Object.values(PERSONAL)) expect(text).not.toContain(v);
    expect(text).not.toContain('scorecard');
  });

  it('never carries the name of a registered private round (it is the marker’s)', () => {
    expect(resultOf(entry({ tournamentType: 8, tournamentName: `RPR: ${PERSONAL.marker}` }), 'history')).toMatchObject({ format: 'rpr', kind: 'private' });
    expect(resultOf(entry({ tournamentType: 8, tournamentName: `RPR: ${PERSONAL.marker}` }), 'history')).not.toHaveProperty('name');
    // A type we don't know, but a marker's name all the same.
    const odd = resultOf(entry({ tournamentType: 99, tournamentName: `EDS: ${PERSONAL.marker}` }), 'history');
    expect(odd).toMatchObject({ format: 'rpr' });
    expect(JSON.stringify(odd)).not.toContain(PERSONAL.marker);
  });

  it('reads `W` as no status, and the statuses of the list as they are', () => {
    expect(resultOf(entry({ resultStatus: 'W' }), 'history')).not.toHaveProperty('status');
    expect(resultOf(entry({ resultStatus: 'DQA' }), 'history')).toMatchObject({ status: 'DQA' });
    expect(resultOf(entry({ resultStatus: 'XYZ' }), 'history')).not.toHaveProperty('status');
  });

  it('leaves out what it can’t read rather than bending it', () => {
    const r = resultOf(entry({ slope: 200, par: 'zweiundsiebzig', courseHandicap: 10.3, tournamentMode: 'Q', countryCode: '+49' }), 'history');
    expect(r).not.toHaveProperty('slope');
    expect(r).not.toHaveProperty('par');
    expect(r).not.toHaveProperty('ch'); // a course handicap with decimals is not rounded here
    expect(r).not.toHaveProperty('art');
    expect(r).not.toHaveProperty('country');
    expect(resultOf(entry({ courseHandicap: 10 }), 'history')).toMatchObject({ ch: 10 });
  });

  it('reads numbers given as text, also with a decimal comma', () => {
    expect(resultOf(entry({ courseRating: '71,4000', hcpi: '8.4' }), 'history')).toMatchObject({ cr: 71.4, hcp_index: 8.4 });
    expect(num('1e3')).toBeNull();
    expect(num(Number.NaN)).toBeNull();
  });

  it('takes Stableford points only where there is no adjusted gross score (before the WHS)', () => {
    expect(resultOf(entry(), 'history')).not.toHaveProperty('stableford_net');
    expect(resultOf(entry({ ratedGrossResult: null, ratedStablefordPoints: 34, tournamentDate: '2019-05-12T10:00:00+02:00' }), 'history')).toMatchObject({ stableford_net: 34 });
  });

  it('needs its day, and something that tells its holes', () => {
    expect(resultOf(entry({ tournamentDate: '03.10.2026' }), 'history')).toBeNull();
    expect(resultOf(entry({ tournamentDate: '2026-02-30T10:00:00Z' }), 'history')).toBeNull();
    expect(resultOf(entry({ holesPerRound: null, par: null, courseRating: null }), 'history')).toBeNull();
    expect(resultOf(null, 'history')).toBeNull();
    expect(resultOf([entry()], 'history')).toBeNull();
  });

  it('takes the day in the time’s own offset', () => {
    expect(dayOf('2026-10-03T23:30:00-05:00')).toBe('2026-10-03');
    expect(dayOf('2026-10-03')).toBe('2026-10-03');
    expect(dayOf(20261003)).toBeNull();
  });
});

describe('an entry of the Scoring Record', () => {
  it('brings its Score Differential, PCC and exceptional score as read', () => {
    expect(resultOf(entry({ scoreDifferential: 11.24, pcc: 1, exceptionalScoreReduction: -1 }), 'scoring')).toMatchObject({ sd: 11.2, pcc: 1, exceptional: -1 });
  });

  it('leaves out the course handicap of a nine-hole result (it is the one for 18 there)', () => {
    expect(resultOf(entry({ holesPerRound: 9, par: 36, courseRating: 35.9, courseHandicap: 6 }), 'scoring')).not.toHaveProperty('ch');
    expect(resultOf(entry({ holesPerRound: 9, par: 36, courseRating: 35.9, courseHandicap: 6 }), 'history')).toMatchObject({ ch: 6 });
  });

  it('a History Sheet entry never has a Score Differential, even if a field says one', () => {
    expect(resultOf(entry({ scoreDifferential: 11.2 }), 'history')).not.toHaveProperty('sd');
  });
});

describe('the account', () => {
  it('is its stable number, never a name or a card number', () => {
    const m = memberOf(memberAnswer(123456).data.me.reports.memberDetails);
    expect(m).toEqual({ subject: 'member:123456', index: { value: 8.1, low: 7.4 } });
    for (const v of Object.values(PERSONAL)) expect(JSON.stringify(m)).not.toContain(v);
  });

  it('takes an id it doesn’t know as it is, and an index only in range', () => {
    expect(subjectOf('not base64 !')).toBe('not base64 !');
    expect(subjectOf(btoa('Something:1'))).toBe(btoa('Something:1'));
    expect(memberOf({ id: 'x', hcpi: 99 })).toEqual({ subject: 'x' });
    expect(memberOf({ hcpi: 8 })).toBeNull();
  });

  it('keeps a plus handicap', () => {
    expect(memberOf({ id: 'x', hcpi: -1.2 })).toEqual({ subject: 'x', index: { value: -1.2 } });
  });
});
