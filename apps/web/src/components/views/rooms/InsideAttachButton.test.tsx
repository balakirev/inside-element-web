/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach, type MockedObject } from "vitest";
import { fireEvent, render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { mkStubRoom, stubClient } from "test-utils";

import { InsideAttachButton } from "./InsideAttachButton";
import {
    type FilePickerOptions,
    INSIDE_UPLOAD_FILE,
    INSIDE_UPLOAD_MEDIA,
    RoomUploadViewModel,
} from "../../../viewmodels/room/RoomUploadViewModel";
import { TimelineRenderingType } from "../../../contexts/RoomContext";
import { type MatrixDispatcher } from "../../../dispatcher/dispatcher";

describe("InsideAttachButton", () => {
    let client: MockedObject<MatrixClient>;
    let room: MockedObject<Room>;
    let open: (options?: FilePickerOptions) => void;
    let vm: RoomUploadViewModel;

    beforeEach(() => {
        client = stubClient() as MockedObject<MatrixClient>;
        room = mkStubRoom("!room", undefined, undefined) as MockedObject<Room>;
        room.maySendMessage.mockReturnValue(true);
        open = vi.fn();
        vm = new RoomUploadViewModel(
            room,
            client,
            TimelineRenderingType.Room,
            { dispatch: vi.fn() } as unknown as MatrixDispatcher,
            undefined,
            undefined,
            open,
        );
    });

    const items = (): string[] => screen.queryAllByRole("menuitem").map((el) => el.textContent ?? "");

    it("opens Telegram's menu above the button instead of the file picker", async () => {
        render(<InsideAttachButton vm={vm} onPoll={vi.fn()} />);
        expect(items()).toEqual([]);
        await userEvent.click(screen.getByRole("button", { name: "Attachment" }));
        expect(vi.mocked(open)).not.toHaveBeenCalled();
        expect(items()).toEqual(["Photo or video", "File", "Poll"]);
        expect(screen.getByRole("button", { name: "Attachment" })).toHaveAttribute("aria-expanded", "true");
    });

    it("opens the picker for photos and videos, or any file", async () => {
        const select = vi.spyOn(vm, "onUploadOptionSelected").mockImplementation(() => {});
        render(<InsideAttachButton vm={vm} />);
        await userEvent.click(screen.getByRole("button", { name: "Attachment" }));
        await userEvent.click(screen.getByRole("menuitem", { name: "Photo or video" }));
        expect(select).toHaveBeenLastCalledWith(INSIDE_UPLOAD_MEDIA);
        // The menu closes after a pick.
        expect(items()).toEqual([]);
        await userEvent.click(screen.getByRole("button", { name: "Attachment" }));
        await userEvent.click(screen.getByRole("menuitem", { name: "File" }));
        expect(select).toHaveBeenLastCalledWith(INSIDE_UPLOAD_FILE);
    });

    it("starts a poll from the menu", async () => {
        const onPoll = vi.fn();
        render(<InsideAttachButton vm={vm} onPoll={onPoll} />);
        await userEvent.click(screen.getByRole("button", { name: "Attachment" }));
        await userEvent.click(screen.getByRole("menuitem", { name: "Poll" }));
        expect(onPoll).toHaveBeenCalled();
    });

    it("has no poll without onPoll (threads, polls switched off)", async () => {
        render(<InsideAttachButton vm={vm} />);
        await userEvent.click(screen.getByRole("button", { name: "Attachment" }));
        expect(items()).toEqual(["Photo or video", "File"]);
    });

    it("picks the first item on Ctrl+click", () => {
        const select = vi.spyOn(vm, "onUploadOptionSelected").mockImplementation(() => {});
        render(<InsideAttachButton vm={vm} />);
        fireEvent.click(screen.getByRole("button", { name: "Attachment" }), { ctrlKey: true });
        expect(select).toHaveBeenCalledWith(INSIDE_UPLOAD_MEDIA);
        expect(items()).toEqual([]);
    });

    it("is not there where nothing may be sent", () => {
        room.maySendMessage.mockReturnValue(false);
        const readOnly = new RoomUploadViewModel(
            room,
            client,
            TimelineRenderingType.Room,
            { dispatch: vi.fn() } as unknown as MatrixDispatcher,
            undefined,
            undefined,
            open,
        );
        render(<InsideAttachButton vm={readOnly} onPoll={vi.fn()} />);
        expect(screen.queryByRole("button", { name: "Attachment" })).toBeNull();
    });
});
