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
import { type Room } from "matrix-js-sdk/src/matrix";

import { InsideBackButton } from "./InsideBackButton";
import { goBackToRoomList } from "../../../../utils/InsideMobileNavigation";
import { StaticNotificationState } from "../../../../stores/notifications/StaticNotificationState";
import { NotificationLevel } from "../../../../stores/notifications/NotificationLevel";
import { type RoomNotificationState } from "../../../../stores/notifications/RoomNotificationState";

vi.mock("../../../../utils/InsideMobileNavigation", () => ({ goBackToRoomList: vi.fn() }));
vi.mock("../../../../stores/room-list-v3/RoomListStoreV3", async () => {
    const { EventEmitter } = await vi.importActual<typeof import("events")>("events");
    const instance = Object.assign(new EventEmitter(), { roomMatchesFilter: vi.fn().mockReturnValue(false) });
    return { default: { instance }, RoomListStoreV3Event: { ListsUpdate: "lists_update" } };
});

describe("<InsideBackButton />", () => {
    const client = createTestClient();
    const sdkContext = new TestSDKContext();
    sdkContext._client = client;
    const renderComponent = () => render(<InsideBackButton />, clientAndSDKContextRenderOptions(client, sdkContext));

    afterEach(() => {
        vi.mocked(client.getRooms).mockReturnValue([]);
        vi.restoreAllMocks();
    });

    it("goes back to the room list", async () => {
        renderComponent();
        const back = screen.getByRole("button", { name: "Back" });
        await userEvent.click(back);
        expect(goBackToRoomList).toHaveBeenCalledWith(back);
    });

    it("carries the number of unread chats", () => {
        const room = { isSpaceRoom: () => false, getMyMembership: () => "join" } as unknown as Room;
        vi.mocked(client.getRooms).mockReturnValue([room, room, room]);
        vi.spyOn(sdkContext.roomNotificationStateStore, "getRoomState").mockReturnValue(
            StaticNotificationState.forCount(2, NotificationLevel.Notification) as unknown as RoomNotificationState,
        );
        renderComponent();
        const back = screen.getByRole("button", { name: "Back, 3 unread chats" });
        expect(back).toHaveTextContent("3");
    });
});
