/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { ClientConversation, LeadCard } from "./model";

/** Inside: test client conversations of the preview (made-up people, the mockup's data). */
export function makeClientConversations(now: number): ClientConversation[] {
    void now;
    return [];
}

/** Inside: test lead cards of the preview, by conversation id. */
export function makeLeadCards(now: number): Record<string, LeadCard> {
    void now;
    return {};
}
