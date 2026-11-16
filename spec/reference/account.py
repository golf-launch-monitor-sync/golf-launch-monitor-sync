# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""`account_ref`: which provider account a batch comes from, without naming it (spec/olmd.md).

base64url, unpadded, of SHA-256("olmd-account-v1|" + salt + "|" + provider + "|" + subject).
`subject` is the provider's stable id of the account (for Trackman the sign-in token's `sub`), never
an e-mail or a name; `salt` is the `account_salt` the target handed out at pairing (a file export
uses a random salt the client keeps). So two accounts tell apart, nothing identifies one, and the
same account looks different to different targets.
"""

from __future__ import annotations

import base64
import hashlib


def account_ref(salt: str, provider: str, subject: str) -> str:
    raw = f"olmd-account-v1|{salt}|{provider}|{subject}".encode()
    return base64.urlsafe_b64encode(hashlib.sha256(raw).digest()).rstrip(b"=").decode()
