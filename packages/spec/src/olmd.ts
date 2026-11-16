// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * olmd/1 as TypeScript types: the same shape as spec/olmd/olmd-1.schema.json, which is the
 * authority - a change there comes here in the same commit. Unknown values are left out, never null.
 */

export const FORMAT = 'olmd/1' as const;

export type Reason = 'connect' | 'open' | 'timer' | 'manual' | 'backfill';
export const REASONS: readonly Reason[] = ['connect', 'open', 'timer', 'manual', 'backfill'];

export type SessionKind =
  | 'range'
  | 'simulator'
  | 'shot_analysis'
  | 'map_my_bag'
  | 'combine'
  | 'find_my_distance'
  | 'virtual_range'
  | 'course_practice'
  | 'other';

export type NoticeCode = 'auth_expired' | 'guard_limit' | 'provider_unavailable' | 'provider_blocked' | 'partial';

/** RFC 3339 with zone. */
export type Time = string;
export type Extra = Record<string, unknown>;

export interface Shot {
  played_at?: Time;
  club?: string;
  club_raw?: string;
  ball?: {
    speed_mps?: number;
    launch_angle_deg?: number;
    launch_direction_deg?: number;
    spin_rpm?: number;
    spin_axis_deg?: number;
  };
  club_delivery?: {
    speed_mps?: number;
    attack_angle_deg?: number;
    path_deg?: number;
    face_angle_deg?: number;
    face_to_path_deg?: number;
    dynamic_loft_deg?: number;
    smash_factor?: number;
  };
  flight?: {
    carry_m?: number;
    total_m?: number;
    side_m?: number;
    total_side_m?: number;
    curve_m?: number;
    apex_m?: number;
    landing_angle_deg?: number;
    flight_time_s?: number;
  };
  target?: { distance_m?: number };
  extra?: Extra;
}

export interface Session {
  external_id: string;
  kind: SessionKind;
  kind_raw?: string;
  started_at?: Time;
  location?: { name?: string; facility?: string };
  device?: { maker: string; model?: string };
  shots: Shot[];
  extra?: Extra;
}

export interface RoundShot {
  hole: number;
  number: number;
  club?: string;
  club_raw?: string;
  lie_before?: string;
  lie_after?: string;
  result?: string;
  penalty_strokes?: number;
  to_pin_before_m?: number;
  to_pin_after_m?: number;
  rest_side_m?: number;
  rest_long_m?: number;
  target_m?: number;
  carry_m?: number;
  total_m?: number;
  extra?: Extra;
}

export interface Round {
  external_id: string;
  kind?: 'simulator' | 'course';
  played_at?: Time;
  course?: { name: string };
  tee?: { name: string };
  holes_played?: number;
  par?: number;
  gross_score?: number;
  to_par?: number;
  stats?: {
    putts?: number;
    greens_in_regulation?: number;
    fairways_hit?: number;
    fairways_left?: number;
    fairways_right?: number;
    drive_average_m?: number;
  };
  holes?: { number: number; par?: number; score?: number; putts?: number; gir?: boolean }[];
  /** Absent: not fetched (yet). Empty: the provider has none. */
  shots?: RoundShot[];
  extra?: Extra;
}

export interface Batch {
  format: typeof FORMAT;
  provider: string;
  account_ref: string;
  generated_at: Time;
  generator?: { name: string; version?: string };
  sync?: { plan_id?: string; reason?: Reason };
  sessions: Session[];
  rounds: Round[];
  failed?: { external_id: string; started_at?: Time }[];
  progress?: { more_available?: boolean; oldest_seen?: Time; skipped_known?: number };
  notice?: { code: NoticeCode; message?: string; until?: Time };
  extra?: Extra;
}
