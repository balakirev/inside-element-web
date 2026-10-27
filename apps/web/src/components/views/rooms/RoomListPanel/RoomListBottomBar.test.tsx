/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "test-utils-rtl";
import { clientAndSDKContextRenderOptions, createTestClient, TestSDKContext } from "test-utils";
import userEvent from "@testing-library/user-event";

import { RoomListBottomBar } from "./RoomListBottomBar";
import defaultDispatcher from "../../../../dispatcher/dispatcher";
import { Action } from "../../../../dispatcher/actions";
import { MetaSpace } from "../../../../stores/spaces";
import type SpaceStore from "../../../../stores/spaces/SpaceStore";

describe("<RoomListBottomBar />", () => {
    const client = createTestClient();
    const sdkContext = new TestSDKContext();
    sdkContext._client = client;
    sdkContext._SpaceStore = { setActiveSpace: vi.fn() } as unknown as SpaceStore;

    function renderComponent() {
        return render(<RoomListBottomBar />, clientAndSDKContextRenderOptions(client, sdkContext));
    }

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("opens the start chat dialog from Contacts", async () => {
        const fire = vi.spyOn(defaultDispatcher, "fire");
        renderComponent();
        await userEvent.click(screen.getByRole("button", { name: "Contacts" }));
        expect(fire).toHaveBeenCalledWith(Action.CreateChat);
    });

    it("shows all chats from Chats", async () => {
        renderComponent();
        const chats = screen.getByRole("button", { name: "Chats" });
        expect(chats).toHaveAttribute("aria-current", "page");
        await userEvent.click(chats);
        expect(sdkContext.spaceStore.setActiveSpace).toHaveBeenCalledWith(MetaSpace.Home);
    });

    it("opens the user menu via dispatcher", async () => {
        const { baseElement } = renderComponent();
        defaultDispatcher.dispatch({ action: Action.ToggleUserMenu });
        await waitFor(() => {
            // Menu exists outside the component due to Portals, so select it manually.
            expect(baseElement.querySelector("div[aria-label='User menu']")).toBeInTheDocument();
        });
    });
});
