// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { canHaveExtension, INSTALL_URL, storeFor } from './config.ts';

// Made-up but well-formed user agents of each kind.
const UA = {
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.0.0 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 16; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 16; Mobile; rv:145.0) Gecko/145.0 Firefox/145.0',
};

describe('which browser can run the extension', () => {
  it('Chrome, Edge and Firefox on a computer, Firefox on Android', () => {
    expect(canHaveExtension(UA.chromeMac)).toBe(true);
    expect(canHaveExtension(UA.edgeWin)).toBe(true);
    expect(canHaveExtension(UA.firefoxMac)).toBe(true);
    expect(canHaveExtension(UA.firefoxAndroid)).toBe(true);
  });

  it('not Safari, nothing on an iPhone, not Chrome on Android, nothing unknown', () => {
    expect(canHaveExtension(UA.safariMac)).toBe(false);
    expect(canHaveExtension(UA.safariIphone)).toBe(false);
    expect(canHaveExtension(UA.chromeIphone)).toBe(false);
    expect(canHaveExtension(UA.chromeAndroid)).toBe(false);
    expect(canHaveExtension('')).toBe(false);
  });
});

describe('where to install it', () => {
  it('no store yet: the installation guide', () => {
    expect(storeFor(UA.chromeMac) ?? INSTALL_URL).toBe(INSTALL_URL);
    expect(storeFor(UA.firefoxMac) ?? INSTALL_URL).toBe(INSTALL_URL);
  });
});
