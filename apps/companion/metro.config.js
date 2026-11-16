// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
// Expo finds the pnpm workspace itself (watch folders, node_modules of the packages).
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
