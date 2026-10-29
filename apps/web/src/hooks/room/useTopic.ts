/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useEffect, useState } from "react";
import {
    EventType,
    type MatrixEvent,
    type Room,
    RoomStateEvent,
    ContentHelpers,
    type MRoomTopicEventContent,
} from "matrix-js-sdk/src/matrix";

import { useTypedEventEmitter } from "../useEventEmitter";
import { getRoomI18nTopic, ROOM_TOPIC_I18N_EVENT } from "../../utils/InsideLocalizedNames";

export const getTopic = (room?: Room): ContentHelpers.TopicState | null => {
    const content = room?.currentState?.getStateEvents(EventType.RoomTopic, "")?.getContent<MRoomTopicEventContent>();
    return !!content ? ContentHelpers.parseTopicContent(content) : null;
};

/**
 * Inside: the topic to show. A system room's topic in the interface language (`is.ins.room.topic_i18n`) when
 * it has one, otherwise the room's topic. Editing keeps using {@link getTopic}.
 */
export const getShownTopic = (room?: Room): ContentHelpers.TopicState | null => {
    const i18nTopic = room ? getRoomI18nTopic(room) : undefined;
    return i18nTopic ? { text: i18nTopic } : getTopic(room);
};

/**
 * Helper to retrieve the room topic for given room
 * @param room
 * @returns the raw text and an html parsion version of the room topic
 */
export function useTopic(room?: Room): ContentHelpers.TopicState | null {
    const [topic, setTopic] = useState(getShownTopic(room));
    useTypedEventEmitter(room?.currentState, RoomStateEvent.Events, (ev: MatrixEvent) => {
        if (ev.getType() !== EventType.RoomTopic && ev.getType() !== ROOM_TOPIC_I18N_EVENT) return;
        setTopic(getShownTopic(room));
    });
    useEffect(() => {
        setTopic(getShownTopic(room));
    }, [room]);

    return topic;
}
