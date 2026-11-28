// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UNIVERSAL_BASE } from '../packages/spec/src/deepLinks.ts';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - a plain ES module without types
import { LINK_PATH, linkFiles, writeLinkFiles } from './link-files.mjs';

type Files = { aasa: { applinks: { details: { appIDs: string[]; components: { '/': string }[]; paths: string[] }[] } }; assetlinks: { target: unknown }[] | null };
const files = linkFiles as (o?: Record<string, unknown>) => Files;
const FP = Array.from({ length: 32 }, (_, i) => i.toString(16).toUpperCase().padStart(2, '0')).join(':');

describe('the files that vouch for the companion app (spec 1.22.0)', () => {
  it('name the spec’s path, pair, sync and (spec 1.27.0) signin only', () => {
    expect(new URL(UNIVERSAL_BASE).pathname).toBe(LINK_PATH);
    const { aasa } = files();
    const d = aasa.applinks.details[0]!;
    expect(d.appIDs).toEqual(['XG2RHPU95N.consulting.regsta.glmsync']);
    expect(d.components.map((c) => c['/'])).toEqual([`${LINK_PATH}pair`, `${LINK_PATH}pair/`, `${LINK_PATH}sync`, `${LINK_PATH}sync/`, `${LINK_PATH}signin`, `${LINK_PATH}signin/`]);
    expect(d.paths).toEqual(d.components.map((c) => c['/']));
  });

  it('write assetlinks.json only with a fingerprint, and refuse what the platforms would', () => {
    expect(files().assetlinks).toBeNull();
    expect(files({ fingerprints: [FP] }).assetlinks?.[0]?.target).toEqual({ namespace: 'android_app', package_name: 'consulting.regsta.glmsync', sha256_cert_fingerprints: [FP] });
    expect(() => linkFiles({ fingerprints: [FP.toLowerCase()] })).toThrow(/fingerprint/);
    expect(() => linkFiles({ teamId: 'team' })).toThrow(/team/);
    expect(() => linkFiles({ appId: 'glmsync' })).toThrow(/app id/);
  });

  it('go into the folder as the host serves them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'links-'));
    try {
      expect(writeLinkFiles(dir, { fingerprints: [FP] })).toEqual({ assetlinks: true });
      expect(existsSync(join(dir, '.nojekyll'))).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, '.well-known', 'apple-app-site-association'), 'utf8'))).toEqual(files().aasa);
      expect(JSON.parse(readFileSync(join(dir, '.well-known', 'assetlinks.json'), 'utf8'))).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
