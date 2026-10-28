/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { EventType, MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";

import {
    documentMediaForEvent,
    documentViewerForEvent,
    openDocumentViewer,
    quickLookKindForEvent,
} from "./documentViewer";
import { type MediaEventHelper } from "./MediaEventHelper";
import defaultDispatcher from "../dispatcher/dispatcher";
import { Action } from "../dispatcher/actions";

function mkFileEvent(body: string, info?: Record<string, unknown>): MatrixEvent {
    return new MatrixEvent({
        room_id: "!room:example.org",
        sender: "@user:example.org",
        type: EventType.RoomMessage,
        content: { body, msgtype: MsgType.File, url: `mxc://example.org/${body}`, info },
    });
}

describe("documentViewerForEvent", () => {
    it("offers nothing for a file no viewer can open", () => {
        expect(documentViewerForEvent(mkFileEvent("photos.zip", { mimetype: "application/zip" }))).toBeUndefined();
    });

    it("picks the plain text viewer for a text file (Inside)", () => {
        const viewer = documentViewerForEvent(mkFileEvent("notes.txt", { mimetype: "text/plain" }));

        expect(viewer?.openLabel()).toBe("Open text");
        expect(viewer?.Component).toBeDefined();
    });

    it("picks the PDF viewer for a PDF", () => {
        const mxEvent = mkFileEvent("spec.pdf", { mimetype: "application/pdf" });

        const viewer = documentViewerForEvent(mxEvent);

        expect(viewer?.openLabel()).toBe("Open PDF");
        expect(viewer?.Component).toBeDefined();
    });

    it("picks the Markdown viewer for a Markdown file", () => {
        const mxEvent = mkFileEvent("README.md", { mimetype: "text/markdown" });

        const viewer = documentViewerForEvent(mxEvent);

        expect(viewer?.openLabel()).toBe("Open Markdown");
        expect(viewer?.Component).toBeDefined();
    });
});

/** A MediaEventHelper that does not need a logged-in client behind it. */
function mkHelper(blob = new Blob(["%PDF-1.7\n"], { type: "application/pdf" })): MediaEventHelper {
    return {
        media: { srcMxc: "mxc://example.org/spec.pdf" },
        fileName: "spec.pdf",
        sourceBlob: { value: Promise.resolve(blob) },
    } as unknown as MediaEventHelper;
}

describe("documentMediaForEvent", () => {
    it("returns nothing for a file no viewer can open", () => {
        expect(documentMediaForEvent(mkFileEvent("photos.zip", { mimetype: "application/zip" }))).toBeUndefined();
    });

    it("keys on the MXC URI and defers to the helper for the bytes", async () => {
        const blob = new Blob(["%PDF-1.7\n"], { type: "application/pdf" });
        const media = documentMediaForEvent(mkFileEvent("spec.pdf", { mimetype: "application/pdf" }), mkHelper(blob));

        expect(media).toMatchObject({ uri: "mxc://example.org/spec.pdf", name: "spec.pdf" });
        // The helper decrypts behind `sourceBlob`, so the viewer gets plaintext either way.
        await expect(media!.blob()).resolves.toBe(blob);
    });

    it("passes on the declared size so a viewer can refuse a file before downloading it", () => {
        const media = documentMediaForEvent(
            mkFileEvent("spec.pdf", { mimetype: "application/pdf", size: 1234 }),
            mkHelper(),
        );

        expect(media?.size).toBe(1234);
    });

    it.each([undefined, "1234", -1, Number.NaN, Number.POSITIVE_INFINITY])(
        "leaves the size unset when the sender declared %s",
        (size) => {
            const media = documentMediaForEvent(
                mkFileEvent("spec.pdf", { mimetype: "application/pdf", size }),
                mkHelper(),
            );

            expect(media?.size).toBeUndefined();
        },
    );
});

describe("openDocumentViewer", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([
        ["spec.pdf", "application/pdf", "pdf"],
        ["README.md", "text/markdown", "markdown"],
        ["notes.md", "text/plain", "markdown"],
        ["notes.txt", "text/plain", "text"],
        ["server.log", undefined, "text"],
        ["photos.zip", "application/zip", undefined],
    ])("opens %s (%s) in the Quick Look window as %s (Inside)", (body, mimetype, kind) => {
        expect(quickLookKindForEvent(mkFileEvent(body, mimetype ? { mimetype } : undefined))).toBe(kind);
    });

    it("opens a Markdown file in the Quick Look window rather than the right panel (Inside)", async () => {
        const dispatch = vi.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        const quickLook = await import("../components/views/elements/InsideQuickLook");
        const open = vi.spyOn(quickLook, "openInsideQuickLook").mockImplementation(() => {});
        const mxEvent = mkFileEvent("README.md", { mimetype: "text/markdown" });

        openDocumentViewer(mxEvent);

        await vi.waitFor(() => expect(open).toHaveBeenCalledWith(mxEvent, undefined));
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ action: Action.OpenDocumentViewer }));
    });
});
