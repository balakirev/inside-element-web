/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "test-utils-rtl";
import { EventType, MatrixEvent, MsgType, PendingEventOrdering, Room, RoomEvent } from "matrix-js-sdk/src/matrix";
import { stubClient } from "test-utils";

import ContentMessages from "../../../ContentMessages";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { RoomUpload } from "../../../models/RoomUpload";
import InsidePendingUploads, { formatUploadProgress } from "./InsidePendingUploads";
import * as pdfThumbnail from "../../../utils/pdfThumbnail";

function makeUpload(room: Room, name: string, type: string, total: number, loaded: number): RoomUpload {
    const upload = new RoomUpload(room.roomId, name, undefined, total);
    upload.file = new File(["x"], name, { type });
    upload.onProgress({ loaded, total });
    return upload;
}

describe("InsidePendingUploads", () => {
    const client = stubClient();
    let room: Room;
    let current: RoomUpload[];
    let failed: RoomUpload[];

    beforeEach(() => {
        room = new Room("!room:server", client, client.getSafeUserId(), {
            pendingEventOrdering: PendingEventOrdering.Detached,
        });
        current = [];
        failed = [];
        const contentMessages = ContentMessages.sharedInstance();
        vi.spyOn(contentMessages, "getCurrentUploads").mockImplementation(() => current);
        vi.spyOn(contentMessages, "getFailedUploads").mockImplementation(() => failed);
        vi.spyOn(contentMessages, "cancelUpload").mockImplementation(() => {});
        vi.spyOn(contentMessages, "retryUpload").mockResolvedValue();
        vi.spyOn(contentMessages, "dismissFailedUpload").mockImplementation(() => {});
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:null/preview");
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function renderUploads(): ReturnType<typeof render> {
        return render(
            <ol>
                <InsidePendingUploads room={room} />
            </ol>,
        );
    }

    it("renders nothing without uploads", () => {
        const { container } = renderUploads();
        expect(container.querySelector(".mx_InsidePendingUpload")).toBeNull();
    });

    it("shows an image upload as a dimmed preview with a progress ring and a cancel button", () => {
        const upload = makeUpload(room, "photo.jpg", "image/jpeg", 4 * 1024 * 1024, 1024 * 1024);
        upload.caption = "Look";
        current = [upload];

        const { container } = renderUploads();

        const media = container.querySelector(".mx_InsidePendingUpload_media")!;
        expect(media.querySelector("img")).toHaveAttribute("src", "blob:null/preview");
        expect(media.querySelector(".mx_InsidePendingUpload_overlay")).not.toBeNull();
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
        expect(container.querySelector(".mx_InsidePendingUpload_progressText")).toHaveTextContent("1.0 of 4.0 MB");
        expect(container.querySelector(".mx_InsidePendingUpload_caption")).toHaveTextContent("Look");

        fireEvent.click(screen.getByRole("button", { name: "Cancel upload" }));
        expect(ContentMessages.sharedInstance().cancelUpload).toHaveBeenCalledWith(upload);
    });

    it("says the photo is being compressed before its upload starts", () => {
        const upload = makeUpload(room, "photo.jpg", "image/jpeg", 4 * 1024 * 1024, 0);
        upload.compressing = true;
        current = [upload];

        const { container } = renderUploads();

        expect(container.querySelector(".mx_InsidePendingUpload_progressText")).toHaveTextContent("Compressing…");
    });

    it("shows a video upload with its first frame", () => {
        current = [makeUpload(room, "clip.mp4", "video/mp4", 2048, 0)];

        const { container } = renderUploads();

        const video = container.querySelector(".mx_InsidePendingUpload_media video")!;
        expect(video).toHaveAttribute("src", "blob:null/preview#t=0.001");
        expect(video).toHaveProperty("muted", true);
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    });

    it("shows another file as a file bubble with the ring in place of the icon", () => {
        current = [makeUpload(room, "report.pdf", "application/pdf", 10 * 1024, 5 * 1024)];

        const { container } = renderUploads();

        const file = container.querySelector(".mx_InsidePendingUpload_file")!;
        expect(file.querySelector(".mx_InsidePendingUpload_ring")).not.toBeNull();
        expect(file).toHaveTextContent("report.pdf");
        expect(file).toHaveTextContent("50% · 5.0 of 10.0 kB");
        expect(container.querySelector(".mx_InsidePendingUpload_media")).toBeNull();
    });

    it("shows the first page of a PDF under the ring once drawn", async () => {
        const thumbnail = { blob: new Blob(["jpeg"], { type: "image/jpeg" }), width: 226, height: 320 };
        vi.spyOn(pdfThumbnail, "pdfThumbnailForFile").mockResolvedValue(thumbnail);
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:null/page");
        current = [makeUpload(room, "report.pdf", "application/pdf", 10 * 1024, 1024)];

        const { container } = renderUploads();

        await waitFor(() =>
            expect(container.querySelector(".mx_InsidePendingUpload_filePage img")).toHaveAttribute(
                "src",
                "blob:null/page",
            ),
        );
        expect(
            container.querySelector(
                ".mx_InsidePendingUpload_filePage .mx_InsidePendingUpload_overlay .mx_InsidePendingUpload_ring",
            ),
        ).not.toBeNull();
        expect(container.querySelector(".mx_InsidePendingUpload_fileInfo")).toHaveTextContent("10% · 1.0 of 10.0 kB");
    });

    it("follows the progress", async () => {
        const upload = makeUpload(room, "report.pdf", "application/pdf", 1000, 100);
        current = [upload];
        renderUploads();
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "10");

        upload.onProgress({ loaded: 900, total: 1000 });
        act(() => {
            dis.dispatch({ action: Action.UploadProgress, upload }, true);
        });

        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "90");
    });

    it("gives its place to the event of the upload once that is in the timeline", () => {
        const upload = makeUpload(room, "photo.jpg", "image/jpeg", 1000, 1000);
        upload.contentUri = "mxc://server/photo";
        current = [upload];
        const { container } = renderUploads();
        expect(container.querySelector(".mx_InsidePendingUpload")).not.toBeNull();

        const echo = new MatrixEvent({
            type: EventType.RoomMessage,
            room_id: room.roomId,
            sender: client.getSafeUserId(),
            content: { msgtype: MsgType.Image, body: "photo.jpg", url: "mxc://server/photo" },
        });
        vi.spyOn(room, "getPendingEvents").mockReturnValue([echo]);
        act(() => {
            room.emit(RoomEvent.LocalEchoUpdated, echo, room);
        });

        expect(container.querySelector(".mx_InsidePendingUpload")).toBeNull();
    });

    it("shows a failed upload with retry and delete", () => {
        const upload = makeUpload(room, "report.pdf", "application/pdf", 1000, 300);
        upload.failed = true;
        upload.failureReason = "The file 'report.pdf' failed to upload.";
        failed = [upload];

        const { container } = renderUploads();

        const bubble = container.querySelector(".mx_InsidePendingUpload")!;
        expect(bubble).toHaveClass("mx_InsidePendingUpload_failed");
        expect(bubble).toHaveAttribute("title", "The file 'report.pdf' failed to upload.");
        expect(screen.queryByRole("progressbar")).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(ContentMessages.sharedInstance().retryUpload).toHaveBeenCalledWith(upload);
        fireEvent.click(screen.getByRole("button", { name: "Delete" }));
        expect(ContentMessages.sharedInstance().dismissFailedUpload).toHaveBeenCalledWith(upload);
    });

    it("formats progress in the unit of the total", () => {
        expect(formatUploadProgress(12.3 * 1024 * 1024, 42.5 * 1024 * 1024)).toBe("12.3 of 42.5 MB");
        expect(formatUploadProgress(512, 3 * 1024 * 1024 * 1024)).toBe("0.0 of 3.0 GB");
    });
});
