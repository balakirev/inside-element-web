/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";

import { ClientComposer } from "./ClientComposer";
import { makeClientConversations, makeClientTemplates } from "../../fixtures-clients";

const NOW = new Date(2026, 9, 30, 15, 0).getTime();
const HOUR = 60 * 60 * 1000;

function setup(id: string, now = NOW) {
    const conversation = makeClientConversations(NOW).find((c) => c.id === id)!;
    const onSend = vi.fn();
    const onUnavailable = vi.fn();
    render(
        <ClientComposer
            conversation={conversation}
            templates={makeClientTemplates()}
            now={now}
            onSend={onSend}
            onUnavailable={onUnavailable}
        />,
    );
    return { conversation, onSend, onUnavailable };
}

describe("<ClientComposer />", () => {
    it("inside the window: the counter, a field, Enter sends", async () => {
        const { onSend } = setup("alina");
        expect(screen.getByTestId("insis-window")).toHaveTextContent("WhatsApp window: 20 h left");
        expect(screen.queryByTestId("insis-window-closed")).toBeNull();
        expect(screen.getByRole("button", { name: "Voice message" })).toBeInTheDocument();
        await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "Добрый день{Enter}");
        expect(onSend).toHaveBeenCalledWith("Добрый день");
        expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("");
    });

    it("the counter turns red in the last two hours", () => {
        const { conversation } = { conversation: makeClientConversations(NOW).find((c) => c.id === "alina")! };
        setup("alina", conversation.serviceWindowUntil! - HOUR);
        expect(screen.getByTestId("insis-window")).toHaveClass("mx_InsisComposer_window_soon");
        expect(screen.getByTestId("insis-window")).toHaveTextContent("1 h left");
    });

    it("a channel without a window has no counter", () => {
        setup("timur");
        expect(screen.queryByTestId("insis-window")).toBeNull();
        expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument();
    });

    it("outside the window: no field, only a template with its preview", async () => {
        const { onSend } = setup("olga");
        expect(screen.queryByRole("textbox")).toBeNull();
        expect(screen.getByTestId("insis-window-closed")).toHaveTextContent("WhatsApp 24 h window is closed");
        await userEvent.click(screen.getByRole("button", { name: "Choose a template" }));
        const sheet = screen.getByRole("dialog", { name: "WhatsApp templates" });
        expect(sheet).toHaveTextContent("Ольга, добрый день! Это Inside Realty.");
        await userEvent.click(screen.getByText("Напоминание о показе"));
        expect(
            screen.getByText(
                "Ольга, напоминаем о показе. Ответьте на это сообщение, чтобы подтвердить время или перенести.",
            ),
        ).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Send template" }));
        expect(onSend).toHaveBeenCalledWith(
            "Ольга, напоминаем о показе. Ответьте на это сообщение, чтобы подтвердить время или перенести.",
            "Напоминание о показе",
        );
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("attachments and voice are not there yet", async () => {
        const { onUnavailable } = setup("alina");
        await userEvent.click(screen.getByRole("button", { name: "Attach" }));
        await userEvent.click(screen.getByRole("button", { name: "Voice message" }));
        expect(onUnavailable.mock.calls).toEqual([["attach"], ["voice"]]);
    });
});
