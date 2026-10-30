/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";

import { InsisPreviewStore } from "./InsisPreviewStore";

const NOW = new Date(2026, 9, 30, 15, 0).getTime();

describe("InsisPreviewStore — clients", () => {
    let store: InsisPreviewStore;

    beforeEach(() => {
        InsisPreviewStore.resetInstance();
        store = new InsisPreviewStore(NOW);
    });

    afterEach(() => {
        store.dispose();
        vi.useRealTimers();
    });

    it("has the mockup's conversations, lead cards for each of them and a queue of 2", () => {
        const ids = store.clientConversations.map((c) => c.id);
        expect(ids).toContain("alina");
        for (const id of ids) expect(store.getLeadCard(id)).toBeDefined();
        const alina = store.getLeadCard("alina")!;
        expect(alina.stageIndex).toBe(3);
        expect(alina.stageCount).toBe(5);
        expect(alina.suggestions).toHaveLength(3);
        expect(alina.listings).toHaveLength(4);
        expect(store.waitingQueue.count).toBe(2);
        expect(store.clientTemplates.length).toBeGreaterThan(0);
    });

    it("«Принять следующий» opens the next lead and takes one off the queue", () => {
        const before = store.clientConversations.length;
        const accepted = store.acceptNext(NOW)!;
        expect(accepted.queue).toBe("accepted");
        expect(store.clientConversations).toHaveLength(before + 1);
        expect(store.openTarget).toEqual({ kind: "client", id: accepted.id });
        expect(store.getConversation(accepted.id)!.unread).toBe(0);
        expect(store.waitingQueue.count).toBe(1);
        store.acceptNext(NOW);
        expect(store.waitingQueue.count).toBe(0);
        expect(store.waitingQueue.oldestSince).toBeUndefined();
        expect(store.acceptNext(NOW)).toBeUndefined();
    });

    it("«Принять» and «Вернуть в очередь»", () => {
        expect(store.getConversation("sergey")!.queue).toBe("pending");
        store.acceptConversation("sergey");
        expect(store.getConversation("sergey")!.queue).toBe("accepted");
        store.open({ kind: "client", id: "sergey" });
        store.returnToQueue("sergey", NOW);
        expect(store.getConversation("sergey")).toBeUndefined();
        expect(store.openTarget).toBeNull();
        expect(store.waitingQueue.count).toBe(3);
    });

    it("a sent message goes sending → sent → delivered and moves the conversation up", () => {
        vi.useFakeTimers();
        const id = store.sendClientMessage("olga", "  Здравствуйте!  ", {}, NOW)!;
        const message = () => store.getConversation("olga")!.timeline.find((i) => i.id === id);
        expect(message()).toMatchObject({ kind: "message", text: "Здравствуйте!", delivery: "sending" });
        expect(store.getConversation("olga")!.lastActivityTs).toBe(NOW);
        vi.advanceTimersByTime(600);
        expect(message()).toMatchObject({ delivery: "sent" });
        vi.advanceTimersByTime(1200);
        expect(message()).toMatchObject({ delivery: "delivered" });
        expect(store.sendClientMessage("olga", "   ", {}, NOW)).toBeUndefined();
    });

    it("a template is sent with its name", () => {
        const id = store.sendClientMessage(
            "olga",
            "Ольга, добрый день!",
            { templateName: "Продолжить разговор" },
            NOW,
        )!;
        expect(store.getConversation("olga")!.timeline.find((i) => i.id === id)).toMatchObject({
            templateName: "Продолжить разговор",
        });
    });

    it("a suggestion opens the assistant on the client's session with its prompt as the broker's message", () => {
        const before = store.assistantSessions.find((s) => s.clientConversationId === "alina")?.messages.length ?? 0;
        const session = store.askAssistantForClient("alina", "Подбери ещё 2 варианта", NOW);
        expect(store.isAssistantFolderActive).toBe(true);
        expect(store.openTarget).toEqual({ kind: "assistant", id: session.id });
        expect(session.clientConversationId).toBe("alina");
        expect(session.messages.at(-1)).toMatchObject({ kind: "user", text: "Подбери ещё 2 варианта" });
        const again = store.askAssistantForClient("alina", "Ещё вопрос", NOW + 1);
        expect(again.id).toBe(session.id);
        expect(again.messages).toHaveLength(before + 2);
    });
});
