// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The two files by which the host of the universal links vouches for the companion app (spec/deep-links.md,
 * *Universal links*, spec 1.22.0): `/.well-known/apple-app-site-association` (iOS) and `/.well-known/assetlinks.json`
 * (Android). Both must be at the host's root, which the web app's site (below `/golf-launch-monitor-sync/`) isn't:
 * they go to the organisation's own site, the repository `golf-launch-monitor-sync.github.io` (apps/companion/README.md,
 * *Universal links*).
 *
 *   node tools/link-files.mjs <folder>     # writes <folder>/.well-known/… and <folder>/.nojekyll
 *
 * The published app is regsta Consulting GmbH's (its Apple team, its app id); a fork sets its own:
 *   GLMSYNC_APP_ID              iOS bundle id and Android package (default consulting.regsta.glmsync)
 *   GLMSYNC_APPLE_TEAM_ID       the Apple team that signs the iOS app (default the published app's)
 *   GLMSYNC_ANDROID_CERT_SHA256 the SHA-256 fingerprints of the Android signing certificate, comma-separated
 *                               (expo.dev › the project › Credentials › Android). Without one, no assetlinks.json is
 *                               written: Android then opens the page, whose button opens the app.
 * None of these is a secret: the files are public at the host by design.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The path of the links below the host (spec: UNIVERSAL_BASE). */
export const LINK_PATH = '/golf-launch-monitor-sync/link/';
const TEAM = /^[A-Z0-9]{10}$/;
const APP_ID = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** The files' contents; throws for a value that would make a file the platforms refuse. */
export function linkFiles({ appId = 'consulting.regsta.glmsync', teamId = 'XG2RHPU95N', fingerprints = [] } = {}) {
  if (!APP_ID.test(appId)) throw new Error(`Not an app id: ${appId}`);
  if (!TEAM.test(teamId)) throw new Error(`Not an Apple team id: ${teamId}`);
  for (const f of fingerprints) if (!FINGERPRINT.test(f)) throw new Error(`Not a SHA-256 fingerprint (AA:BB:… in capitals): ${f}`);
  const appID = `${teamId}.${appId}`;
  const paths = ['pair', 'sync'].flatMap((k) => [`${LINK_PATH}${k}`, `${LINK_PATH}${k}/`]);
  const aasa = {
    applinks: {
      details: [
        {
          appIDs: [appID],
          // iOS 13 and later: the path exactly (the keys are in the fragment, which any fragment matches).
          components: paths.map((p) => ({ '/': p, comment: 'Golf Stats Sync: a pair or sync link (spec/deep-links.md)' })),
          // Before iOS 13.
          appID,
          paths,
        },
      ],
    },
  };
  const assetlinks = fingerprints.length
    ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: appId, sha256_cert_fingerprints: fingerprints } }]
    : null;
  return { aasa, assetlinks };
}

export function writeLinkFiles(folder, options) {
  const { aasa, assetlinks } = linkFiles(options);
  mkdirSync(join(folder, '.well-known'), { recursive: true });
  // Served as files, not through Jekyll (which leaves out folders that start with a dot).
  writeFileSync(join(folder, '.nojekyll'), '');
  writeFileSync(join(folder, '.well-known', 'apple-app-site-association'), `${JSON.stringify(aasa, null, 2)}\n`);
  if (assetlinks) writeFileSync(join(folder, '.well-known', 'assetlinks.json'), `${JSON.stringify(assetlinks, null, 2)}\n`);
  return { assetlinks: !!assetlinks };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const folder = process.argv[2];
  if (!folder) {
    console.error('Usage: node tools/link-files.mjs <folder>');
    process.exit(2);
  }
  const env = (n) => (process.env[n] ?? '').trim();
  try {
    const out = writeLinkFiles(folder, {
      ...(env('GLMSYNC_APP_ID') ? { appId: env('GLMSYNC_APP_ID') } : {}),
      ...(env('GLMSYNC_APPLE_TEAM_ID') ? { teamId: env('GLMSYNC_APPLE_TEAM_ID') } : {}),
      fingerprints: env('GLMSYNC_ANDROID_CERT_SHA256').split(',').map((f) => f.trim()).filter(Boolean),
    });
    if (!out.assetlinks) console.warn('No GLMSYNC_ANDROID_CERT_SHA256: assetlinks.json not written (Android opens the page instead).');
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
