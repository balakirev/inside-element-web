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

import Modal from "../../../../Modal";
import { InsisPreviewStore } from "../../InsisPreviewStore";
import { resetAssistantNavigation, openAssistantSession } from "../../assistant";
import { AssistantSessionList } from "./AssistantSessionList";

const NOW = new Date(2026, 9, 30, 14, 0).getTime();

describe("<AssistantSessionList />", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(NOW);
        InsisPreviewStore.resetInstance();
        resetAssistantNavigation();
    });

    afterEach(() => {
        InsisPreviewStore.resetInstance();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const rows = (): string[] =>
        screen.getAllByRole("listitem").map((li) => li.querySelector(".mx_InsisAssistantRow_name")!.textContent!);

    it("shows the header, the search, New chat and the groups", () => {
        render(<AssistantSessionList />);
        expect(screen.getByRole("heading", { name: "Assistant" })).toBeInTheDocument();
        expect(screen.getByRole("searchbox", { name: "Search sessions" })).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "New chat" })).toHaveLength(2);
        expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
            "Today",
            "Yesterday",
            "Earlier",
        ]);
        expect(rows()[0]).toBe("Объект: Collective 2.0 · 2BR");
        // Two sessions wait for confirmation: red dots; the others carry a chip.
        expect(screen.getAllByRole("img", { name: "Awaiting confirmation" })).toHaveLength(2);
        expect(screen.getAllByText("created")).toHaveLength(3);
        expect(screen.getByText("draft")).toBeInTheDocument();
    });

    it("filters by the search and opens a session on click", async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(<AssistantSessionList />);
        await user.type(screen.getByRole("searchbox"), "серге");
        expect(rows()).toEqual(["Подборка 1BR Marina для Сергея", "Новый клиент: Сергей Мельник"]);

        await user.click(screen.getByRole("button", { name: /Подборка 1BR Marina/ }));
        expect(InsisPreviewStore.instance.openTarget).toEqual({ kind: "assistant", id: "selection" });
        expect(screen.getByRole("button", { name: /Подборка 1BR Marina/ })).toHaveAttribute("aria-current", "page");

        await user.clear(screen.getByRole("searchbox"));
        await user.type(screen.getByRole("searchbox"), "нет такого");
        expect(screen.getByText("Nothing found")).toBeInTheDocument();
    });

    it("the row menu pins and unpins", async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(<AssistantSessionList />);
        const row = screen.getByText("Задачи на неделю").closest("li")!;
        await user.click(within(row).getByRole("button", { name: "Session menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Pin" }));
        expect(screen.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent("Pinned");
        expect(rows()[0]).toBe("Задачи на неделю");

        await user.click(
            within(screen.getByText("Задачи на неделю").closest("li")!).getByRole("button", { name: "Session menu" }),
        );
        await user.click(screen.getByRole("menuitem", { name: "Unpin" }));
        expect(screen.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent("Today");
    });

    it("renames inline: Enter saves, Escape cancels", async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(<AssistantSessionList />);
        const menuOf = (name: string) =>
            within(screen.getByText(name).closest("li")!).getByRole("button", { name: "Session menu" });

        await user.click(menuOf("Задачи на неделю"));
        await user.click(screen.getByRole("menuitem", { name: "Rename" }));
        const field = screen.getByRole("textbox", { name: "Rename" });
        await user.clear(field);
        await user.type(field, "План недели{Enter}");
        expect(InsisPreviewStore.instance.getSession("week")!.title).toBe("План недели");

        await user.click(menuOf("План недели"));
        await user.click(screen.getByRole("menuitem", { name: "Rename" }));
        await user.type(screen.getByRole("textbox", { name: "Rename" }), "мусор{Escape}");
        expect(InsisPreviewStore.instance.getSession("week")!.title).toBe("План недели");
    });

    it("opens the menu from the keyboard and deletes after the confirmation", async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        const createDialog = vi
            .spyOn(Modal, "createDialog")
            .mockReturnValue({ finished: Promise.resolve([true]), close: vi.fn() } as any);
        act(() => openAssistantSession("owner"));
        render(<AssistantSessionList />);

        const main = screen.getByRole("button", { name: /Отчёт владельцу/ });
        main.focus();
        await user.keyboard("{Shift>}{F10}{/Shift}");
        await user.click(screen.getByRole("menuitem", { name: "Delete" }));
        expect(createDialog).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ title: "Delete session?", danger: true }),
        );
        await act(async () => {
            await Promise.resolve();
        });
        expect(InsisPreviewStore.instance.getSession("owner")).toBeUndefined();
        expect(screen.queryByText("Отчёт владельцу · Marina Gate")).not.toBeInTheDocument();
        // The next session of the list opens in its place.
        expect(InsisPreviewStore.instance.openTarget).toEqual({ kind: "assistant", id: "week" });
    });

    it("keeps the session when the deletion is cancelled", async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        vi.spyOn(Modal, "createDialog").mockReturnValue({ finished: Promise.resolve([false]), close: vi.fn() } as any);
        render(<AssistantSessionList />);
        await user.click(
            within(screen.getByText("Задачи на неделю").closest("li")!).getByRole("button", { name: "Session menu" }),
        );
        await user.click(screen.getByRole("menuitem", { name: "Delete" }));
        await act(async () => {
            await Promise.resolve();
        });
        expect(InsisPreviewStore.instance.getSession("week")).toBeDefined();
    });

    it("New chat opens an empty session at the top", async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(<AssistantSessionList />);
        await user.click(screen.getAllByRole("button", { name: "New chat" })[1]);
        const target = InsisPreviewStore.instance.openTarget;
        expect(target?.kind).toBe("assistant");
        expect(InsisPreviewStore.instance.getSession(target!.id)!.messages).toEqual([]);
        expect(rows()[0]).toBe("New chat");
    });
});
