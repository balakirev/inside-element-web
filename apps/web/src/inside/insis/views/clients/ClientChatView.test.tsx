/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, within } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";

import { ClientChatView } from "./ClientChatView";
import { InsisPreviewStore } from "../../InsisPreviewStore";

const NOW = new Date(2026, 9, 30, 15, 0).getTime();

describe("<ClientChatView />", () => {
    beforeEach(() => {
        // The test data is made at the store's "now".
        vi.useFakeTimers({ toFake: ["Date"], now: NOW });
        InsisPreviewStore.resetInstance();
    });
    afterEach(() => {
        InsisPreviewStore.resetInstance();
        vi.useRealTimers();
    });

    it("shows the client chat: header with the chip, bubbles on their sides, system line", () => {
        render(<ClientChatView conversationId="alina" now={NOW} initialCardOpen={false} />);
        expect(screen.getByRole("region", { name: "Chat with Алина Касымова" })).toBeInTheDocument();
        expect(screen.getByText("в сети · брокер Амир Х.")).toBeInTheDocument();
        const messages = screen.getAllByTestId("insis-message");
        expect(messages[0]).toHaveClass("mx_InsisMsg_in");
        expect(messages.at(-1)).toHaveClass("mx_InsisMsg_out");
        expect(screen.getByText("insiderealty.ae")).toBeInTheDocument();
        expect(screen.getByText("Dubai Hills — подборка 2BR.pdf")).toBeInTheDocument();
        expect(screen.getByText("Амир Х.")).toBeInTheDocument(); // the reply quote
        expect(screen.getByText("👍 1")).toBeInTheDocument();
        expect(screen.getByText("Амир создал показ в Insis · чт, 30 окт, 16:30")).toBeInTheDocument();
        expect(screen.getByText("Today")).toBeInTheDocument();
        expect(screen.getByText("Yesterday")).toBeInTheDocument();
    });

    it("labels others' outgoing messages and shows the transfer", () => {
        render(<ClientChatView conversationId="igor" now={NOW} initialCardOpen={false} />);
        expect(screen.getByText("AI agent")).toBeInTheDocument();
        expect(screen.getByText("Анна Петрова · from the phone")).toBeInTheDocument();
        expect(screen.getByText("Анна Петрова")).toBeInTheDocument();
        expect(screen.getByText("Automated message")).toBeInTheDocument();
        expect(screen.getByText(/Transferred: Анна Петрова → you/)).toBeInTheDocument();
    });

    it("a failed message has a red mark and its reason", () => {
        render(<ClientChatView conversationId="timur" now={NOW} initialCardOpen={false} />);
        const failed = screen.getAllByTestId("insis-message").at(-1)!;
        expect(failed).toHaveClass("mx_InsisMsg_failed");
        expect(within(failed).getByRole("alert")).toHaveTextContent("Not delivered: Файл больше лимита канала (16 МБ)");
        expect(within(failed).getByTitle("not delivered")).toBeInTheDocument();
    });

    it("sending appends an own message that goes on to delivered", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
        try {
            render(<ClientChatView conversationId="alina" now={NOW} initialCardOpen={false} />);
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            await user.type(screen.getByRole("textbox", { name: "Message" }), "Локация: Collective 2.0{Enter}");
            const last = () => screen.getAllByTestId("insis-message").at(-1)!;
            expect(last()).toHaveTextContent("Локация: Collective 2.0");
            expect(within(last()).getByTitle("sending")).toBeInTheDocument();
            await vi.advanceTimersByTimeAsync(2000);
            expect(within(last()).getByTitle("delivered")).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it("the header and its button open and close the lead card", async () => {
        render(<ClientChatView conversationId="alina" now={NOW} initialCardOpen={false} />);
        expect(screen.queryByRole("complementary", { name: "Client" })).toBeNull();
        await userEvent.click(screen.getByTestId("insis-chat-who"));
        expect(screen.getByRole("complementary", { name: "Client" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Client card" })).toHaveAttribute("aria-pressed", "true");
        await userEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(screen.queryByRole("complementary", { name: "Client" })).toBeNull();
        await userEvent.click(screen.getByRole("button", { name: "Client card" }));
        expect(screen.getByRole("complementary", { name: "Client" })).toBeInTheDocument();
    });

    it("«Позвонить» says calls come with the INSIS telephony", async () => {
        render(<ClientChatView conversationId="alina" now={NOW} initialCardOpen={true} />);
        await userEvent.click(screen.getByRole("button", { name: "Call" }));
        expect(screen.getByRole("status")).toHaveTextContent("Calls to clients — once INSIS telephony is connected");
    });

    it("a suggestion of the card opens the assistant with its prompt", async () => {
        render(<ClientChatView conversationId="alina" now={NOW} initialCardOpen={true} />);
        await userEvent.click(screen.getAllByTestId("insis-suggestion")[2]);
        const store = InsisPreviewStore.instance;
        expect(store.openTarget?.kind).toBe("assistant");
        expect(store.getSession(store.openTarget!.id)!.messages.at(-1)).toMatchObject({
            kind: "user",
            text: "После показа подготовь сделку по Collective 2.0",
        });
    });

    it("search keeps the matching messages", async () => {
        render(<ClientChatView conversationId="alina" now={NOW} initialCardOpen={false} />);
        await userEvent.click(screen.getByRole("button", { name: "Search in the chat" }));
        await userEvent.type(screen.getByRole("textbox", { name: "Search in the chat" }), "парковка");
        expect(screen.getAllByTestId("insis-message")).toHaveLength(1);
    });
});
