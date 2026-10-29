/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    type MatrixClient,
    MatrixError,
    MatrixEvent,
    Room,
    RoomMember,
    RoomMemberEvent,
    User,
} from "matrix-js-sdk/src/matrix";
import { stubClient } from "test-utils";

import {
    chooseUserName,
    cleanLatinName,
    fetchLatinName,
    InsideLocalizedNames,
    LatinNameCache,
    LatinNameLoader,
    NAME_TTL_MS,
    NAMES_CACHE_KEY,
    pickI18n,
    ROOM_NAME_I18N_EVENT,
    ROOM_TOPIC_I18N_EVENT,
} from "./InsideLocalizedNames";
import { getShownTopic } from "../hooks/room/useTopic";

const ME = "@me:server";
const PAVEL = "@pavel:server";
const ROOM_ID = "!room:server";

function memberEvent(userId: string, displayname: string, prevDisplayname?: string, ts = 1000): MatrixEvent {
    return new MatrixEvent({
        type: "m.room.member",
        state_key: userId,
        sender: userId,
        room_id: ROOM_ID,
        event_id: `$${userId}-${displayname}-${ts}`,
        origin_server_ts: ts,
        content: { membership: "join", displayname },
        unsigned: prevDisplayname ? { prev_content: { membership: "join", displayname: prevDisplayname } } : {},
    });
}

function stateEvent(type: string, content: Record<string, unknown>): MatrixEvent {
    return new MatrixEvent({
        type,
        state_key: "",
        sender: ME,
        room_id: ROOM_ID,
        event_id: `$${type}-${JSON.stringify(content)}`,
        content,
    });
}

class MemoryStorage {
    public items = new Map<string, string>();
    public getItem(key: string): string | null {
        return this.items.get(key) ?? null;
    }
    public setItem(key: string, value: string): void {
        this.items.set(key, value);
    }
    public removeItem(key: string): void {
        this.items.delete(key);
    }
}

describe("display rule", () => {
    it("shows the Latin name in an English interface", () => {
        expect(chooseUserName("en", "Pavel Sidorov", "Павел Сидоров")).toBe("Pavel Sidorov");
    });

    it("keeps the display name in a Russian interface", () => {
        expect(chooseUserName("ru", "Pavel Sidorov", "Павел Сидоров")).toBe("Павел Сидоров");
    });

    it("keeps the display name when there is no Latin name", () => {
        expect(chooseUserName("en", null, "John Smith")).toBe("John Smith");
        expect(chooseUserName("en", undefined, "Павел Сидоров")).toBe("Павел Сидоров");
    });

    it("picks a room name for the language", () => {
        const content = { ru: "Общий", en: " General " };
        expect(pickI18n(content, "en")).toBe("General");
        expect(pickI18n(content, "ru")).toBe("Общий");
        expect(pickI18n({ ru: "Общий" }, "en")).toBeUndefined();
        expect(pickI18n({ en: 5 }, "en")).toBeUndefined();
        expect(pickI18n(undefined, "en")).toBeUndefined();
    });

    it("accepts only non-empty string names", () => {
        expect(cleanLatinName(" Pavel ")).toBe("Pavel");
        expect(cleanLatinName("")).toBeNull();
        expect(cleanLatinName(42)).toBeNull();
    });
});

describe("LatinNameCache", () => {
    it("keeps names in localStorage and reads them back", () => {
        vi.useFakeTimers();
        const storage = new MemoryStorage();
        const cache = new LatinNameCache(storage as unknown as Storage, () => 5000);
        expect(cache.set(PAVEL, "Pavel Sidorov")).toBe(true);
        // Unknown → "has none" does not change what is shown.
        expect(cache.set("@john:server", null)).toBe(false);
        vi.advanceTimersByTime(1500);
        expect(JSON.parse(storage.getItem(NAMES_CACHE_KEY)!)).toEqual({
            v: 1,
            e: { [PAVEL]: ["Pavel Sidorov", 5000], "@john:server": [null, 5000] },
        });

        const again = new LatinNameCache(storage as unknown as Storage, () => 6000);
        expect(again.get(PAVEL)).toBe("Pavel Sidorov");
        expect(again.get("@john:server")).toBeNull();
        expect(again.get("@nobody:server")).toBeUndefined();
        vi.useRealTimers();
    });

    it("is fresh for a day, and stale after a display name change", () => {
        let now = 1000;
        const cache = new LatinNameCache(undefined, () => now);
        cache.set(PAVEL, "Pavel Sidorov");
        expect(cache.isFresh(PAVEL)).toBe(true);
        now += NAME_TTL_MS + 1;
        expect(cache.isFresh(PAVEL)).toBe(false);
        expect(cache.staleUserIds()).toEqual([PAVEL]);
        cache.set(PAVEL, "Pavel Sidorov");
        cache.markStale(PAVEL);
        expect(cache.isFresh(PAVEL)).toBe(false);
        // Still shown while it is asked again.
        expect(cache.get(PAVEL)).toBe("Pavel Sidorov");
    });

    it("reports whether the shown name changes", () => {
        const cache = new LatinNameCache(undefined);
        expect(cache.set(PAVEL, "Pavel")).toBe(true);
        expect(cache.set(PAVEL, "Pavel")).toBe(false);
        expect(cache.set(PAVEL, null)).toBe(true);
    });

    it("ignores a broken stored value", () => {
        const storage = new MemoryStorage();
        storage.setItem(NAMES_CACHE_KEY, "{not json");
        expect(new LatinNameCache(storage as unknown as Storage).get(PAVEL)).toBeUndefined();
    });
});

describe("LatinNameLoader", () => {
    afterEach(() => vi.useRealTimers());

    it("sends at most a few requests at a time and reports changes in one batch", async () => {
        vi.useFakeTimers();
        const cache = new LatinNameCache(undefined);
        const resolvers = new Map<string, (name: string | null) => void>();
        const fetchName = vi.fn(
            (userId: string) => new Promise<string | null>((resolve) => resolvers.set(userId, resolve)),
        );
        const onChanged = vi.fn();
        const loader = new LatinNameLoader(cache, fetchName, onChanged, 2);
        for (let i = 0; i < 5; i++) loader.request(`@u${i}:server`);
        loader.request("@u0:server"); // already queued
        expect(fetchName).not.toHaveBeenCalled(); // not before the client is ready

        loader.setEnabled(true);
        expect(fetchName).toHaveBeenCalledTimes(2);
        for (let i = 0; i < 5; i++) {
            resolvers.get(`@u${i}:server`)?.(i === 4 ? null : `User ${i}`);
            await vi.advanceTimersByTimeAsync(0);
        }
        expect(fetchName).toHaveBeenCalledTimes(5);
        await vi.advanceTimersByTimeAsync(300);
        expect(onChanged).toHaveBeenCalledTimes(1);
        expect(onChanged.mock.calls[0][0].sort()).toEqual(["@u0:server", "@u1:server", "@u2:server", "@u3:server"]);

        // Fresh names are not asked again.
        loader.request("@u1:server");
        expect(fetchName).toHaveBeenCalledTimes(5);
    });

    it("waits before asking again after a failure", async () => {
        let now = 0;
        const cache = new LatinNameCache(undefined, () => now);
        const fetchName = vi.fn().mockRejectedValue(new Error("offline"));
        const loader = new LatinNameLoader(cache, fetchName, vi.fn(), 4, () => now, 0);
        loader.setEnabled(true);
        loader.request(PAVEL);
        await new Promise((resolve) => setTimeout(resolve, 0));
        loader.request(PAVEL);
        expect(fetchName).toHaveBeenCalledTimes(1);
        now += 11 * 60 * 1000;
        loader.request(PAVEL);
        expect(fetchName).toHaveBeenCalledTimes(2);
    });
});

describe("fetchLatinName", () => {
    it("reads is.ins.name.en from the profile", async () => {
        const client = {
            http: { authedRequest: vi.fn().mockResolvedValue({ "displayname": "Павел", "is.ins.name.en": "Pavel" }) },
        };
        await expect(fetchLatinName(client as unknown as MatrixClient, PAVEL)).resolves.toBe("Pavel");
        expect(client.http.authedRequest).toHaveBeenCalledWith("GET", "/profile/%40pavel%3Aserver");
    });

    it("is null without the field or the profile, and throws on other errors", async () => {
        const client = { http: { authedRequest: vi.fn().mockResolvedValue({ displayname: "John" }) } };
        await expect(fetchLatinName(client as unknown as MatrixClient, PAVEL)).resolves.toBeNull();
        client.http.authedRequest.mockRejectedValue(new MatrixError({ errcode: "M_NOT_FOUND" }, 404));
        await expect(fetchLatinName(client as unknown as MatrixClient, PAVEL)).resolves.toBeNull();
        client.http.authedRequest.mockRejectedValue(new MatrixError({ errcode: "M_FORBIDDEN" }, 403));
        await expect(fetchLatinName(client as unknown as MatrixClient, PAVEL)).rejects.toBeInstanceOf(MatrixError);
    });
});

describe("InsideLocalizedNames in the js-sdk models", () => {
    let names: InsideLocalizedNames;
    let client: MatrixClient;

    beforeEach(() => {
        client = stubClient();
        names = new InsideLocalizedNames(new LatinNameCache(undefined));
        names.languageOverride = "en";
        names.install();
        // No requests from these tests.
        names.loader.setEnabled(false);
    });

    afterEach(() => {
        names.stop();
        // Leave the models as js-sdk made them for other tests.
        names.languageOverride = "ru";
    });

    it("shows the Latin name of a member in English", () => {
        names.cache.set(PAVEL, "Pavel Sidorov");
        const member = new RoomMember(ROOM_ID, PAVEL);
        member.setMembershipEvent(memberEvent(PAVEL, "Павел Сидоров"));
        expect(member.name).toBe("Pavel Sidorov");
        expect(member.rawDisplayName).toBe("Pavel Sidorov");
        expect(names.getMemberSpellings(member)).toEqual(["Pavel Sidorov", "Павел Сидоров"]);
    });

    it("keeps the display name in Russian", () => {
        names.languageOverride = "ru";
        names.cache.set(PAVEL, "Pavel Sidorov");
        const member = new RoomMember(ROOM_ID, PAVEL);
        member.setMembershipEvent(memberEvent(PAVEL, "Павел Сидоров"));
        expect(member.name).toBe("Павел Сидоров");
        expect(member.rawDisplayName).toBe("Павел Сидоров");
        // Search still finds the Latin spelling.
        expect(names.getMemberSpellings(member)).toContain("Pavel Sidorov");
    });

    it("keeps the display name until the Latin name is known, then announces the new one once", () => {
        const room = new Room(ROOM_ID, client, ME);
        mocked(client.getRooms).mockReturnValue([room]);
        names.start(client);
        names.loader.setEnabled(false);
        room.currentState.setStateEvents([memberEvent(ME, "Я"), memberEvent(PAVEL, "Павел Сидоров")]);
        room.recalculate();
        const member = room.getMember(PAVEL)!;
        expect(member.name).toBe("Павел Сидоров");
        expect(room.name).toBe("Павел Сидоров");

        const onName = vi.fn();
        member.on(RoomMemberEvent.Name, onName);
        names.cache.set(PAVEL, "Pavel Sidorov");
        names.refreshUsers([PAVEL]);
        expect(member.name).toBe("Pavel Sidorov");
        expect(onName).toHaveBeenCalledTimes(1);
        expect(onName.mock.calls[0][2]).toBe("Павел Сидоров");
        // A DM is named after the other person.
        expect(room.name).toBe("Pavel Sidorov");
        // The sender of an event (a sentinel member) follows too.
        expect(room.currentState.getSentinelMember(PAVEL)!.name).toBe("Pavel Sidorov");

        // The same member event again does not announce anything.
        onName.mockClear();
        member.setMembershipEvent(memberEvent(PAVEL, "Павел Сидоров"), room.currentState);
        expect(onName).not.toHaveBeenCalled();
        expect(member.name).toBe("Pavel Sidorov");
    });

    it("keeps the Matrix ID of same-named members", () => {
        const room = new Room(ROOM_ID, client, ME);
        names.cache.set(PAVEL, "Pavel Sidorov");
        const other = "@pavel2:server";
        room.currentState.setStateEvents([memberEvent(other, "Павел Сидоров"), memberEvent(PAVEL, "Павел Сидоров")]);
        const member = room.getMember(PAVEL)!;
        expect(member.disambiguate).toBe(true);
        expect(member.name).toBe(`Pavel Sidorov (${PAVEL})`);
        expect(member.rawDisplayName).toBe("Pavel Sidorov");
    });

    it("asks for the Latin name again after a newer display name change", () => {
        const request = vi.spyOn(names.loader, "request");
        names.start(client);
        names.loader.setEnabled(false);
        names.cache.set(PAVEL, "Pavel Sidorov");
        const loadedAt = names.cache.loadedAt(PAVEL)!;
        const member = new RoomMember(ROOM_ID, PAVEL);
        member.setMembershipEvent(memberEvent(PAVEL, "Павел С.", "Павел Сидоров", loadedAt + 1000));
        expect(names.cache.isFresh(PAVEL)).toBe(false);
        expect(request).toHaveBeenCalledWith(PAVEL);
    });

    it("shows a system room's name and topic in the interface language", () => {
        const room = new Room(ROOM_ID, client, ME);
        room.currentState.setStateEvents([
            stateEvent("m.room.name", { name: "Общий" }),
            stateEvent("m.room.topic", { topic: "Для всех" }),
            stateEvent(ROOM_NAME_I18N_EVENT, { ru: "Общий", en: "General" }),
            stateEvent(ROOM_TOPIC_I18N_EVENT, { ru: "Для всех", en: "For everyone" }),
        ]);
        room.recalculate();
        expect(room.name).toBe("General");
        expect(room.normalizedName).toBe("general");
        expect(getShownTopic(room)?.text).toBe("For everyone");
        expect(names.getRoomNameSpellings(room)).toEqual(["General", "Общий"]);

        names.languageOverride = "ru";
        room.recalculate();
        expect(room.name).toBe("Общий");
        expect(getShownTopic(room)?.text).toBe("Для всех");
    });

    it("leaves rooms without the event alone", () => {
        const room = new Room(ROOM_ID, client, ME);
        room.currentState.setStateEvents([stateEvent("m.room.name", { name: "Наш чат" })]);
        room.recalculate();
        expect(room.name).toBe("Наш чат");
        expect(getShownTopic(room)).toBeNull();
    });

    it("names a DM named after the other person after their Latin name", () => {
        const room = new Room(ROOM_ID, client, ME);
        names.cache.set(PAVEL, "Pavel Sidorov");
        room.currentState.setStateEvents([
            memberEvent(ME, "Я"),
            memberEvent(PAVEL, "Павел Сидоров"),
            stateEvent("m.room.name", { name: "Павел Сидоров" }),
        ]);
        room.recalculate();
        expect(room.name).toBe("Pavel Sidorov");
    });

    it("shows the Latin name of a user", () => {
        names.cache.set(PAVEL, "Pavel Sidorov");
        const user = new User(PAVEL);
        user.setDisplayName("Павел Сидоров");
        user.setRawDisplayName("Павел Сидоров");
        expect(user.displayName).toBe("Pavel Sidorov");
        expect(user.rawDisplayName).toBe("Pavel Sidorov");
        names.languageOverride = "ru";
        user.setDisplayName("Павел Сидоров");
        expect(user.displayName).toBe("Павел Сидоров");
    });

    it("localizes names of directory results and takes Latin names from profiles", () => {
        names.noteProfile(PAVEL, { "displayname": "Павел Сидоров", "is.ins.name.en": "Pavel Sidorov" });
        expect(names.localizeUserName(PAVEL, "Павел Сидоров")).toBe("Pavel Sidorov");
        expect(names.nameMatches("павел", PAVEL, "Pavel Sidorov", "Павел Сидоров")).toBe(true);
        expect(names.nameMatches("pavel", PAVEL, "Павел Сидоров")).toBe(true);
    });
});

function mocked<T extends (...args: never[]) => unknown>(fn: T): ReturnType<typeof vi.fn> & T {
    return fn as ReturnType<typeof vi.fn> & T;
}
