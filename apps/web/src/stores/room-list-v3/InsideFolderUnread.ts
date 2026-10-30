/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useCallback, useContext, useState } from "react";

import { type SDKContextClass } from "../../contexts/SDKContextClass.ts";
import { SDKContext } from "../../contexts/SDKContext.ts";
import { useEventEmitter } from "../../hooks/useEventEmitter";
import { type NotificationState } from "../notifications/NotificationState";
import { UPDATE_STATUS_INDICATOR } from "../notifications/RoomNotificationStateStore";
import { StaticNotificationState } from "../notifications/StaticNotificationState";
import { SummarizedNotificationState } from "../notifications/SummarizedNotificationState";
import { INSIDE_FOLDERS } from "./InsideFolderStore";
import RoomListStoreV3, { RoomListStoreV3Event } from "./RoomListStoreV3";
import { FilterEnum } from "./skip-list/filters";
import { NotificationLevel } from "../notifications/NotificationLevel";
import { InsisPreviewStore, InsisStoreEvent } from "../../inside/insis/InsisPreviewStore";
import { isInsisPreviewUser } from "../../inside/insis/preview";

export interface InsideFolderUnread {
    /** The number of unread chats of all chats, at the loudest level among them; none when all are read. */
    all?: NotificationState;
    /** The same for each folder. */
    folders: Map<FilterEnum, NotificationState>;
}

function toState(summary: SummarizedNotificationState, extraChats = 0): NotificationState | undefined {
    const chats = summary.numUnreadStates + extraChats;
    if (chats <= 0) return undefined;
    const level =
        extraChats > 0 && summary.level < NotificationLevel.Notification
            ? NotificationLevel.Notification
            : summary.level;
    return StaticNotificationState.forCount(chats, level);
}

/** Inside: unread client conversations of INSIS — they count in "All" and "Clients" for the preview users. */
function insisUnreadChats(sdkContext: SDKContextClass): number {
    if (!isInsisPreviewUser(sdkContext.client?.getUserId())) return 0;
    return InsisPreviewStore.instance.clientConversations.filter((c) => c.unread > 0).length;
}

/**
 * Inside: the number of unread chats of all chats and of each folder, as other messengers show on their
 * folders (counted in chats, not messages).
 */
export function getInsideFolderUnread(sdkContext: SDKContextClass): InsideFolderUnread {
    const rooms = (sdkContext.client?.getRooms() ?? []).filter(
        (room) => !room.isSpaceRoom() && ["join", "invite"].includes(room.getMyMembership()),
    );
    const all = new SummarizedNotificationState();
    const summaries = new Map(INSIDE_FOLDERS.map((filter) => [filter, new SummarizedNotificationState()]));
    for (const room of rooms) {
        const state = sdkContext.roomNotificationStateStore.getRoomState(room);
        all.add(state);
        for (const [filter, summary] of summaries) {
            if (RoomListStoreV3.instance.roomMatchesFilter(room, filter)) summary.add(state);
        }
    }
    const clients = insisUnreadChats(sdkContext);
    const folders = new Map<FilterEnum, NotificationState>();
    for (const [filter, summary] of summaries) {
        const state = toState(summary, filter === FilterEnum.ClientsFilter ? clients : 0);
        if (state) folders.set(filter, state);
    }
    return { all: toState(all, clients), folders };
}

/** {@link getInsideFolderUnread}, kept up to date. */
export function useInsideFolderUnread(): InsideFolderUnread {
    const sdkContext = useContext(SDKContext);
    const [unread, setUnread] = useState(() => getInsideFolderUnread(sdkContext));
    const update = useCallback(() => setUnread(getInsideFolderUnread(sdkContext)), [sdkContext]);
    useEventEmitter(sdkContext.roomNotificationStateStore, UPDATE_STATUS_INDICATOR, update);
    useEventEmitter(RoomListStoreV3.instance, RoomListStoreV3Event.ListsUpdate, update);
    useEventEmitter(InsisPreviewStore.instance, InsisStoreEvent.Changed, update);
    return unread;
}
