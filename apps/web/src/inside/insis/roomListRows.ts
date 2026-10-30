/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { AssistantSession, ClientConversation } from "./model";
import type { InsisOpenTarget, InsisPreviewStore } from "./InsisPreviewStore";

/*
 * Inside: rows of INSIS items in the Matrix room list. The list is virtualised by room ids, so a client
 * conversation or a waiting assistant session gets a row id of its own, with a prefix no Matrix room id can have
 * (room ids start with "!"). The "All" folder merges them with rooms by last activity here, in one place
 * (ADR-069 К-2: the merge is on the client).
 */

export const CLIENT_ROW_PREFIX = "inside-insis-client:";
export const ASSISTANT_ROW_PREFIX = "inside-insis-assistant:";

export const clientRowId = (conversationId: string): string => CLIENT_ROW_PREFIX + conversationId;
export const assistantRowId = (sessionId: string): string => ASSISTANT_ROW_PREFIX + sessionId;

export function isInsisRowId(id: string | null | undefined): boolean {
    return !!id && (id.startsWith(CLIENT_ROW_PREFIX) || id.startsWith(ASSISTANT_ROW_PREFIX));
}

/** What an INSIS row id stands for. */
export function parseInsisRowId(id: string): InsisOpenTarget | undefined {
    if (id.startsWith(CLIENT_ROW_PREFIX)) return { kind: "client", id: id.slice(CLIENT_ROW_PREFIX.length) };
    if (id.startsWith(ASSISTANT_ROW_PREFIX)) return { kind: "assistant", id: id.slice(ASSISTANT_ROW_PREFIX.length) };
    return undefined;
}

/** The row id of what is open in the main area, if it has a row. */
export function rowIdOfTarget(target: InsisOpenTarget | null): string | undefined {
    if (!target) return undefined;
    return target.kind === "client" ? clientRowId(target.id) : assistantRowId(target.id);
}

/** Open the item of a row: a client chat, or an assistant session in the "Помощник" folder. */
export function openInsisRow(store: InsisPreviewStore, rowId: string): void {
    const target = parseInsisRowId(rowId);
    if (!target) return;
    if (target.kind === "assistant") store.setAssistantFolderActive(true);
    store.open(target);
}

/** An extra row and its last activity. */
export interface ExtraRow<T> {
    row: T;
    ts: number;
}

/**
 * Merge extra rows into a list of rooms that is already in its order (most recent first): each extra row goes
 * before the first room that is older than it, the rooms keep their order. Pinned rows go first.
 */
export function mergeByActivity<T>(
    rooms: readonly T[],
    roomTs: (room: T) => number,
    extras: readonly ExtraRow<T>[],
    pinned: readonly T[] = [],
): T[] {
    const sorted = [...extras].sort((a, b) => b.ts - a.ts);
    const out: T[] = [...pinned];
    let j = 0;
    for (const room of rooms) {
        const ts = roomTs(room);
        while (j < sorted.length && sorted[j].ts > ts) out.push(sorted[j++].row);
        out.push(room);
    }
    while (j < sorted.length) out.push(sorted[j++].row);
    return out;
}

/** Which INSIS rows a folder of the room list shows. */
export interface InsisRowsOfFolder {
    conversations: readonly ClientConversation[];
    /** Assistant sessions waiting for a confirmation, pinned at the top of "All chats". */
    pinnedSessions: readonly AssistantSession[];
}

/**
 * "All chats" shows the client conversations and the waiting assistant sessions, "Clients" only the conversations,
 * other folders none.
 */
export function insisRowsForFolder(store: InsisPreviewStore, folder: "all" | "clients" | "other"): InsisRowsOfFolder {
    if (folder === "other") return { conversations: [], pinnedSessions: [] };
    return {
        conversations: store.clientConversations,
        pinnedSessions: folder === "all" ? store.assistantSessions.filter((s) => s.awaitingConfirmation) : [],
    };
}
