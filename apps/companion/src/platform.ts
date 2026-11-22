// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the phone brings: the secure store, ordinary storage, the share sheet. Everything else is in
 * src/lib, where it is tested without a phone.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FileOut, Storage } from '@glmsync/core';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import type { Secrets } from './lib/secrets';
import { makeServices, type Services } from './lib/services';
import type { Blobs } from './lib/tests';

/**
 * Keychain / Keystore. "After first unlock": the background task must read the sign-in while the
 * phone is locked in a pocket; "this device only": it never moves to another phone with a backup.
 */
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export const secureStore: Secrets = {
  get: (key) => SecureStore.getItemAsync(key, OPTIONS),
  set: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  remove: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};

export const storage: Storage = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: (key) => AsyncStorage.removeItem(key),
};

/**
 * Files in the app's own document folder, for a test scenario (spec/test-mode.md): it can be far larger than storage
 * takes on Android. Readable after the phone's first unlock, like the secure store, so the background task finds it.
 */
export const blobs: Blobs = {
  async get(name) {
    const file = new File(Paths.document, name);
    return file.exists ? file.text() : null;
  },
  async set(name, text) {
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
    file.create();
    file.write(text);
  },
  async remove(name) {
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
  },
};

/** A file to the share sheet (save to Files, send by mail …). Throws when the phone can't share. */
export async function shareFile(out: FileOut): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone.');
  const name = out.name.replace(/[^A-Za-z0-9._-]/g, '_');
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(out.text);
  // The file stays in the app's own cache: on Android the app it is shared with may read it only after
  // the share sheet has closed. The next file of the same name replaces it; the rest the system clears.
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: name });
}

export const version: string = Constants.expoConfig?.version ?? '0.0.0';

let shared: Promise<Services> | null = null;

/** This runtime's parts, loaded once (the screen and the background task each have their own runtime). */
export function services(): Promise<Services> {
  if (!shared) {
    const s = makeServices({ secrets: secureStore, storage, blobs, writeFile: shareFile, version, os: Platform.OS });
    shared = s.load().then(
      () => s,
      (e: unknown) => {
        shared = null; // try again next time, rather than keep a broken start
        throw e;
      },
    );
  }
  return shared;
}
