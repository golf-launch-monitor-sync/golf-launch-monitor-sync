// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** The start page: what this is, the extension, and the way by hand. */

import { INSTALL_URL, storeFor } from '@glmsync/browser';
import { $, texts } from './texts.ts';

texts('app.name');
const install = $('install-link') as HTMLAnchorElement;
install.href = storeFor(navigator.userAgent) ?? INSTALL_URL;
