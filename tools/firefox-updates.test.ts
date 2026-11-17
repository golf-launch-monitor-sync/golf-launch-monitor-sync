// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Firefox's update list from the releases (LMS-W3-N-b, 17 Nov: an extension loaded by hand never updates; signed and
 * self-distributed, Firefox asks the manifest's `update_url`).
 */

import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GECKO_ID } from '../apps/extension/src/manifest.ts';
// @ts-expect-error - a plain ES module without types
import { looksLikeXpi, newestSigned, updatesJson, versionOf, write, XPI_NAME } from './firefox-updates.mjs';

const REPO = 'golf-launch-monitor-sync/golf-launch-monitor-sync';
const DL = `https://github.com/${REPO}/releases/download`;
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const asset = (tag: string, name: string, extra: Record<string, unknown> = {}) => ({
  name,
  browser_download_url: `${DL}/${tag}/${name}`,
  size: 1000,
  ...extra,
});
const release = (tag: string, names: string[], extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: names.map((n) => asset(tag, n)),
  ...extra,
});

describe('the newest signed release', () => {
  it('takes the highest version with an .xpi, by number, not by text or order', () => {
    const list = [
      release('extension-v0.9.0', ['golf-launch-monitor-sync-firefox-0.9.0.xpi']),
      release('extension-v0.10.0', ['golf-launch-monitor-sync-firefox-0.10.0.xpi']),
      release('extension-v0.11.0', ['golf-launch-monitor-sync-chrome-edge-0.11.0.zip']), // not signed yet
    ];
    expect(newestSigned(list, REPO)).toEqual({ version: '0.10.0', url: `${DL}/extension-v0.10.0/golf-launch-monitor-sync-firefox-0.10.0.xpi` });
  });

  it("leaves out the companion app's pre-release, drafts, other tags and files of other repositories", () => {
    const list = [
      release('companion-android', ['x.xpi'], { prerelease: true }),
      release('extension-v2.0.0', ['a.xpi'], { draft: true }),
      release('extension-v3.0', ['a.xpi']),
      { tag_name: 'extension-v4.0.0', assets: [{ name: 'a.xpi', browser_download_url: 'https://evil.example/a.xpi', size: 5 }] },
      { tag_name: 'extension-v5.0.0', assets: [asset('extension-v5.0.0', 'big.xpi', { size: 50 * 1024 * 1024 })] },
      null,
      'junk',
    ];
    expect(newestSigned(list, REPO)).toBeNull();
    expect(newestSigned({ message: 'Not Found' }, REPO)).toBeNull();
  });

  it("prefers the package's own name when a release has more than one .xpi", () => {
    const r = release('extension-v1.0.0', ['old-name.xpi', 'golf-launch-monitor-sync-firefox-1.0.0.xpi']);
    expect(newestSigned([r], REPO)?.url).toMatch(/-firefox-1\.0\.0\.xpi$/);
  });

  it('reads versions only from extension-v<major>.<minor>.<patch>', () => {
    expect(versionOf('extension-v1.2.3')).toEqual([1, 2, 3]);
    expect(versionOf('extension-v1.2')).toBeNull();
    expect(versionOf('v1.2.3')).toBeNull();
  });
});

describe('the update manifest', () => {
  it("names the add-on's id, its version, link and hash; without a signed one an empty list", () => {
    const u = updatesJson({ version: '1.0.0', url: `${DL}/extension-v1.0.0/a.xpi` }, 'ab'.repeat(32));
    expect(u).toEqual({ addons: { [GECKO_ID]: { updates: [{ version: '1.0.0', update_link: `${DL}/extension-v1.0.0/a.xpi`, update_hash: `sha256:${'ab'.repeat(32)}` }] } } });
    expect(updatesJson(null, null)).toEqual({ addons: { [GECKO_ID]: { updates: [] } } });
  });

  it('takes only a zip of a sane size as an add-on', () => {
    expect(looksLikeXpi(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe(true);
    expect(looksLikeXpi(new TextEncoder().encode('<html>Not Found</html>'))).toBe(false);
    expect(looksLikeXpi(new Uint8Array(0))).toBe(false);
  });
});

describe('writing it into the site', () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  const respond = (body: unknown, status = 200) =>
    ({ ok: status < 300, status, json: async () => body, arrayBuffer: async () => (body as Uint8Array).buffer }) as unknown as Response;

  it('writes updates.json and the file itself, with its hash, reading the API with the workflow token', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ff-'));
    dirs.push(out);
    const asked: { url: string; auth: string | undefined }[] = [];
    const fetchFn = async (url: string, init?: { headers?: Record<string, string> }) => {
      asked.push({ url, auth: init?.headers?.authorization });
      return url.includes('/releases?') ? respond([release('extension-v0.1.1', ['golf-launch-monitor-sync-firefox-0.1.1.xpi'])]) : respond(zip);
    };
    const signed = await write(out, { fetchFn, env: { GITHUB_REPOSITORY: REPO, GH_TOKEN: 'workflow-token' } });
    expect(signed.version).toBe('0.1.1');
    expect(asked[0]).toEqual({ url: `https://api.github.com/repos/${REPO}/releases?per_page=100`, auth: 'Bearer workflow-token' });
    expect(new Uint8Array(readFileSync(join(out, 'firefox', XPI_NAME)))).toEqual(zip);
    const u = JSON.parse(readFileSync(join(out, 'firefox', 'updates.json'), 'utf8'));
    expect(u.addons[GECKO_ID].updates[0]).toMatchObject({ version: '0.1.1', update_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) });
  });

  it('no signed release: an empty list and no file', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ff-'));
    dirs.push(out);
    await write(out, { fetchFn: async () => respond([]), env: { GITHUB_REPOSITORY: REPO } });
    expect(JSON.parse(readFileSync(join(out, 'firefox', 'updates.json'), 'utf8'))).toEqual({ addons: { [GECKO_ID]: { updates: [] } } });
    expect(existsSync(join(out, 'firefox', XPI_NAME))).toBe(false);
  });

  it('fails (so the site already out stays) when GitHub answers an error or the file is no add-on', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ff-'));
    dirs.push(out);
    await expect(write(out, { fetchFn: async () => respond({}, 503), env: {} })).rejects.toThrow(/503/);
    const junk = async (url: string) =>
      url.includes('/releases?') ? respond([release('extension-v1.0.0', ['a.xpi'])]) : respond(new TextEncoder().encode('<html>'));
    await expect(write(out, { fetchFn: junk, env: { GITHUB_REPOSITORY: REPO } })).rejects.toThrow(/no add-on/);
  });
});
