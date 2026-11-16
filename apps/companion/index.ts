// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { registerRootComponent } from 'expo';
// The background task must be defined before anything else runs: iOS and Android may start the app
// only to run it.
import './src/background';
import { App } from './src/ui/App';

registerRootComponent(App);
