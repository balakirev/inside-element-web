/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";

import { LeadCardPanel } from "./LeadCardPanel";
import { InsisPreviewStore } from "../../InsisPreviewStore";

const NOW = new Date(2026, 9, 30, 15, 0).getTime();

function setup(conversationId = "alina", props: Partial<React.ComponentProps<typeof LeadCardPanel>> = {}) {
    const store = new InsisPreviewStore(NOW);
    const conversation = store.getConversation(conversationId)!;
    const actions = {
        onClose: vi.fn(),
        onCall: vi.fn(),
        onSuggestion: vi.fn(),
        onAskAssistant: vi.fn(),
        onOpenInInsis: vi.fn(),
        onAccept: vi.fn(),
        onReturnToQueue: vi.fn(),
    };
    render(
        <LeadCardPanel
            conversation={conversation}
            card={store.getLeadCard(conversationId)}
            now={NOW}
            {...actions}
            {...props}
        />,
    );
    return { store, actions };
}

describe("<LeadCardPanel />", () => {
    afterEach(() => InsisPreviewStore.resetInstance());

    it("opens on «Лид»: the assistant's suggestions first, then the lead in Insis", () => {
        setup();
        expect(screen.getByRole("tab", { name: "Lead" })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("tab", { name: "Listings 4" })).toBeInTheDocument();
        const suggestions = screen.getAllByTestId("insis-suggestion");
        expect(suggestions).toHaveLength(3);
        expect(suggestions[0]).toHaveTextContent("Напомнить клиенту и прислать локацию за час до показа");
        expect(suggestions[0]).toHaveTextContent("вы обещали в 11:47");
        const pane = screen.getByRole("tabpanel");
        expect(pane.textContent!.indexOf("Assistant suggests")).toBeLessThan(
            pane.textContent!.indexOf("Lead in Insis"),
        );
        expect(screen.getByText("L-20481")).toBeInTheDocument();
        expect(screen.getByRole("img", { name: "Stage: Показ назначен, 3 of 5" })).toBeInTheDocument();
        expect(screen.getByText("до AED 3 000 000")).toBeInTheDocument();
        expect(screen.getByText("кампания Dubai Hills 2BR")).toBeInTheDocument();
        expect(screen.getByText("заезд до весны")).toBeInTheDocument();
        expect(screen.getByText("Показ · Collective 2.0")).toBeInTheDocument();
    });

    it("tells the client's time and what is left of the window", () => {
        setup();
        const line = screen.getByTestId("insis-client-clock");
        // Tests pin Intl to UTC; the window closes 24 h after the client's 11:42.
        expect(line).toHaveTextContent("client's time now");
        expect(line).toHaveTextContent("WhatsApp window open for 20 h");
    });

    it("a suggestion hands its prompt over", async () => {
        const { actions } = setup();
        await userEvent.click(screen.getAllByTestId("insis-suggestion")[1]);
        expect(actions.onSuggestion).toHaveBeenCalledWith(
            "Подбери ещё 2 варианта 2BR в Dubai Hills с гостевой парковкой",
        );
    });

    it("switches tabs: listings with statuses, the journey, files with the pages read", async () => {
        setup();
        await userEvent.click(screen.getByRole("tab", { name: "Listings 4" }));
        expect(screen.getByText("Collective 2.0 · 2BR · 1 245 sqft")).toBeInTheDocument();
        expect(screen.getByText("понравился")).toHaveClass("mx_InsisLead_tagSignal");
        await userEvent.click(screen.getByRole("tab", { name: "Journey" }));
        expect(screen.getByText("Новый лид из Bayut")).toBeInTheDocument();
        expect(screen.getByText("Показ назначен").closest("li")).toHaveClass("mx_InsisLead_pathCurrent");
        await userEvent.click(screen.getByRole("tab", { name: "Files" }));
        expect(screen.getByText("Dubai Hills — подборка 2BR.pdf")).toBeInTheDocument();
        expect(screen.getByRole("img", { name: "Time on pages" }).children).toHaveLength(4);
    });

    it("actions: call, open in Insis, ask the assistant, close; no queue buttons for an ordinary lead", async () => {
        const { actions } = setup();
        await userEvent.click(screen.getByRole("button", { name: "Call" }));
        await userEvent.click(screen.getByRole("button", { name: "More" }));
        await userEvent.click(screen.getByRole("menuitem", { name: "Open in Insis" }));
        expect(actions.onOpenInInsis).toHaveBeenCalledTimes(1);
        await userEvent.click(screen.getByRole("button", { name: "Open in Insis" }));
        await userEvent.click(screen.getByRole("button", { name: "Ask the assistant" }));
        await userEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(actions.onCall).toHaveBeenCalled();
        expect(actions.onOpenInInsis).toHaveBeenCalledTimes(2);
        expect(actions.onAskAssistant).toHaveBeenCalled();
        expect(actions.onClose).toHaveBeenCalled();
        expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Return to the queue" })).toBeNull();
    });

    it("a lead waiting to be accepted has «Принять» and «Вернуть в очередь»", async () => {
        const { actions } = setup("sergey");
        await userEvent.click(screen.getByRole("button", { name: "Accept" }));
        await userEvent.click(screen.getByRole("button", { name: "Return to the queue" }));
        expect(actions.onAccept).toHaveBeenCalled();
        expect(actions.onReturnToQueue).toHaveBeenCalled();
    });

    it("as a phone sheet: a grab handle, the lead and broker under the name, short assistant button", () => {
        setup("alina", { variant: "sheet" });
        expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
        expect(screen.getByText("L-20481 · Амир Х.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Assistant" })).toBeInTheDocument();
    });
});
