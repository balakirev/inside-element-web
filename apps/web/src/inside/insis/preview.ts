/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import SdkConfig from "../../SdkConfig";
import { MatrixClientPeg } from "../../MatrixClientPeg";

/**
 * Inside: whether this user sees the INSIS screens on test data — the "Помощник" folder, client conversations and
 * the lead card — before INSIS is connected. Only the Matrix IDs listed in `inside_insis_preview_users` of
 * config.json (the owner and the demo accounts, decision of 30.10.2026); everyone else sees Lobby as before, with no
 * folder for clients or the assistant (MATRIX-SIDE-SPEC M-0.6: no INSIS — no such folders at all).
 */
export function isInsisPreviewUser(userId: string | null | undefined = MatrixClientPeg.get()?.getUserId()): boolean {
    if (!userId) return false;
    const users = SdkConfig.get().inside_insis_preview_users;
    return Array.isArray(users) && users.includes(userId);
}
