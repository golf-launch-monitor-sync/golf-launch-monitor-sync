<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# glmsync-power

The native part of Golf Stats Sync's engine on the iPhone (an Expo module): what keeps iOS from waking the app
(*Background App Refresh*, Low Power Mode) and the end of a background task's time, which `expo-background-task`'s
own module drops before JavaScript hears it. Read only; nothing is kept.

```ts
import { GlmsyncPower } from 'glmsync-power';
import { powerOf } from 'glmsync-engine';

const power = powerOf(GlmsyncPower); // null on Android or a build without the module: then nothing is said
const state = await power.powerState(); // { refresh: 'available' | 'denied' | 'restricted' | null, lowPower }
const sub = power.onTaskExpired(() => controller.abort()); // the signal of backgroundWork
```

A new native build is needed once the package is added (it has Swift code). Built from
`apps/companion/modules/glmsync-power` of <https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync>,
attached to each release `engine-v<version>`. MIT.
