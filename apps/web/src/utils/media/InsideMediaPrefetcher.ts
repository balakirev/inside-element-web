/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    ClientEvent,
    EventType,
    type IRoomTimelineData,
    type MatrixClient,
    type MatrixEvent,
    MsgType,
    type Room,
    RoomEvent,
    SyncState,
} from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { type ImageContent, type MediaEventContent } from "matrix-js-sdk/src/types";
import { logger } from "matrix-js-sdk/src/logger";

import { mediaFromContent } from "../../customisations/Media";
import SettingsStore from "../../settings/SettingsStore";
import { mayBeAnimated } from "../Image";
import { getMediaVisibility } from "./mediaVisibility";
import { NO_WAIT_HEADER } from "./mediaCacheShared";
import { imageThumbnailHttp } from "./serverThumbnail";
import { SDKContextClass } from "../../contexts/SDKContextClass";

/** How many rooms from the top of the room list get their latest media loaded in advance. */
export const PREFETCH_ROOMS = 8;
/** How many of the latest media events per room. */
export const PREFETCH_EVENTS_PER_ROOM = 4;
/** How far back to look for them in each room's live timeline. */
const SCAN_EVENTS_PER_ROOM = 40;
/** Requests at a time: low, not to compete with what is on screen. */
const CONCURRENCY = 2;
/** A prefetch taking longer than this is given up. */
const REQUEST_TIMEOUT_MS = 30000;
/** Wait this long after the sync before reading the room list (it settles in bursts). */
const LIST_DEBOUNCE_MS = 2000;
/** Remember this many URLs as already loaded this session. */
const MAX_REMEMBERED = 5000;

/**
 * Inside: loads the thumbnails of the latest images, videos and files of the rooms at the top of the room
 * list (by latest activity) in advance, at idle time, two at a time, so that a chat opens with its pictures already there, as in
 * Telegram. The service worker keeps them in its media cache; the URLs are built exactly as the timeline
 * builds them (`serverThumbnail.ts`), so the timeline then finds them there.
 *
 * Also loads the thumbnail of a new media message in any room other than the open one: a room with a new
 * message moves to the top of the list and is likely the next one opened.
 *
 * Off with the "low bandwidth" setting and when the browser asks to save data. Encrypted media and media
 * the user chose not to preview are left alone.
 */
export class InsideMediaPrefetcher {
    private static internalInstance?: InsideMediaPrefetcher;

    public static get instance(): InsideMediaPrefetcher {
        if (!InsideMediaPrefetcher.internalInstance)
            InsideMediaPrefetcher.internalInstance = new InsideMediaPrefetcher();
        return InsideMediaPrefetcher.internalInstance;
    }

    private client: MatrixClient | null = null;
    private readonly queue: string[] = [];
    private readonly seen = new Set<string>();
    private active = 0;
    private listTimer?: ReturnType<typeof setTimeout>;

    public start(client: MatrixClient): void {
        this.stop();
        if (!InsideMediaPrefetcher.enabled()) return;
        this.client = client;
        client.on(ClientEvent.Sync, this.onSync);
        client.on(RoomEvent.Timeline, this.onTimeline);
        if (client.isInitialSyncComplete()) this.scheduleRoomList();
    }

    public stop(): void {
        if (this.client) {
            this.client.off(ClientEvent.Sync, this.onSync);
            this.client.off(RoomEvent.Timeline, this.onTimeline);
        }
        this.client = null;
        clearTimeout(this.listTimer);
        this.listTimer = undefined;
        this.queue.length = 0;
        this.seen.clear();
    }

    private static enabled(): boolean {
        if (SettingsStore.getValue("lowBandwidth")) return false;
        const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
        return !connection?.saveData;
    }

    private onSync = (state: SyncState, prevState: SyncState | null): void => {
        if (state === SyncState.Prepared || (state === SyncState.Syncing && prevState !== SyncState.Syncing)) {
            this.scheduleRoomList();
        }
    };

    private scheduleRoomList = (): void => {
        if (this.listTimer) return;
        this.listTimer = setTimeout(() => {
            this.listTimer = undefined;
            if (!this.client) return;
            try {
                this.prefetchRoomList();
            } catch (e) {
                logger.warn("InsideMediaPrefetcher: unable to read the room list", e);
            }
        }, LIST_DEBOUNCE_MS);
    };

    private onTimeline = (
        event: MatrixEvent,
        room: Room | undefined,
        toStartOfTimeline: boolean | undefined,
        _removed: boolean,
        data: IRoomTimelineData,
    ): void => {
        if (!this.client?.isInitialSyncComplete() || toStartOfTimeline || !data?.liveEvent || !room) return;
        // The open room shows the event itself.
        if (room.roomId === SDKContextClass.instance.roomViewStore.getRoomId()) return;
        this.enqueue(this.urlsForEvent(event));
    };

    /**
     * Queue the latest media of the rooms at the top of the room list. Runs after the initial sync and
     * after reconnecting; new messages later are handled one by one (onTimeline).
     */
    public prefetchRoomList(): void {
        if (!this.client) return;
        const openRoomId = SDKContextClass.instance.roomViewStore.getRoomId();
        // The room list's default order: latest activity first. (Not the room list store itself, which
        // would have to be started for this.)
        const rooms = this.client
            .getVisibleRooms()
            .filter((room) => room.roomId !== openRoomId && room.getMyMembership() === KnownMembership.Join)
            .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp())
            .slice(0, PREFETCH_ROOMS);
        // Round-robin, so that every room gets its newest picture first.
        const perRoom = rooms.map((room) => this.latestMediaUrls(room));
        for (let i = 0; i < PREFETCH_EVENTS_PER_ROOM; i++) {
            for (const urls of perRoom) {
                if (urls[i]) this.enqueue([urls[i]]);
            }
        }
    }

    /** The thumbnail URLs of a room's latest media events, newest first. */
    public latestMediaUrls(room: Room): string[] {
        const events = room.getLiveTimeline().getEvents();
        const urls: string[] = [];
        for (let i = events.length - 1; i >= 0 && i >= events.length - SCAN_EVENTS_PER_ROOM; i--) {
            urls.push(...this.urlsForEvent(events[i]));
            if (urls.length >= PREFETCH_EVENTS_PER_ROOM) break;
        }
        return urls.slice(0, PREFETCH_EVENTS_PER_ROOM);
    }

    /** What the timeline will load to show this event, if it is media worth loading in advance. */
    public urlsForEvent(event: MatrixEvent): string[] {
        if (!this.client || event.isRedacted() || event.isDecryptionFailure()) return [];
        if (event.getType() !== EventType.RoomMessage) return [];
        const content = event.getContent<MediaEventContent>();
        // Encrypted media is decrypted in the page from blobs: nothing for the service worker to keep.
        if (!content.url || content.file) return [];
        if (!getMediaVisibility(event, this.client)) return [];

        try {
            switch (content.msgtype) {
                case MsgType.Image: {
                    const imageContent: ImageContent = content;
                    const animated =
                        imageContent.info?.["org.matrix.msc4230.is_animated"] ??
                        mayBeAnimated(imageContent.info?.mimetype);
                    if (animated) return []; // loaded whole or turned into a still in the page
                    const url = imageThumbnailHttp(imageContent, {
                        imageSize: SettingsStore.getValue("Images.size"),
                        devicePixelRatio: window.devicePixelRatio,
                    });
                    return url ? [url] : [];
                }
                case MsgType.Video:
                case MsgType.File: {
                    // The poster of a video, the first page of a PDF.
                    const url = mediaFromContent(content).thumbnailHttp;
                    return url ? [url] : [];
                }
                default:
                    return [];
            }
        } catch (e) {
            logger.warn("InsideMediaPrefetcher: unable to work out the media URL", e);
            return [];
        }
    }

    private enqueue(urls: string[]): void {
        for (const url of urls) {
            if (this.seen.has(url)) continue;
            if (this.seen.size >= MAX_REMEMBERED) this.seen.clear();
            this.seen.add(url);
            this.queue.push(url);
        }
        this.pump();
    }

    private pump(): void {
        while (this.active < CONCURRENCY && this.queue.length > 0) {
            const url = this.queue.shift()!;
            this.active++;
            whenIdle(() => {
                void this.load(url).finally(() => {
                    this.active--;
                    this.pump();
                });
            });
        }
    }

    private async load(url: string): Promise<void> {
        if (!this.client) return;
        try {
            // Through the service worker, which authenticates the request and keeps the response.
            // Don't wait for files still being uploaded: the timeline does that when it shows them.
            const response = await fetch(url, {
                headers: { [NO_WAIT_HEADER]: "1" },
                priority: "low",
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            // Read it all, so that it is complete in the caches.
            await response.blob();
        } catch {
            // Best effort.
        }
    }
}

function whenIdle(callback: () => void): void {
    if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(callback, { timeout: 2000 });
    } else {
        setTimeout(callback, 50);
    }
}
