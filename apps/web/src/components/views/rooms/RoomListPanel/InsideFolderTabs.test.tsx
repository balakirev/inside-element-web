/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen } from "test-utils-rtl";
import { clientAndSDKContextRenderOptions, createTestClient, TestSDKContext } from "test-utils";
import userEvent from "@testing-library/user-event";
import { type Room, TypedEventEmitter } from "matrix-js-sdk/src/matrix";

import { InsideFolderTabs } from "./InsideFolderTabs";
import { MetaSpace, type SpaceKey } from "../../../../stores/spaces";
import type SpaceStore from "../../../../stores/spaces/SpaceStore";
import { InsideFolderStore } from "../../../../stores/room-list-v3/InsideFolderStore";
import RoomListStoreV3 from "../../../../stores/room-list-v3/RoomListStoreV3";
import { FilterEnum } from "../../../../stores/room-list-v3/skip-list/filters";
import { StaticNotificationState } from "../../../../stores/notifications/StaticNotificationState";
import { NotificationLevel } from "../../../../stores/notifications/NotificationLevel";
import { type RoomNotificationState } from "../../../../stores/notifications/RoomNotificationState";
import { isInsisPreviewUser } from "../../../../inside/insis/preview";
import { InsisPreviewStore } from "../../../../inside/insis/InsisPreviewStore";

// The folders ask the room list store which rooms they hold; the real store would start syncing.
vi.mock("../../../../stores/room-list-v3/RoomListStoreV3", async () => {
    const { EventEmitter } = await vi.importActual<typeof import("events")>("events");
    const instance = Object.assign(new EventEmitter(), { roomMatchesFilter: vi.fn().mockReturnValue(false) });
    return { default: { instance }, RoomListStoreV3Event: { ListsUpdate: "lists_update" } };
});

// The "Помощник" tab is for the INSIS preview users only.
vi.mock("../../../../inside/insis/preview", () => ({ isInsisPreviewUser: vi.fn().mockReturnValue(false) }));

describe("<InsideFolderTabs />", () => {
    const client = createTestClient();
    const sdkContext = new TestSDKContext();
    sdkContext._client = client;
    const spaceStore = Object.assign(new TypedEventEmitter<string, Record<string, () => void>>(), {
        activeSpace: MetaSpace.Home as SpaceKey,
        setActiveSpace: vi.fn(),
    });
    sdkContext._SpaceStore = spaceStore as unknown as SpaceStore;

    const renderComponent = () => render(<InsideFolderTabs />, clientAndSDKContextRenderOptions(client, sdkContext));

    afterEach(() => {
        InsideFolderStore.instance.setActiveFilter(undefined);
        spaceStore.activeSpace = MetaSpace.Home;
        vi.mocked(client.getRooms).mockReturnValue([]);
        vi.mocked(RoomListStoreV3.instance.roomMatchesFilter).mockReturnValue(false);
        vi.clearAllMocks();
    });

    it("shows All and the folders as tabs, All selected", () => {
        renderComponent();
        const tabs = screen.getAllByRole("tab");
        expect(tabs.map((t) => t.textContent)).toEqual(["All", "Groups", "Colleagues", "Clients", "VIP", "Favourites"]);
        expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    });

    it("selects a folder", async () => {
        renderComponent();
        await userEvent.click(screen.getByRole("tab", { name: "VIP" }));
        expect(spaceStore.setActiveSpace).toHaveBeenCalledWith(MetaSpace.Home);
        expect(InsideFolderStore.instance.activeFilter).toBe(FilterEnum.VipFilter);
        expect(screen.getByRole("tab", { name: "VIP" })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "false");
    });

    it("leaves the folder from All", async () => {
        InsideFolderStore.instance.setActiveFilter(FilterEnum.ClientsFilter);
        renderComponent();
        await userEvent.click(screen.getByRole("tab", { name: "All" }));
        expect(InsideFolderStore.instance.activeFilter).toBeUndefined();
    });

    it("selects no tab in another space", () => {
        spaceStore.activeSpace = "!space:server";
        renderComponent();
        expect(screen.queryByRole("tab", { selected: true })).toBeNull();
    });

    it("shows the number of unread chats of all chats and of each folder", () => {
        const room = { isSpaceRoom: () => false, getMyMembership: () => "join" } as unknown as Room;
        vi.mocked(client.getRooms).mockReturnValue([room, room]);
        vi.mocked(RoomListStoreV3.instance.roomMatchesFilter).mockImplementation(
            (_, filter) => filter === FilterEnum.ColleaguesFilter,
        );
        vi.spyOn(sdkContext.roomNotificationStateStore, "getRoomState").mockReturnValue(
            StaticNotificationState.forCount(5, NotificationLevel.Notification) as unknown as RoomNotificationState,
        );

        renderComponent();

        // Chats, not messages.
        expect(screen.getByRole("tab", { name: "All 2" })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "Colleagues 2" })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "Clients" })).toBeInTheDocument();
    });

    it("for preview users: a Помощник tab after All, with a dot while a draft waits; picking a folder leaves it", async () => {
        vi.mocked(isInsisPreviewUser).mockReturnValue(true);
        InsisPreviewStore.resetInstance();
        renderComponent();
        const tabs = screen.getAllByRole("tab");
        expect(tabs[1]).toHaveTextContent("Assistant");
        expect(screen.getByRole("img", { name: "Awaiting confirmation" })).toBeInTheDocument();

        await userEvent.click(screen.getByRole("tab", { name: /Assistant/ }));
        expect(InsisPreviewStore.instance.isAssistantFolderActive).toBe(true);
        expect(screen.getByRole("tab", { name: /Assistant/ })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "false");

        await userEvent.click(screen.getByRole("tab", { name: "Groups" }));
        expect(InsisPreviewStore.instance.isAssistantFolderActive).toBe(false);
        expect(InsisPreviewStore.instance.openTarget).toBeNull();
        vi.mocked(isInsisPreviewUser).mockReturnValue(false);
        InsisPreviewStore.resetInstance();
    });
});
