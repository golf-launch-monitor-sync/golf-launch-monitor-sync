<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Security

Please report vulnerabilities privately through GitHub's **Report a vulnerability** (the *Security*
tab of this repository), not in a public issue. Include what is affected and how to reproduce it;
never include a real sign-in, token or anyone's data.

What matters most here:

- a provider sign-in or token leaving the player's device (to a target, a log, a server);
- a way around the load guard;
- a target or a link that can make a client fetch without a plan, or send data somewhere the player
  didn't pair;
- an import token that can read more than its own list of external ids.
