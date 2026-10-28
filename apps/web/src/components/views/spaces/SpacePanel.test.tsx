/*
Copyright 2026 Element Creations Ltd.
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import RoomListStoreV3 from "../../../stores/room-list-v3/RoomListStoreV3";
import { StaticNotificationState } from "../../../stores/notifications/StaticNotificationState";
import { NotificationLevel } from "../../../stores/notifications/NotificationLevel";
import { type RoomNotificationState } from "../../../stores/notifications/RoomNotificationState";
import { InsideFolderStore } from "../../../stores/room-list-v3/InsideFolderStore";
import { FilterEnum } from "../../../stores/room-list-v3/skip-list/filters";
import React from "react";
import { render, screen, fireEvent, act, cleanup, within } from "test-utils-rtl";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { mkStubRoom, wrapInMatrixClientContext, wrapInSdkContext, TestSDKContext } from "test-utils";

import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { MetaSpace, type SpaceKey } from "../../../stores/spaces";
import { shouldShowComponent } from "../../../customisations/helpers/UIComponents";
import { UIComponent } from "../../../settings/UIFeature";
import DMRoomMap from "../../../utils/DMRoomMap";
import { type SpaceNotificationState } from "../../../stores/notifications/SpaceNotificationState";
import SettingsStore from "../../../settings/SettingsStore";
import UnwrappedSpacePanel from "./SpacePanel";

// DND test utilities based on
// https://github.com/colinrobertbrooks/react-beautiful-dnd-test-utils/issues/18#issuecomment-1373388693
enum Keys {
    SPACE = 32,
    ARROW_LEFT = 37,
    ARROW_UP = 38,
    ARROW_RIGHT = 39,
    ARROW_DOWN = 40,
}

/* oxlint-disable typescript/prefer-literal-enum-member */
enum DragDirection {
    LEFT = Keys.ARROW_LEFT,
    UP = Keys.ARROW_UP,
    RIGHT = Keys.ARROW_RIGHT,
    DOWN = Keys.ARROW_DOWN,
}
/* oxlint-enable typescript/prefer-literal-enum-member */

// taken from https://github.com/hello-pangea/dnd/blob/main/test/unit/integration/util/controls.ts#L20
const createTransitionEndEvent = (): Event => {
    const event = new Event("transitionend", {
        bubbles: true,
        cancelable: true,
    }) as TransitionEvent;

    // cheating and adding property to event as
    // TransitionEvent constructor does not exist.
    // This is needed because of the following check
    //   https://github.com/atlassian/react-beautiful-dnd/blob/master/src/view/draggable/draggable.jsx#L130
    (event as any).propertyName = "transform";

    return event;
};

const pickUp = async (element: HTMLElement) => {
    fireEvent.keyDown(element, {
        keyCode: Keys.SPACE,
    });
    await screen.findByText(/You have lifted an item/i);

    act(() => {
        vi.runOnlyPendingTimers();
    });
};

const move = async (element: HTMLElement, direction: DragDirection) => {
    fireEvent.keyDown(element, {
        keyCode: direction,
    });
    await screen.findByText(/(You have moved the item | has been combined with)/i);
};

const drop = async (element: HTMLElement) => {
    fireEvent.keyDown(element, {
        keyCode: Keys.SPACE,
    });
    fireEvent(element.parentElement!, createTransitionEndEvent());

    await screen.findByText(/You have dropped the item/i);
};

// Inside: the folders ask the room list store which rooms they hold; the real store would start syncing.
vi.mock("../../../stores/room-list-v3/RoomListStoreV3", async () => {
    const { EventEmitter } = await vi.importActual<typeof import("events")>("events");
    const instance = Object.assign(new EventEmitter(), { roomMatchesFilter: vi.fn().mockReturnValue(false) });
    return { default: { instance }, RoomListStoreV3Event: { ListsUpdate: "lists_update" } };
});

vi.mock("../../../stores/spaces/SpaceStore", async () => {
    const { EventEmitter } = await vi.importActual<typeof import("events")>("events");
    class MockSpaceStore extends EventEmitter {
        invitedSpaces: SpaceKey[] = [];
        enabledMetaSpaces: MetaSpace[] = [];
        spacePanelSpaces: string[] = [];
        activeSpace: SpaceKey = "!space1";
        getChildSpaces = () => [] as Room[];
        getNotificationState = () => null as SpaceNotificationState | null;
        setActiveSpace = vi.fn();
        moveRootSpace = vi.fn();
        start = vi.fn();
    }
    return { default: MockSpaceStore };
});

vi.mock("../../../customisations/helpers/UIComponents", () => ({
    shouldShowComponent: vi.fn(),
}));

describe("<SpacePanel />", () => {
    const mockClient = {
        getUserId: vi.fn().mockReturnValue("@test:test"),
        getSafeUserId: vi.fn().mockReturnValue("@test:test"),
        getClientWellKnown: vi.fn(),
        mxcUrlToHttp: vi.fn(),
        getRoom: vi.fn(),
        // Inside: the folders count their unread chats
        getRooms: vi.fn().mockReturnValue([]),
        isGuest: vi.fn(),
        getAccountData: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        removeListener: vi.fn(),
        isVersionSupported: vi.fn().mockResolvedValue(true),
        doesServerSupportUnstableFeature: vi.fn().mockResolvedValue(false),
        getAuthMetadata: vi.fn().mockRejectedValue(new Error("Legacy auth")),
        getSyncState: vi.fn().mockReturnValue("SYNCING"),
    } as unknown as MatrixClient;
    const sdkContext = new TestSDKContext();
    const SpacePanel = wrapInSdkContext(wrapInMatrixClientContext(UnwrappedSpacePanel), sdkContext);

    beforeAll(() => {
        vi.spyOn(MatrixClientPeg, "get").mockReturnValue(mockClient);
        vi.spyOn(MatrixClientPeg, "safeGet").mockReturnValue(mockClient);
        sdkContext._client = mockClient;
    });

    beforeEach(() => {
        sdkContext.spaceStore.enabledMetaSpaces.push(MetaSpace.Home, MetaSpace.Orphans, MetaSpace.VideoRooms);
        vi.mocked(shouldShowComponent).mockClear().mockReturnValue(true);
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it("should show all activated MetaSpaces in the correct order", async () => {
        const originalGetValue = SettingsStore.getValue;
        const spySettingsStore = vi.spyOn(SettingsStore, "getValue").mockImplementation((setting) => {
            return setting === "feature_video_rooms" ? true : originalGetValue(setting);
        });
        render(<SpacePanel />);

        // Inspect the order of the rendered MetaSpaces, excluding the "Create a space" button.
        const tree = screen.getByRole("tree", { name: "Spaces" });
        const spaceButtons = within(tree)
            .getAllByRole("treeitem")
            .filter((el) => within(el).queryByRole("button", { name: "Create a space" }) === null);

        const metaSpaceLabels = Array.from(spaceButtons).map((li) =>
            within(li)
                .getByRole("button", { name: /^(?!Options$).*/ }) // filter out the 'options' buttons within the buttons
                .getAttribute("aria-label"),
        );
        // Inside: the folders follow Home.
        expect(metaSpaceLabels).toEqual([
            "Home",
            "Groups",
            "Colleagues",
            "Clients",
            "VIP",
            "Favourites",
            "Other rooms",
            "Conferences",
        ]);

        spySettingsStore.mockRestore();
    });

    describe("Inside folders", () => {
        /** The space panel button itself, not the jump-to-unread badge inside it labelled alike. */
        const spaceButton = (name: string): HTMLElement =>
            screen.getAllByRole("button", { name }).find((b) => b.classList.contains("mx_SpaceButton"))!;

        afterEach(() => {
            InsideFolderStore.instance.setActiveFilter(undefined);
            (sdkContext.spaceStore as { activeSpace: SpaceKey }).activeSpace = "!space1";
            sdkContext.spaceStore.enabledMetaSpaces.length = 0;
        });

        it("shows a folder's chats in all chats and selects it instead of Home", async () => {
            sdkContext.spaceStore.enabledMetaSpaces.push(MetaSpace.Home);
            (sdkContext.spaceStore as { activeSpace: SpaceKey }).activeSpace = MetaSpace.Home;
            render(<SpacePanel />);

            fireEvent.click(spaceButton("Colleagues"));

            expect(sdkContext.spaceStore.setActiveSpace).toHaveBeenCalledWith(MetaSpace.Home);
            expect(InsideFolderStore.instance.activeFilter).toBe(FilterEnum.ColleaguesFilter);
            expect(spaceButton("Colleagues")).toHaveClass("mx_SpaceButton_active");
            expect(spaceButton("Home")).not.toHaveClass("mx_SpaceButton_active");
        });

        it("shows the number of unread chats on a folder", async () => {
            const room = { isSpaceRoom: () => false, getMyMembership: () => "join" } as unknown as Room;
            vi.mocked(mockClient.getRooms).mockReturnValue([room]);
            vi.mocked(RoomListStoreV3.instance.roomMatchesFilter).mockImplementation(
                (_, filter) => filter === FilterEnum.ColleaguesFilter,
            );
            vi.spyOn(sdkContext.roomNotificationStateStore, "getRoomState").mockReturnValue(
                StaticNotificationState.forCount(5, NotificationLevel.Notification) as unknown as RoomNotificationState,
            );

            render(<SpacePanel />);

            // One unread chat, whatever the number of its messages.
            expect(spaceButton("Colleagues")).toHaveTextContent("1");
            expect(spaceButton("Clients")).not.toHaveTextContent(/\d/);
            vi.mocked(mockClient.getRooms).mockReturnValue([]);
            vi.mocked(RoomListStoreV3.instance.roomMatchesFilter).mockReturnValue(false);
        });

        it("leaves the folder from Home", async () => {
            sdkContext.spaceStore.enabledMetaSpaces.push(MetaSpace.Home);
            (sdkContext.spaceStore as { activeSpace: SpaceKey }).activeSpace = MetaSpace.Home;
            InsideFolderStore.instance.setActiveFilter(FilterEnum.VipFilter);
            render(<SpacePanel />);

            fireEvent.click(spaceButton("Home"));

            expect(InsideFolderStore.instance.activeFilter).toBeUndefined();
        });
    });

    describe("create new space button", () => {
        it("renders create space button when UIComponent.CreateSpaces component should be shown", () => {
            render(<SpacePanel />);
            expect(screen.getByTestId("create-space-button")).toBeVisible();
        });

        it("does not render create space button when UIComponent.CreateSpaces component should not be shown", () => {
            vi.mocked(shouldShowComponent).mockReturnValue(false);
            render(<SpacePanel />);
            expect(shouldShowComponent).toHaveBeenCalledWith(UIComponent.CreateSpaces);
            expect(screen.queryByTestId("create-space-button")).toBeFalsy();
        });

        it("opens context menu on create space button click", () => {
            render(<SpacePanel />);
            fireEvent.click(screen.getByTestId("create-space-button"));
            expect(screen.getByTestId("create-space-button")).toBeVisible();
        });
    });

    it("should allow rearranging via drag and drop", async () => {
        (sdkContext.spaceStore.spacePanelSpaces as any) = [
            mkStubRoom("!room1:server", "Room 1", mockClient),
            mkStubRoom("!room2:server", "Room 2", mockClient),
            mkStubRoom("!room3:server", "Room 3", mockClient),
        ];
        DMRoomMap.makeShared(mockClient);
        vi.useFakeTimers({ shouldAdvanceTime: true });

        const { getByLabelText } = render(<SpacePanel />);

        const room1 = getByLabelText("Room 1");
        await pickUp(room1);
        await move(room1, DragDirection.DOWN);
        await drop(room1);

        expect(sdkContext.spaceStore.moveRootSpace).toHaveBeenCalledWith(0, 1);
    });

    // Inside: the user menu moved to RoomListBottomBar, its test moved with it.
});
