/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "test-utils-rtl";
import { clientAndSDKContextRenderOptions, createTestClient, TestSDKContext } from "test-utils";
import userEvent from "@testing-library/user-event";

import { InsideComposeFab } from "./InsideComposeFab";
import defaultDispatcher from "../../../../dispatcher/dispatcher";
import { Action } from "../../../../dispatcher/actions";
import type SpaceStore from "../../../../stores/spaces/SpaceStore";
import { shouldShowComponent } from "../../../../customisations/helpers/UIComponents";
import { createRoom } from "../../../../viewmodels/room-list/utils";

vi.mock("../../../../customisations/helpers/UIComponents", () => ({
    shouldShowComponent: vi.fn(),
}));
vi.mock("../../../../viewmodels/room-list/utils", () => ({
    createRoom: vi.fn(),
}));

describe("<InsideComposeFab />", () => {
    const client = createTestClient();
    const sdkContext = new TestSDKContext();
    sdkContext._client = client;
    sdkContext._SpaceStore = { activeSpaceRoom: null } as unknown as SpaceStore;

    const renderComponent = () => render(<InsideComposeFab />, clientAndSDKContextRenderOptions(client, sdkContext));

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(shouldShowComponent).mockReturnValue(true);
    });

    it("opens a menu with a new group and a new chat", async () => {
        renderComponent();
        const fab = screen.getByRole("button", { name: "New message" });
        expect(fab).toHaveAttribute("aria-expanded", "false");

        await userEvent.click(fab);

        expect(fab).toHaveAttribute("aria-expanded", "true");
        expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["New group", "New chat"]);
    });

    it("starts a chat", async () => {
        const fire = vi.spyOn(defaultDispatcher, "fire");
        renderComponent();
        await userEvent.click(screen.getByRole("button", { name: "New message" }));
        await userEvent.click(screen.getByRole("menuitem", { name: "New chat" }));
        expect(fire).toHaveBeenCalledWith(Action.CreateChat);
        expect(screen.queryByRole("menu")).toBeNull();
    });

    it("creates a group", async () => {
        renderComponent();
        await userEvent.click(screen.getByRole("button", { name: "New message" }));
        await userEvent.click(screen.getByRole("menuitem", { name: "New group" }));
        expect(createRoom).toHaveBeenCalledWith(null);
    });

    it("offers no group to those who cannot create rooms", async () => {
        vi.mocked(shouldShowComponent).mockReturnValue(false);
        renderComponent();
        await userEvent.click(screen.getByRole("button", { name: "New message" }));
        expect(screen.queryByRole("menuitem", { name: "New group" })).toBeNull();
    });
});
