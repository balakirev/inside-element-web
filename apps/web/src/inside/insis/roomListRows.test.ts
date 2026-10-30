/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

import {
    assistantRowId,
    clientRowId,
    insisRowsForFolder,
    isInsisRowId,
    mergeByActivity,
    openInsisRow,
    parseInsisRowId,
    rowIdOfTarget,
} from "./roomListRows";
import { InsisPreviewStore } from "./InsisPreviewStore";
import { assistantRowSnapshot, clientRowSnapshot } from "./InsisRowViewModels";
import type { AssistantSession, ClientConversation } from "./model";
import SettingsStore from "../../settings/SettingsStore";

const NOW = new Date(2026, 9, 30, 15, 0).getTime();

// Row snapshots read the 12/24 h setting; don't depend on the settings handlers (and localStorage) of the
// environment — a CI shard runs this file where localStorage is not defined.
beforeEach(() => {
    vi.spyOn(SettingsStore, "getValue").mockReturnValue(false as never);
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe("mergeByActivity", () => {
    const rooms = [
        { id: "!a", ts: 100 },
        { id: "!b", ts: 80 },
        { id: "!c", ts: 50 },
    ];
    const ts = (r: { ts: number }): number => r.ts;

    it("places each extra row before the first older room", () => {
        const merged = mergeByActivity(rooms, ts, [
            { row: { id: "x60", ts: 60 }, ts: 60 },
            { row: { id: "x120", ts: 120 }, ts: 120 },
            { row: { id: "x10", ts: 10 }, ts: 10 },
        ]);
        expect(merged.map((r) => r.id)).toEqual(["x120", "!a", "!b", "x60", "!c", "x10"]);
    });

    it("keeps the order of the rooms, even when it is not by time (muted rooms at the end)", () => {
        const muted = [...rooms, { id: "!muted", ts: 500 }];
        const merged = mergeByActivity(muted, ts, [{ row: { id: "x70", ts: 70 }, ts: 70 }]);
        expect(merged.map((r) => r.id)).toEqual(["!a", "!b", "x70", "!c", "!muted"]);
    });

    it("puts pinned rows first and works with no rooms", () => {
        const merged = mergeByActivity([], ts, [{ row: { id: "x", ts: 1 }, ts: 1 }], [{ id: "pin", ts: 0 }]);
        expect(merged.map((r) => r.id)).toEqual(["pin", "x"]);
    });
});

describe("INSIS row ids", () => {
    afterEach(() => InsisPreviewStore.resetInstance());

    it("round-trips client and assistant ids and never matches a Matrix room id", () => {
        expect(parseInsisRowId(clientRowId("alina"))).toEqual({ kind: "client", id: "alina" });
        expect(parseInsisRowId(assistantRowId("s1"))).toEqual({ kind: "assistant", id: "s1" });
        expect(isInsisRowId("!room:chat.ins.is")).toBe(false);
        expect(isInsisRowId(clientRowId("x"))).toBe(true);
        expect(rowIdOfTarget({ kind: "client", id: "alina" })).toBe(clientRowId("alina"));
        expect(rowIdOfTarget(null)).toBeUndefined();
    });

    it("opens a client chat, or an assistant session in the assistant folder", () => {
        const store = InsisPreviewStore.instance;
        openInsisRow(store, clientRowId("alina"));
        expect(store.openTarget).toEqual({ kind: "client", id: "alina" });
        expect(store.isAssistantFolderActive).toBe(false);
        openInsisRow(store, assistantRowId("s1"));
        expect(store.openTarget).toEqual({ kind: "assistant", id: "s1" });
        expect(store.isAssistantFolderActive).toBe(true);
    });
});

describe("insisRowsForFolder", () => {
    afterEach(() => InsisPreviewStore.resetInstance());

    const session = (id: string, awaitingConfirmation: boolean): AssistantSession => ({
        id,
        title: id,
        context: "",
        preview: "",
        lastActivityTs: NOW,
        awaitingConfirmation,
        messages: [],
    });

    it("All: conversations and waiting sessions; Clients: conversations only; others: nothing", () => {
        const store = InsisPreviewStore.instance;
        store.putSession(session("wait", true));
        store.putSession(session("done", false));
        const all = insisRowsForFolder(store, "all");
        expect(all.conversations.length).toBe(store.clientConversations.length);
        expect(all.conversations.length).toBeGreaterThan(0);
        const pinned = all.pinnedSessions.map((s) => s.id);
        expect(pinned).toContain("wait");
        expect(pinned).not.toContain("done");
        expect(all.pinnedSessions.every((s) => s.awaitingConfirmation)).toBe(true);
        const clients = insisRowsForFolder(store, "clients");
        expect(clients.conversations.length).toBe(store.clientConversations.length);
        expect(clients.pinnedSessions).toEqual([]);
        expect(insisRowsForFolder(store, "other")).toEqual({ conversations: [], pinnedSessions: [] });
    });
});

describe("row snapshots", () => {
    const base: ClientConversation = {
        id: "c",
        displayName: "Алина Касымова",
        initials: "АК",
        avatarColor: "#2C7370",
        online: true,
        channel: "whatsapp",
        phone: "",
        subtitle: "",
        stage: "",
        unread: 2,
        lastActivityTs: NOW,
        leadId: "L-1",
        timeline: [
            { kind: "message", id: "1", ts: NOW - 1000, author: { kind: "client" }, text: "Hello" },
            { kind: "message", id: "2", ts: NOW, author: { kind: "me" }, text: "Hi!", delivery: "read" },
        ],
    };

    it("client row: chip, own last message with the sender and read ticks, unread counter", () => {
        const snap = clientRowSnapshot(base);
        expect(snap.id).toBe(clientRowId("c"));
        expect(snap.name).toBe("Алина Касымова");
        expect(snap.insideChip).toBe("Client");
        expect(snap.messagePreview).toBe("Hi!");
        expect(snap.messagePreviewSender).toBe("You");
        expect(snap.lastMessageStatus).toBe("read");
        expect(snap.notification.count).toBe(2);
        expect(snap.notification.isNotification).toBe(true);
    });

    it("client row: a failed last message shows the unsent mark, not ticks", () => {
        const snap = clientRowSnapshot({
            ...base,
            unread: 0,
            timeline: [{ kind: "message", id: "1", ts: NOW, author: { kind: "me" }, text: "x", delivery: "failed" }],
        });
        expect(snap.notification.isUnsentMessage).toBe(true);
        expect(snap.lastMessageStatus).toBeUndefined();
    });

    it("assistant row: the listing draft waiting for a confirmation, with a dot", () => {
        const snap = assistantRowSnapshot({
            id: "s",
            title: "Объект: Collective 2.0 · 2BR",
            context: "",
            preview: "",
            lastActivityTs: NOW,
            awaitingConfirmation: true,
            messages: [
                {
                    kind: "assistant",
                    id: "a",
                    ts: NOW,
                    text: "",
                    artifact: {
                        id: "x",
                        type: "listing_draft",
                        title: "",
                        state: "draft",
                        fields: [],
                        finalizeLabel: "",
                        portableMarkdown: "",
                        insisUrl: "",
                    },
                },
            ],
        });
        expect(snap.id).toBe(assistantRowId("s"));
        expect(snap.messagePreview).toBe("The listing draft waits for your confirmation");
        expect(snap.notification.isNotification).toBe(true);
        expect(snap.notification.count).toBe(0);
    });
});
