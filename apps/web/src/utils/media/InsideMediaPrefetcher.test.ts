/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import { InsideMediaPrefetcher, PREFETCH_EVENTS_PER_ROOM } from "./InsideMediaPrefetcher";
import { mkEvent, stubClient } from "../../test/test-utils";
import { SDKContextClass } from "../../contexts/SDKContextClass";
import SettingsStore from "../../settings/SettingsStore";
import { ImageSize } from "../../settings/enums/ImageSize";
import { getMediaVisibility } from "./mediaVisibility";

vi.mock("./mediaVisibility", () => ({ getMediaVisibility: vi.fn().mockReturnValue(true) }));

describe("InsideMediaPrefetcher", () => {
    let client: MatrixClient;
    let fetchSpy: ReturnType<typeof vi.fn>;
    let prefetcher: InsideMediaPrefetcher;
    let openRoomId: string | null;

    const image = (room: string, id: string, extra: Record<string, unknown> = {}): MatrixEvent =>
        mkEvent({
            type: EventType.RoomMessage,
            room,
            user: "@bob:hs",
            id,
            event: true,
            content: {
                msgtype: "m.image",
                body: "photo.jpg",
                url: `mxc://hs/${id.slice(1)}`,
                info: { w: 4000, h: 3000, size: 5_000_000, mimetype: "image/jpeg" },
                ...extra,
            },
        });

    const text = (room: string, id: string): MatrixEvent =>
        mkEvent({
            type: EventType.RoomMessage,
            room,
            user: "@bob:hs",
            id,
            event: true,
            content: { msgtype: "m.text", body: "hi" },
        });

    const room = (roomId: string, events: MatrixEvent[], lastActive = 0): Room =>
        ({
            roomId,
            getLiveTimeline: () => ({ getEvents: () => events }),
            getMyMembership: () => "join",
            getLastActiveTimestamp: () => lastActive,
        }) as unknown as Room;

    const fetchedUrls = (): string[] => fetchSpy.mock.calls.map(([url]) => String(url));

    beforeEach(() => {
        client = stubClient();
        // eslint-disable-next-line no-restricted-properties
        vi.mocked(client.mxcUrlToHttp).mockImplementation(
            (mxc: string, width?: number, height?: number) =>
                `https://hs/${mxc.slice(9)}${width ? `?w=${width}&h=${height}` : ""}`,
        );
        fetchSpy = vi.fn().mockResolvedValue(new Response("jpeg"));
        vi.stubGlobal("fetch", fetchSpy);
        openRoomId = null;
        vi.spyOn(SDKContextClass.instance.roomViewStore, "getRoomId").mockImplementation(() => openRoomId);
        const getValue = SettingsStore.getValue;
        vi.spyOn(SettingsStore, "getValue").mockImplementation((name, ...args) => {
            if (name === "lowBandwidth") return false;
            if (name === "Images.size") return ImageSize.Normal;
            return getValue(name, ...args);
        });
        Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
        prefetcher = new InsideMediaPrefetcher();
        prefetcher.start(client);
    });

    afterEach(() => {
        prefetcher.stop();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("works out the thumbnail the timeline will ask for", () => {
        expect(prefetcher.urlsForEvent(image("!a", "$p1"))).toEqual(["https://hs/p1?w=320&h=240"]);
    });

    it("loads video posters and file thumbnails", () => {
        const video = mkEvent({
            type: EventType.RoomMessage,
            room: "!a",
            user: "@bob:hs",
            event: true,
            content: {
                msgtype: "m.video",
                body: "v.mp4",
                url: "mxc://hs/v1",
                info: { thumbnail_url: "mxc://hs/poster" },
            },
        });
        expect(prefetcher.urlsForEvent(video)).toEqual(["https://hs/poster"]);
    });

    it("leaves encrypted, animated, hidden and non-media events alone", () => {
        expect(prefetcher.urlsForEvent(text("!a", "$t"))).toEqual([]);
        expect(prefetcher.urlsForEvent(image("!a", "$e", { file: { url: "mxc://hs/e" } }))).toEqual([]);
        expect(prefetcher.urlsForEvent(image("!a", "$g", { info: { w: 10, h: 10, mimetype: "image/gif" } }))).toEqual(
            [],
        );
        vi.mocked(getMediaVisibility).mockReturnValueOnce(false);
        expect(prefetcher.urlsForEvent(image("!a", "$h"))).toEqual([]);
    });

    it("loads the latest media of the top rooms, newest first, round-robin, skipping the open room", async () => {
        openRoomId = "!open";
        vi.mocked(client.getVisibleRooms).mockReturnValue([
            room("!b", [image("!b", "$b1")], 10),
            room("!open", [image("!open", "$o1")], 30),
            room("!a", [image("!a", "$a1"), text("!a", "$at"), image("!a", "$a2")], 20),
        ]);

        prefetcher.prefetchRoomList();

        await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
        expect(fetchedUrls()).toEqual([
            "https://hs/a2?w=320&h=240",
            "https://hs/b1?w=320&h=240",
            "https://hs/a1?w=320&h=240",
        ]);
        expect(fetchSpy.mock.calls[0][1]).toMatchObject({ headers: { "X-Inside-No-Wait": "1" } });

        // Already loaded this session: not again.
        prefetcher.prefetchRoomList();
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it("takes only a few media per room", () => {
        const events = Array.from({ length: 10 }, (_, i) => image("!a", `$m${i}`));
        expect(prefetcher.latestMediaUrls(room("!a", events))).toHaveLength(PREFETCH_EVENTS_PER_ROOM);
    });

    it("loads a new media message in a room other than the open one", async () => {
        openRoomId = "!open";
        const onTimeline = (prefetcher as any).onTimeline;

        onTimeline(image("!open", "$x1"), room("!open", []), false, false, { liveEvent: true });
        onTimeline(image("!a", "$x2"), room("!a", []), false, false, { liveEvent: true });
        onTimeline(image("!a", "$x3"), room("!a", []), true, false, { liveEvent: false });

        await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
        expect(fetchedUrls()).toEqual(["https://hs/x2?w=320&h=240"]);
    });

    it("does nothing with the low bandwidth setting", () => {
        prefetcher.stop();
        vi.mocked(SettingsStore.getValue).mockImplementation((name) => name === "lowBandwidth");
        prefetcher.start(client);
        prefetcher.prefetchRoomList();

        expect(client.getVisibleRooms).not.toHaveBeenCalled();
        expect(prefetcher.urlsForEvent(image("!a", "$p1"))).toEqual([]);
    });
});
