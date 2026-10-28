/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// Inside: the events of the "Media / Files / Links" tabs of the room summary card (Lobby redesign).
// Built like FilePanel: a server-side filtered timeline set of the room, walked backwards with a
// TimelineWindow, so the main timeline of the room is not paginated.

import { useCallback, useEffect, useRef, useState } from "react";
import {
    EventTimeline,
    type EventTimelineSet,
    Filter,
    type IRoomTimelineData,
    type MatrixClient,
    type MatrixEvent,
    MsgType,
    type Room,
    RoomEvent,
    TimelineWindow,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { isVoiceMessage } from "../../../utils/EventUtils";

export type InsideMediaTab = "media" | "files" | "links";

/** Events requested from the server per page. */
const PAGE_SIZE = 50;
/** Pages fetched at most for one "load more" when none of them has an event for the tab. */
const MAX_EMPTY_PAGES = 5;

const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

/** The http(s) URLs in the plain-text body of a message, without trailing punctuation. */
export function findUrls(body: unknown): string[] {
    if (typeof body !== "string") return [];
    return (body.match(URL_REGEX) ?? []).map((url) => url.replace(/[.,;:!?)\]}»"']+$/, ""));
}

function isMessage(ev: MatrixEvent): boolean {
    return ev.getType() === "m.room.message" && !ev.isRedacted() && !ev.isDecryptionFailure();
}

/** Whether the event belongs to the tab: images and videos, files (and audio, but no voice messages), links. */
export function eventMatchesTab(ev: MatrixEvent, tab: InsideMediaTab): boolean {
    if (!isMessage(ev)) return false;
    const content = ev.getContent();
    switch (tab) {
        case "media":
            return content.msgtype === MsgType.Image || content.msgtype === MsgType.Video;
        case "files":
            return content.msgtype === MsgType.File || (content.msgtype === MsgType.Audio && !isVoiceMessage(ev));
        case "links":
            return (
                (content.msgtype === MsgType.Text ||
                    content.msgtype === MsgType.Notice ||
                    content.msgtype === MsgType.Emote) &&
                findUrls(content.body).length > 0
            );
    }
}

/**
 * The filtered timeline set of the tab. Media and files share FilePanel's filter (events with a
 * URL), so they share its timeline set; links need all messages, filtered on the client.
 */
async function getTimelineSet(client: MatrixClient, room: Room, tab: InsideMediaTab): Promise<EventTimelineSet> {
    const userId = client.getSafeUserId();
    const filter = new Filter(userId);
    if (tab === "links") {
        filter.setDefinition({ room: { timeline: { types: ["m.room.message"] } } });
        filter.filterId = await client.getOrCreateFilter("FILTER_INSIDE_MESSAGES_" + userId, filter);
    } else {
        filter.setDefinition({ room: { timeline: { contains_url: true, types: ["m.room.message"] } } });
        filter.filterId = await client.getOrCreateFilter("FILTER_FILES_" + userId, filter);
    }
    return room.getOrCreateFilteredTimelineSet(filter);
}

export interface InsideRoomMediaState {
    /** The events of the tab, newest first. */
    events: MatrixEvent[];
    /** True until the first page is loaded and while a page is being fetched. */
    loading: boolean;
    /** Whether older events may exist. */
    canLoadMore: boolean;
    /** Fetch older events. */
    loadMore: () => Promise<void>;
}

/**
 * The events of one tab of the room's media section, fetched when the tab is opened (mounted).
 */
export function useInsideRoomMedia(client: MatrixClient, room: Room, tab: InsideMediaTab): InsideRoomMediaState {
    const [events, setEvents] = useState<MatrixEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [canLoadMore, setCanLoadMore] = useState(false);
    const windowRef = useRef<TimelineWindow | null>(null);
    const busyRef = useRef(false);

    const refresh = useCallback((): void => {
        const window = windowRef.current;
        if (!window) return;
        setEvents(
            window
                .getEvents()
                .filter((ev) => eventMatchesTab(ev, tab))
                .reverse(),
        );
        setCanLoadMore(window.canPaginate(EventTimeline.BACKWARDS));
    }, [tab]);

    useEffect(() => {
        let cancelled = false;
        windowRef.current = null;
        setEvents([]);
        setLoading(true);
        setCanLoadMore(false);

        let timelineSet: EventTimelineSet | undefined;
        const onTimeline = (
            _ev: MatrixEvent,
            _room: Room | undefined,
            toStartOfTimeline: boolean | undefined,
            _removed: boolean,
            data: IRoomTimelineData,
        ): void => {
            if (toStartOfTimeline || !data?.liveEvent || data.timeline.getTimelineSet() !== timelineSet) return;
            const window = windowRef.current;
            if (!window) return;
            void window.paginate(EventTimeline.FORWARDS, PAGE_SIZE, false).then(() => {
                if (!cancelled) refresh();
            });
        };
        const onRedaction = (): void => {
            if (!cancelled) refresh();
        };

        (async (): Promise<void> => {
            try {
                timelineSet = await getTimelineSet(client, room, tab);
                if (cancelled) return;
                const window = new TimelineWindow(client, timelineSet, { windowLimit: Number.MAX_SAFE_INTEGER });
                await window.load(undefined, PAGE_SIZE);
                if (cancelled) return;
                windowRef.current = window;
                room.on(RoomEvent.Timeline, onTimeline);
                room.on(RoomEvent.Redaction, onRedaction);
                refresh();
            } catch (e) {
                logger.error("Inside: failed to load the room's media", e);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
            room.off(RoomEvent.Timeline, onTimeline);
            room.off(RoomEvent.Redaction, onRedaction);
        };
    }, [client, room, tab, refresh]);

    const loadMore = useCallback(async (): Promise<void> => {
        const window = windowRef.current;
        if (!window || busyRef.current) return;
        busyRef.current = true;
        setLoading(true);
        try {
            const before = window.getEvents().filter((ev) => eventMatchesTab(ev, tab)).length;
            // A page may have nothing for the tab (links among plain messages): fetch a few more.
            for (let i = 0; i < MAX_EMPTY_PAGES && window.canPaginate(EventTimeline.BACKWARDS); i++) {
                await window.paginate(EventTimeline.BACKWARDS, PAGE_SIZE);
                if (window.getEvents().filter((ev) => eventMatchesTab(ev, tab)).length > before) break;
            }
        } catch (e) {
            logger.error("Inside: failed to paginate the room's media", e);
        } finally {
            busyRef.current = false;
            if (windowRef.current === window) {
                refresh();
                setLoading(false);
            }
        }
    }, [tab, refresh]);

    return { events, loading, canLoadMore, loadMore };
}
