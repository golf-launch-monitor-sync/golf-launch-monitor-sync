// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The companion app's configuration. The published app is the one built by regsta Consulting GmbH
 * (its Expo organisation and Apple team); a fork sets its own through the environment:
 *
 *   GLMSYNC_APP_ID          iOS bundle id and Android package (default consulting.regsta.glmsync)
 *   GLMSYNC_EXPO_OWNER      the Expo account or organisation that owns the EAS project
 *   GLMSYNC_EAS_PROJECT_ID  the EAS project (also where its updates come from)
 *
 * None of these is a secret. Secrets (the Expo token) live only in the release environment of
 * GitHub Actions (apps/companion/README.md, "Builds and updates").
 */
import type { ExpoConfig } from 'expo/config';

/** The EAS project of the published app (expo.dev › regsta-consulting-gmbh › golf-launch-monitor-sync). */
const EAS_PROJECT_ID = '3211863d-c9de-40df-8a07-860c44d75166';

const env = (name: string) => (process.env[name] ?? '').trim();
const id = env('GLMSYNC_APP_ID') || 'consulting.regsta.glmsync';
const owner = env('GLMSYNC_EXPO_OWNER') || 'regsta-consulting-gmbh';
const projectId = env('GLMSYNC_EAS_PROJECT_ID') || EAS_PROJECT_ID;

const config: ExpoConfig = {
  name: 'Golf Launch Monitor Sync',
  slug: 'golf-launch-monitor-sync',
  owner,
  scheme: 'glmsync',
  version: '0.21.0',
  // The native part decides which builds an update can run on (as in the target apps that use EAS).
  runtimeVersion: { policy: 'fingerprint' },
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: id,
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: id,
    // The sign-ins and the import tokens must not travel into a cloud backup of the phone.
    allowBackup: false,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0F2A1F' },
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.RECORD_AUDIO',
      'android.permission.CAMERA',
      // expo-notifications (the iOS wake) would ask for it; this app shows no notification.
      'android.permission.POST_NOTIFICATIONS',
    ],
  },
  plugins: [
    'expo-localization',
    'expo-background-task',
    // The wake (spec/wake.md): silent pushes only - nothing is ever shown, so no permission is asked for.
    // `remote-notification` in UIBackgroundModes lets iOS start the app for one; production APNs, as every
    // build goes to TestFlight.
    ['expo-notifications', { enableBackgroundRemoteNotifications: true, mode: 'production' }],
    ['expo-secure-store', { configureAndroidBackup: true, faceIDPermission: false }],
  ],
  ...(projectId
    ? {
        updates: { url: `https://u.expo.dev/${projectId}`, checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0 },
        extra: { eas: { projectId } },
      }
    : {}),
};

export default config;
