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
import { type FilterEnum } from "./skip-list/filters";

export interface InsideFolderUnread {
    /** The number of unread chats of all chats, at the loudest level among them; none when all are read. */
    all?: NotificationState;
    /** The same for each folder. */
    folders: Map<FilterEnum, NotificationState>;
}

function toState(summary: SummarizedNotificationState): NotificationState | undefined {
    return summary.numUnreadStates > 0
        ? StaticNotificationState.forCount(summary.numUnreadStates, summary.level)
        : undefined;
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
    const folders = new Map<FilterEnum, NotificationState>();
    for (const [filter, summary] of summaries) {
        const state = toState(summary);
        if (state) folders.set(filter, state);
    }
    return { all: toState(all), folders };
}

/** {@link getInsideFolderUnread}, kept up to date. */
export function useInsideFolderUnread(): InsideFolderUnread {
    const sdkContext = useContext(SDKContext);
    const [unread, setUnread] = useState(() => getInsideFolderUnread(sdkContext));
    const update = useCallback(() => setUnread(getInsideFolderUnread(sdkContext)), [sdkContext]);
    useEventEmitter(sdkContext.roomNotificationStateStore, UPDATE_STATUS_INDICATOR, update);
    useEventEmitter(RoomListStoreV3.instance, RoomListStoreV3Event.ListsUpdate, update);
    return unread;
}
