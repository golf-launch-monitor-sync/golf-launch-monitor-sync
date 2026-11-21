// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** The toolbar popup: the sign-in, the connected apps, the guard's counts; the handicap record read along on golf.de. */

import { hcpPanel, heading, statusPanel } from './page.ts';

heading('app.name');
statusPanel(document.getElementById('status') as HTMLElement, { onPortal: () => window.close() });
hcpPanel(document.getElementById('hcp') as HTMLElement, { onGolfde: () => window.close() });
