/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixEvent, MXID_PATTERN, type RoomMember } from "matrix-js-sdk/src/matrix";
import { removeHiddenChars } from "matrix-js-sdk/src/utils";

import { _t } from "../../languageHandler";

/** Direction marks and overrides: the js-sdk disambiguates names containing them (see room-member.ts). */
const LTR_RTL_PATTERN = /[‎‏‪- ]/;

/**
 * Inside: whether a member's Matrix ID must stay next to their display name for safety. The js-sdk adds
 * it when another member shares the name, when the name looks like a Matrix ID, or when it contains
 * direction marks; only the first case is dropped in timeline texts and previews.
 */
export function needsMxidForSafety(rawDisplayName: string | undefined): boolean {
    if (!rawDisplayName) return true;
    return MXID_PATTERN.test(removeHiddenChars(rawDisplayName)) || LTR_RTL_PATTERN.test(rawDisplayName);
}

/**
 * Inside: the member's name without the " (@user:server)" the js-sdk appends when two members share a
 * display name. Used in timeline texts and room list previews; the member list and user info keep it.
 */
export function getMemberNameWithoutMxid(member: RoomMember): string {
    const suffix = ` (${member.userId})`;
    if (!member.disambiguate || !member.name.endsWith(suffix) || needsMxidForSafety(member.rawDisplayName)) {
        return member.name;
    }
    return member.name.slice(0, -suffix.length);
}

export function getSenderName(event: MatrixEvent): string {
    return (
        (event.sender ? getMemberNameWithoutMxid(event.sender) : undefined) ?? event.getSender() ?? _t("common|someone")
    );
}
