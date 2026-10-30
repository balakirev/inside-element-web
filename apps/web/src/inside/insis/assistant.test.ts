/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import dis from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { InsisPreviewStore } from "./InsisPreviewStore";
import { makeAssistantSessions } from "./fixtures-assistant";
import type { AssistantSession } from "./model";
import {
    REPLY_TYPING_MS,
    anySessionAwaiting,
    createAssistantSession,
    deleteAssistantSession,
    discardArtifact,
    enterAssistantFolder,
    finalizeArtifact,
    groupSessions,
    leaveAssistantFolder,
    openAssistantSession,
    renameAssistantSession,
    resetAssistantNavigation,
    sendToAssistant,
    sessionArtifacts,
    sessionChip,
    titleFromFirstPhrase,
    togglePinAssistantSession,
} from "./assistant";

const NOW = new Date(2026, 9, 30, 14, 0).getTime();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function store(): InsisPreviewStore {
    return InsisPreviewStore.instance;
}

function session(id: string): AssistantSession {
    return store().getSession(id)!;
}

describe("assistant sessions (preview)", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
        vi.setSystemTime(NOW);
        InsisPreviewStore.resetInstance();
        resetAssistantNavigation();
    });

    afterEach(() => {
        resetAssistantNavigation();
        InsisPreviewStore.resetInstance();
        vi.useRealTimers();
    });

    it("fixtures group into Today · Yesterday · Earlier relative to now", () => {
        const groups = groupSessions(makeAssistantSessions(NOW), NOW);
        expect(groups.map((g) => [g.key, g.sessions.map((s) => s.id)])).toEqual([
            ["today", ["listing", "deal", "client-q"]],
            ["yesterday", ["selection", "client-new"]],
            ["earlier", ["owner", "week"]],
        ]);
    });

    it("pinned sessions go on top; the search matches title and preview", () => {
        togglePinAssistantSession("week");
        const groups = groupSessions(store().assistantSessions, NOW);
        expect(groups[0]).toEqual({ key: "pinned", sessions: [session("week")] });
        expect(
            groupSessions(store().assistantSessions, NOW, "form f").flatMap((g) => g.sessions.map((s) => s.id)),
        ).toEqual(["deal"]);
        expect(
            groupSessions(store().assistantSessions, NOW, "marina").flatMap((g) => g.sessions.map((s) => s.id)),
        ).toEqual(["selection", "owner"]);
        expect(
            groupSessions(store().assistantSessions, NOW, "", true).flatMap((g) => g.sessions.map((s) => s.id)),
        ).toEqual(["listing", "deal"]);
    });

    it("the chip of a row follows its latest artifact", () => {
        expect(sessionChip(session("listing"))).toBeUndefined(); // awaiting: a red dot instead
        expect(sessionChip(session("client-new"))).toBe("created");
        expect(sessionChip(session("selection"))).toBe("draft");
        expect(sessionChip(session("client-q"))).toBeUndefined();
    });

    it("finalize: the artifact is created with a fresh Idempotency-Key and the session stops waiting", () => {
        expect(anySessionAwaiting(store().assistantSessions)).toBe(true);
        const key = finalizeArtifact("listing", "art-listing");
        expect(key).toMatch(UUID);
        const art = sessionArtifacts(session("listing"))[0];
        expect(art.state).toBe("finalized");
        expect(art.idempotencyKey).toBe(key);
        expect(session("listing").awaitingConfirmation).toBe(false);
        expect(session("listing").preview).toBe("Created");

        const key2 = finalizeArtifact("deal", "art-deal");
        expect(key2).not.toBe(key);
        expect(session("deal").preview).toBe("Отправлено руководителю · ждёт проверки");
        expect(anySessionAwaiting(store().assistantSessions)).toBe(false);
    });

    it("discard: the draft is discarded, with its own key", () => {
        const key = discardArtifact("selection", "art-selection");
        const art = sessionArtifacts(session("selection"))[0];
        expect(art.state).toBe("discarded");
        expect(art.idempotencyKey).toBe(key);
        expect(sessionChip(session("selection"))).toBeUndefined();
    });

    it("rename trims and ignores an empty title", () => {
        renameAssistantSession("week", "  Неделя   с задачами ");
        expect(session("week").title).toBe("Неделя с задачами");
        renameAssistantSession("week", "   ");
        expect(session("week").title).toBe("Неделя с задачами");
    });

    it("deleting the open session opens the next one of the list", () => {
        openAssistantSession("deal");
        deleteAssistantSession("deal", true);
        expect(session("deal")).toBeUndefined();
        expect(store().openTarget).toEqual({ kind: "assistant", id: "client-q" });
        // On a phone nothing opens: the list stays.
        deleteAssistantSession("client-q", false);
        expect(store().openTarget).toBeNull();
    });

    it("entering the folder opens the newest session; leaving it closes the session", () => {
        enterAssistantFolder(true);
        expect(store().isAssistantFolderActive).toBe(true);
        expect(store().openTarget).toEqual({ kind: "assistant", id: "listing" });
        openAssistantSession("owner");
        leaveAssistantFolder();
        expect(store().isAssistantFolderActive).toBe(false);
        expect(store().openTarget).toBeNull();
        // Back in the folder: the session opened last.
        enterAssistantFolder(true);
        expect(store().openTarget).toEqual({ kind: "assistant", id: "owner" });
    });

    it("on a phone entering the folder opens nothing", () => {
        enterAssistantFolder(false);
        expect(store().isAssistantFolderActive).toBe(true);
        expect(store().openTarget).toBeNull();
    });

    it("a room picked by the user leaves the folder; a space's context switch does not", () => {
        enterAssistantFolder(true);
        dis.dispatch({ action: Action.ViewRoom, room_id: "!a:x", context_switch: true }, true);
        expect(store().isAssistantFolderActive).toBe(true);
        dis.dispatch({ action: Action.ViewRoom, room_id: "!a:x" }, true);
        expect(store().isAssistantFolderActive).toBe(false);
        expect(store().openTarget).toBeNull();
    });

    it("a new chat is empty and takes its title from the first phrase; the reply types out", () => {
        const s = createAssistantSession(NOW);
        expect(store().openTarget).toEqual({ kind: "assistant", id: s.id });
        expect(session(s.id).title).toBe("New chat");

        sendToAssistant(s.id, "Заведи задачу на пятницу. Перезвонить Игорю");
        expect(session(s.id).title).toBe("Заведи задачу на пятницу");
        expect(session(s.id).messages).toHaveLength(1);

        vi.advanceTimersByTime(600);
        const partial = session(s.id).messages[1];
        expect(partial).toMatchObject({ kind: "assistant", streaming: true, canned: true });
        expect(partial.text.length).toBeGreaterThan(0);

        vi.advanceTimersByTime(REPLY_TYPING_MS);
        const done = session(s.id).messages[1];
        expect(done).toMatchObject({ kind: "assistant", streaming: false });
        expect(done.text).toBe("Got it. I will put together a draft and show it here — the confirmation is yours.");

        // The title is set once.
        sendToAssistant(s.id, "И ещё одно");
        expect(session(s.id).title).toBe("Заведи задачу на пятницу");
    });

    it("a voice message keeps its duration and transcript", () => {
        sendToAssistant("week", "Перенеси показ", { voiceDurationSec: 7 });
        expect(session("week").messages.at(-1)).toMatchObject({
            kind: "user",
            text: "Перенеси показ",
            voice: { durationSec: 7 },
        });
    });

    it("titles are cut at a word", () => {
        expect(titleFromFirstPhrase("Привет!")).toBe("Привет");
        expect(titleFromFirstPhrase("Собери Сергею подборку: аренда 1BR в Marina, до 120 тыс. в год")).toBe(
            "Собери Сергею подборку: аренда 1BR в…",
        );
    });

    it("nothing of it is sent to Matrix", () => {
        const spy = vi.spyOn(dis, "dispatch");
        const s = createAssistantSession(NOW);
        sendToAssistant(s.id, "Тест");
        vi.advanceTimersByTime(2000);
        finalizeArtifact("listing", "art-listing");
        expect(spy).not.toHaveBeenCalled();
    });
});
