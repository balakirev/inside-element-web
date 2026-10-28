/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi, type MockedObject } from "vitest";
import { act, render, screen, waitFor } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { EventTimeline, type MatrixClient, type MatrixEvent, MsgType, Room } from "matrix-js-sdk/src/matrix";
import { getRoomContext, mkEvent, stubClient } from "test-utils";

import { InsideRoomMedia, InsideRoomSummaryTiles } from "./InsideRoomSummary";
import { eventMatchesTab, findUrls } from "./useInsideRoomMedia";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import defaultDispatcher from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { PlatformCallType, useRoomCall } from "../../../hooks/room/useRoomCall";
import { useNotificationState } from "../../../hooks/useRoomNotificationState";
import { RoomNotifState } from "../../../RoomNotifs";
import Modal from "../../../Modal";
import ImageView from "../elements/ImageView";
import DMRoomMap from "../../../utils/DMRoomMap";
import { ScopedRoomContextProvider } from "../../../contexts/ScopedRoomContext";

vi.mock("../../../hooks/room/useRoomCall", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../hooks/room/useRoomCall")>()),
    useRoomCall: vi.fn(),
}));
vi.mock("../../../hooks/useRoomNotificationState", () => ({
    useNotificationState: vi.fn(),
}));
vi.mock("../rooms/RoomHeader/InsideHeaderButtons", () => ({
    MoreMenuContent: () => <div data-testid="more-menu-content" />,
}));

const roomId = "!room:example.org";
const userId = "@alice:example.org";

function mkMsg(content: Record<string, unknown>, ts: number): MatrixEvent {
    return mkEvent({ type: "m.room.message", room: roomId, user: userId, content, ts, event: true });
}

describe("Inside room summary", () => {
    let client: MockedObject<MatrixClient>;
    let room: Room;

    const renderWithClient = (el: React.ReactElement, withRoomView = true) =>
        render(
            <MatrixClientContext.Provider value={client}>
                {withRoomView ? (
                    <ScopedRoomContextProvider {...getRoomContext(room, { roomViewStore: {} as any })}>
                        {el}
                    </ScopedRoomContextProvider>
                ) : (
                    el
                )}
            </MatrixClientContext.Provider>,
        );

    beforeEach(() => {
        client = vi.mocked(stubClient());
        client.getOrCreateFilter.mockImplementation(async (name: string) => name);
        room = new Room(roomId, client, userId);
        client.getRoom.mockReturnValue(room);
        DMRoomMap.makeShared(client);
        vi.mocked(useRoomCall).mockReturnValue({
            voiceCallDisabledReason: null,
            voiceCallClick: vi.fn(),
            callOptions: [PlatformCallType.LegacyCall],
            showVoiceCallButton: true,
        } as unknown as ReturnType<typeof useRoomCall>);
        vi.mocked(useNotificationState).mockReturnValue([RoomNotifState.AllMessages, vi.fn()]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("tiles", () => {
        it("renders call, mute, search and more", () => {
            const { container } = renderWithClient(<InsideRoomSummaryTiles room={room} />);
            const tiles = container.querySelectorAll(
                ".mx_RoomSummaryCard_inside_tiles > .mx_RoomSummaryCard_inside_tile",
            );
            expect(Array.from(tiles).map((t) => t.textContent)).toEqual(["Call", "Mute", "Search", "More"]);
        });

        it("places a voice call", async () => {
            const voiceCallClick = vi.fn();
            vi.mocked(useRoomCall).mockReturnValue({
                voiceCallDisabledReason: null,
                voiceCallClick,
                callOptions: [PlatformCallType.LegacyCall],
                showVoiceCallButton: true,
            } as unknown as ReturnType<typeof useRoomCall>);
            renderWithClient(<InsideRoomSummaryTiles room={room} />);
            await userEvent.click(screen.getByRole("button", { name: "Call" }));
            expect(voiceCallClick).toHaveBeenCalledWith(expect.anything(), PlatformCallType.LegacyCall);
        });

        it("hides the call tile when calls are unavailable", () => {
            vi.mocked(useRoomCall).mockReturnValue({
                voiceCallDisabledReason: null,
                voiceCallClick: vi.fn(),
                callOptions: [],
                showVoiceCallButton: false,
            } as unknown as ReturnType<typeof useRoomCall>);
            renderWithClient(<InsideRoomSummaryTiles room={room} />);
            expect(screen.queryByRole("button", { name: "Call" })).not.toBeInTheDocument();
        });

        it("hides the call tile outside a room view", () => {
            renderWithClient(<InsideRoomSummaryTiles room={room} />, false);
            expect(screen.queryByRole("button", { name: "Call" })).not.toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
        });

        it("disables the call tile with the reason", () => {
            vi.mocked(useRoomCall).mockReturnValue({
                voiceCallDisabledReason: "Ongoing call",
                voiceCallClick: vi.fn(),
                callOptions: [PlatformCallType.LegacyCall],
                showVoiceCallButton: true,
            } as unknown as ReturnType<typeof useRoomCall>);
            renderWithClient(<InsideRoomSummaryTiles room={room} />);
            const tile = screen.getByRole("button", { name: "Call" });
            expect(tile).toBeDisabled();
            expect(tile).toHaveAttribute("title", "Ongoing call");
        });

        it("mutes the room", async () => {
            const setter = vi.fn();
            vi.mocked(useNotificationState).mockReturnValue([RoomNotifState.AllMessages, setter]);
            renderWithClient(<InsideRoomSummaryTiles room={room} />);
            await userEvent.click(screen.getByRole("button", { name: "Mute" }));
            expect(setter).toHaveBeenCalledWith(RoomNotifState.Mute);
        });

        it("unmutes a muted room", async () => {
            const setter = vi.fn();
            vi.mocked(useNotificationState).mockReturnValue([RoomNotifState.Mute, setter]);
            renderWithClient(<InsideRoomSummaryTiles room={room} />);
            const tile = screen.getByRole("button", { name: "Unmute" });
            expect(tile).toHaveClass("mx_RoomSummaryCard_inside_tile_muted");
            expect(tile).toHaveAttribute("aria-pressed", "true");
            await userEvent.click(tile);
            expect(setter).toHaveBeenCalledWith(RoomNotifState.AllMessages);
        });

        it("opens the message search", async () => {
            const fire = vi.spyOn(defaultDispatcher, "fire");
            renderWithClient(<InsideRoomSummaryTiles room={room} />);
            await userEvent.click(screen.getByRole("button", { name: "Search" }));
            expect(fire).toHaveBeenCalledWith(Action.FocusMessageSearch);
        });

        it("opens the room options menu", async () => {
            renderWithClient(<InsideRoomSummaryTiles room={room} />);
            expect(screen.queryByTestId("more-menu-content")).not.toBeInTheDocument();
            await userEvent.click(screen.getByRole("button", { name: "More" }));
            expect(screen.getByTestId("more-menu-content")).toBeInTheDocument();
        });
    });

    describe("event classification", () => {
        it("finds http(s) URLs without trailing punctuation", () => {
            expect(findUrls("see https://example.org/a, and http://x.y/b).")).toEqual([
                "https://example.org/a",
                "http://x.y/b",
            ]);
            expect(findUrls("no links here")).toEqual([]);
            expect(findUrls(undefined)).toEqual([]);
        });

        it("sorts messages into media, files and links", () => {
            const image = mkMsg({ msgtype: MsgType.Image, body: "a.png", url: "mxc://x/a" }, 1);
            const video = mkMsg({ msgtype: MsgType.Video, body: "a.mp4", url: "mxc://x/b" }, 2);
            const file = mkMsg({ msgtype: MsgType.File, body: "a.pdf", url: "mxc://x/c" }, 3);
            const voice = mkMsg(
                { "msgtype": MsgType.Audio, "body": "voice", "url": "mxc://x/d", "org.matrix.msc3245.voice": {} },
                4,
            );
            const link = mkMsg({ msgtype: MsgType.Text, body: "look https://example.org" }, 5);
            const text = mkMsg({ msgtype: MsgType.Text, body: "hello" }, 6);

            expect([image, video, file, voice, link, text].map((e) => eventMatchesTab(e, "media"))).toEqual([
                true,
                true,
                false,
                false,
                false,
                false,
            ]);
            expect([image, video, file, voice, link, text].map((e) => eventMatchesTab(e, "files"))).toEqual([
                false,
                false,
                true,
                false,
                false,
                false,
            ]);
            expect([image, video, file, voice, link, text].map((e) => eventMatchesTab(e, "links"))).toEqual([
                false,
                false,
                false,
                false,
                true,
                false,
            ]);
        });
    });

    describe("media tabs", () => {
        const image = (): MatrixEvent =>
            mkMsg(
                { msgtype: MsgType.Image, body: "photo.png", url: "mxc://example.org/photo", info: { w: 10, h: 10 } },
                10,
            );
        const file = (): MatrixEvent =>
            mkMsg({ msgtype: MsgType.File, body: "deck.pdf", url: "mxc://example.org/deck", info: { size: 2048 } }, 20);
        const link = (): MatrixEvent => mkMsg({ msgtype: MsgType.Text, body: "price list https://example.org/p" }, 30);

        it("shows the empty state", async () => {
            const { container } = renderWithClient(<InsideRoomMedia room={room} />);
            expect(await screen.findByText("No media here yet")).toBeInTheDocument();
            expect(container.querySelector(".mx_RoomSummaryCard_inside_tab_active")).toHaveTextContent("Media");
        });

        it("shows images in the grid and opens the image viewer", async () => {
            await room.addLiveEvents([image(), file()], { addToState: false });
            const createDialog = vi.spyOn(Modal, "createDialog").mockReturnValue({} as any);
            const { container } = renderWithClient(<InsideRoomMedia room={room} />);

            const item = await screen.findByRole("button", { name: "photo.png" });
            expect(container.querySelectorAll(".mx_RoomSummaryCard_inside_grid li")).toHaveLength(1);
            await userEvent.click(item);
            expect(createDialog).toHaveBeenCalledWith(
                ImageView,
                expect.objectContaining({ name: "photo.png", width: 10, height: 10 }),
                "mx_Dialog_lightbox",
                undefined,
                true,
            );
        });

        it("lists files and links and jumps to the message", async () => {
            const fileEv = file();
            const linkEv = link();
            await room.addLiveEvents([image(), fileEv, linkEv], { addToState: false });
            const dispatch = vi.spyOn(defaultDispatcher, "dispatch");
            const { container } = renderWithClient(<InsideRoomMedia room={room} />);

            await userEvent.click(screen.getByRole("tab", { name: "Files" }));
            const fileItem = await screen.findByText("deck.pdf");
            expect(container.querySelector(".mx_RoomSummaryCard_inside_list")).toBeInTheDocument();
            expect(screen.getByText(/2 KB/)).toBeInTheDocument();
            await userEvent.click(fileItem);
            expect(dispatch).toHaveBeenCalledWith(
                expect.objectContaining({ action: Action.ViewRoom, event_id: fileEv.getId(), highlighted: true }),
            );

            await userEvent.click(screen.getByRole("tab", { name: "Links" }));
            expect(await screen.findByText("example.org")).toBeInTheDocument();
            expect(screen.getByText("https://example.org/p")).toBeInTheDocument();
            await userEvent.click(screen.getByText("example.org"));
            expect(dispatch).toHaveBeenCalledWith(
                expect.objectContaining({ action: Action.ViewRoom, event_id: linkEv.getId() }),
            );
        });

        it("loads older events when the end of the list scrolls into view", async () => {
            let observerCallback: IntersectionObserverCallback | undefined;
            vi.stubGlobal(
                "IntersectionObserver",
                class {
                    public constructor(cb: IntersectionObserverCallback) {
                        observerCallback = cb;
                    }
                    public observe(): void {}
                    public disconnect(): void {}
                },
            );

            await room.addLiveEvents([image()], { addToState: false });
            const older = mkMsg({ msgtype: MsgType.Image, body: "older.png", url: "mxc://example.org/older" }, 1);
            client.paginateEventTimeline.mockImplementation(async (timeline: EventTimeline) => {
                timeline.getTimelineSet().addEventsToTimeline([older], true, false, timeline, null);
                return false;
            });
            const { container } = renderWithClient(<InsideRoomMedia room={room} />);
            await screen.findByRole("button", { name: "photo.png" });
            const set = Object.values(
                (room as unknown as { filteredTimelineSets: Record<string, any> }).filteredTimelineSets,
            )[0];
            // The filtered timeline set can be paginated backwards.
            set.getLiveTimeline().setPaginationToken("token", EventTimeline.BACKWARDS);

            // Re-open the tab so the window sees the token.
            await userEvent.click(screen.getByRole("tab", { name: "Files" }));
            await userEvent.click(screen.getByRole("tab", { name: "Media" }));
            await screen.findByRole("button", { name: "photo.png" });
            await waitFor(() => expect(observerCallback).toBeDefined());

            await act(async () =>
                observerCallback!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver),
            );
            expect(await screen.findByRole("button", { name: "older.png" })).toBeInTheDocument();
            expect(client.paginateEventTimeline).toHaveBeenCalled();
            expect(container.querySelectorAll(".mx_RoomSummaryCard_inside_grid li")).toHaveLength(2);
            vi.unstubAllGlobals();
        });
    });
});
