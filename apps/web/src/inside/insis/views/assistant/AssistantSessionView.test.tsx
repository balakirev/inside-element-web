/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { act, render, screen, within } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";

import { InsisPreviewStore } from "../../InsisPreviewStore";
import { REPLY_TYPING_MS, createAssistantSession, resetAssistantNavigation, sessionArtifacts } from "../../assistant";
import { AssistantSessionView } from "./AssistantSessionView";
import { VOICE_AUTOSEND_MS } from "./AssistantComposer";

const NOW = new Date(2026, 9, 30, 14, 0).getTime();
const UUID = /^[0-9a-f-]{36}$/;

function artifactOf(sessionId: string) {
    return sessionArtifacts(InsisPreviewStore.instance.getSession(sessionId)!)[0];
}

describe("<AssistantSessionView />", () => {
    beforeEach(() => {
        vi.useFakeTimers({
            shouldAdvanceTime: true,
            toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
        });
        vi.setSystemTime(NOW);
        InsisPreviewStore.resetInstance();
        resetAssistantNavigation();
    });

    afterEach(() => {
        resetAssistantNavigation();
        InsisPreviewStore.resetInstance();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    it("shows the header, the voice message with its transcript and the listing draft", () => {
        render(<AssistantSessionView sessionId="listing" />);
        expect(screen.getByText("Объект: Collective 2.0 · 2BR")).toBeInTheDocument();
        expect(screen.getByText("no client · awaiting confirmation")).toBeInTheDocument();
        expect(screen.getByRole("separator")).toHaveTextContent("Today");
        expect(screen.getByText("0:18")).toBeInTheDocument();
        expect(screen.getByText("Transcript")).toBeInTheDocument();
        expect(screen.getByText("Assistant", { selector: ".mx_InsisSender" })).toBeInTheDocument();

        const card = screen.getByRole("region", { name: "Черновик объекта" });
        expect(within(card).getByText("pocket listing · виден только вам")).toBeInTheDocument();
        expect(within(card).getByText("Awaiting confirmation")).toBeInTheDocument();
        expect(within(card).getByText("Collective 2.0 · Dubai Hills")).toBeInTheDocument();
        expect(within(card).getByText("справочник")).toBeInTheDocument();
        expect(within(card).getAllByText("голос")).toHaveLength(5);
        expect(within(card).getByText("Missing: этаж, номер разрешения")).toBeInTheDocument();
    });

    it("finalize creates the draft at once, with an Idempotency-Key", async () => {
        const user = setup();
        render(<AssistantSessionView sessionId="listing" />);
        const card = screen.getByRole("region", { name: "Черновик объекта" });
        await user.click(within(card).getByRole("button", { name: "Создать черновик" }));
        expect(artifactOf("listing")).toMatchObject({
            state: "finalized",
            idempotencyKey: expect.stringMatching(UUID),
        });
        expect(within(card).getByText("Created", { selector: ".mx_InsisArtifact_state" })).toBeInTheDocument();
        expect(within(card).getByRole("link", { name: "open in Insis" })).toHaveAttribute("target", "_blank");
        expect(within(card).queryByRole("button", { name: "Создать черновик" })).not.toBeInTheDocument();
        expect(screen.getByText("no client")).toBeInTheDocument();
    });

    it("a critical action asks for a confirmation first", async () => {
        const user = setup();
        render(<AssistantSessionView sessionId="selection" />);
        const card = screen.getByRole("region", { name: "Подборка · 4 объекта" });
        expect(within(card).getAllByRole("figure")).toHaveLength(4);
        await user.click(within(card).getByRole("button", { name: "Отправить клиенту" }));
        expect(artifactOf("selection").state).toBe("draft");
        expect(within(card).getByText(/нельзя отозвать/)).toBeInTheDocument();

        await user.click(within(card).getByRole("button", { name: "Cancel" }));
        expect(artifactOf("selection").state).toBe("draft");

        await user.click(within(card).getByRole("button", { name: "Отправить клиенту" }));
        await user.click(within(card).getByRole("button", { name: "Confirm: Отправить клиенту" }));
        expect(artifactOf("selection")).toMatchObject({
            state: "finalized",
            idempotencyKey: expect.stringMatching(UUID),
        });
        expect(within(card).getByText("Отправлено Сергею в WhatsApp")).toBeInTheDocument();
        expect(within(card).getByText("Отправлено", { selector: ".mx_InsisArtifact_state" })).toBeInTheDocument();
    });

    it("discard and edit", async () => {
        const user = setup();
        render(<AssistantSessionView sessionId="deal" />);
        const card = screen.getByRole("region", { name: "Своя сделка — черновик" });
        expect(within(card).getByText("Form F —")).toBeInTheDocument();
        expect(within(card).getByText(/Дебиторка/)).toBeInTheDocument();

        await user.click(within(card).getByRole("button", { name: "Добавить документы" }));
        expect(screen.getByRole("textbox", { name: "Ask or dictate…" })).toHaveValue(
            "Change the своя сделка — черновик: ",
        );

        await user.click(within(card).getByRole("button", { name: "Discard" }));
        expect(artifactOf("deal").state).toBe("discarded");
        expect(within(card).getByText("Discarded")).toBeInTheDocument();
    });

    it("an unknown artifact type shows its Markdown and Open in Insis", () => {
        render(<AssistantSessionView sessionId="owner" />);
        const card = screen.getByRole("region", { name: "Отчёт владельцу · октябрь" });
        expect(within(card).getByText("Показы:", { exact: false })).toBeInTheDocument();
        expect(within(card).getAllByRole("listitem")).toHaveLength(3);
        expect(within(card).getByRole("link", { name: "Open in Insis" })).toHaveAttribute(
            "href",
            "https://insis.ins.is/reports/art-owner",
        );
        expect(within(card).queryByRole("button")).not.toBeInTheDocument();
    });

    it("the suggestions send their prompt; the reply is a draft to confirm", async () => {
        const user = setup();
        render(<AssistantSessionView sessionId="client-q" />);
        const card = screen.getByRole("region", { name: "The assistant suggests" });
        expect(within(card).getByText("3 actions · each one after your confirmation")).toBeInTheDocument();
        await user.click(within(card).getAllByRole("button", { name: "Prepare" })[0]);
        expect(within(card).getByText("Sent to the assistant")).toBeInTheDocument();
        await act(async () => {
            vi.advanceTimersByTime(REPLY_TYPING_MS + 300);
        });
        expect(
            screen.getByRole("region", { name: "Напомнить клиенту и прислать локацию за час до показа" }),
        ).toBeInTheDocument();
        expect(InsisPreviewStore.instance.getSession("client-q")!.awaitingConfirmation).toBe(true);
    });

    it("an empty session offers the quick starts; sending types out a canned reply", async () => {
        const user = setup();
        act(() => {
            createAssistantSession(NOW);
        });
        const id = InsisPreviewStore.instance.openTarget!.id;
        render(<AssistantSessionView sessionId={id} />);
        expect(screen.getByRole("heading", { name: "How can I help?" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "New listing by voice" }));
        expect(screen.getByText("New listing by voice", { selector: ".mx_InsisBubble_text" })).toBeInTheDocument();
        await act(async () => {
            vi.advanceTimersByTime(REPLY_TYPING_MS + 300);
        });
        expect(screen.getByText(/^Listening\. Dictate the project/)).toBeInTheDocument();
        expect(screen.getByText("Assistant · test reply")).toBeInTheDocument();

        await user.type(screen.getByRole("textbox", { name: "Ask or dictate…" }), "Проверь цену{Enter}");
        expect(screen.getByText("Проверь цену")).toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: "Ask or dictate…" })).toHaveValue("");
    });

    it("without a microphone the composer says so", async () => {
        const user = setup();
        vi.stubGlobal("MediaRecorder", class {});
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: { getUserMedia: vi.fn().mockRejectedValue(new Error("NotAllowedError")) },
        });
        render(<AssistantSessionView sessionId="week" />);
        await user.click(screen.getByRole("button", { name: "Dictate" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("No access to the microphone");
    });

    it("records a voice message, puts the text into the field and sends it", async () => {
        const user = setup();
        const track = { stop: vi.fn() };
        class FakeRecorder {
            public state = "inactive";
            public onstop: (() => void) | null = null;
            public start(): void {
                this.state = "recording";
            }
            public stop(): void {
                this.state = "inactive";
                this.onstop?.();
            }
        }
        vi.stubGlobal("MediaRecorder", FakeRecorder);
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) },
        });
        render(<AssistantSessionView sessionId="week" />);
        await user.click(screen.getByRole("button", { name: "Dictate" }));
        expect(screen.getByText(/Recording/)).toBeInTheDocument();
        act(() => {
            vi.advanceTimersByTime(4000);
        });
        await user.click(screen.getByRole("button", { name: "Stop and send" }));
        expect(track.stop).toHaveBeenCalled();
        expect(screen.getByRole("textbox", { name: "Ask or dictate…" })).toHaveValue(
            "Add a listing: two-bedroom in Collective 2.0, 1,245 feet, 2.45 million, ready, park view",
        );
        act(() => {
            vi.advanceTimersByTime(VOICE_AUTOSEND_MS);
        });
        const last = InsisPreviewStore.instance.getSession("week")!.messages.at(-1)!;
        expect(last).toMatchObject({ kind: "user", voice: { durationSec: 4 } });
        expect(screen.getByRole("textbox", { name: "Ask or dictate…" })).toHaveValue("");
    });
});
