/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useEffect, useMemo, useState } from "react";
import { type Room, type RoomMember, UserEvent } from "matrix-js-sdk/src/matrix";
import { throttle } from "lodash";

import { useTypedEventEmitter } from "./useEventEmitter";
import { isPresenceEnabled } from "../utils/presence";

/** Inside: how many of the given room members are online, or 0 when presence is disabled. */
export function countOnlineMembers(room: Room, members: RoomMember[]): number {
    if (!isPresenceEnabled(room.client)) return 0;
    return members.filter((member) => {
        const user = member.user ?? room.client.getUser(member.userId);
        return user?.presence === "online";
    }).length;
}

/**
 * Inside: the number of joined members that are online, for the room header status
 * («6 участников · 2 в сети»). Follows presence updates, throttled.
 */
export function useOnlineMemberCount(room: Room, members: RoomMember[], throttleWait = 2500): number {
    const [count, setCount] = useState(() => countOnlineMembers(room, members));

    const throttledUpdate = useMemo(
        () =>
            throttle(() => setCount(countOnlineMembers(room, members)), throttleWait, {
                leading: true,
                trailing: true,
            }),
        [room, members, throttleWait],
    );
    useEffect(() => {
        setCount(countOnlineMembers(room, members));
        return () => throttledUpdate.cancel();
    }, [room, members, throttledUpdate]);

    useTypedEventEmitter(room.client, UserEvent.Presence, throttledUpdate);
    useTypedEventEmitter(room.client, UserEvent.CurrentlyActive, throttledUpdate);
    return count;
}
