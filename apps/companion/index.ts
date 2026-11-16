// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { registerRootComponent } from 'expo';
// The background task must be defined before anything else runs: iOS and Android may start the app
// only to run it.
import './src/background';
// Android: the sync service another app binds to runs this without a screen (spec/deep-links.md).
import './src/nudge';
import { App } from './src/ui/App';

registerRootComponent(App);
