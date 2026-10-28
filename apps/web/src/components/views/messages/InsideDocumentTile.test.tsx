/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { EventType, MatrixEvent } from "matrix-js-sdk/src/matrix";

import InsideDocumentTile, { documentTypeLabel } from "./InsideDocumentTile";
import { type MediaEventHelper } from "../../../utils/MediaEventHelper";
import { FileDownloader } from "../../../utils/FileDownloader";
import SettingsStore from "../../../settings/SettingsStore";
import { SettingLevel } from "../../../settings/SettingLevel";
import * as documentViewer from "../../../utils/documentViewer";
import * as pdfThumbnail from "../../../utils/pdfThumbnail";

function mkEvent(content: Record<string, unknown> = {}): MatrixEvent {
    return new MatrixEvent({
        room_id: "!room:server",
        sender: "@user:server",
        type: EventType.RoomMessage,
        event_id: "$file",
        content: { msgtype: "m.file", body: "report.pdf", url: "mxc://server/file", ...content },
    });
}

function mkHelper(
    fileName: string,
    { hasThumbnail = false, thumbnailUrl = null as string | null, blob = new Blob(["%PDF-1.7"]) } = {},
): MediaEventHelper {
    return {
        fileName,
        media: { isEncrypted: false, hasThumbnail, srcMxc: "mxc://server/file" },
        thumbnailUrl: { value: Promise.resolve(thumbnailUrl) },
        sourceBlob: { value: Promise.resolve(blob) },
    } as unknown as MediaEventHelper;
}

const pdfInfo = { mimetype: "application/pdf", size: 9049210 };

describe("InsideDocumentTile", () => {
    let download: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        download = vi.spyOn(FileDownloader.prototype, "download").mockResolvedValue(undefined);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        await SettingsStore.setValue("feature_pdf_viewer", null, SettingLevel.DEVICE, null);
    });

    it("labels the type from the extension, or else from the mimetype", () => {
        expect(documentTypeLabel("report.pdf")).toBe("PDF");
        expect(documentTypeLabel("archive.tar.gz")).toBe("GZ");
        expect(documentTypeLabel("README", "text/markdown")).toBeUndefined();
        expect(documentTypeLabel("notes", "application/zip")).toBe("ZIP");
        expect(documentTypeLabel("weird.extension-name")).toBeUndefined();
    });

    it("shows the name, the size and the type, with a document icon without a thumbnail", () => {
        const { container } = render(
            <InsideDocumentTile mxEvent={mkEvent({ info: pdfInfo })} mediaEventHelper={mkHelper("report.pdf")} />,
        );

        expect(container.querySelector(".mx_MFileBody_inside_name")).toHaveTextContent("report.pdf");
        expect(container.querySelector(".mx_MFileBody_inside_meta")).toHaveTextContent("8.6 MB · PDF");
        expect(container.querySelector(".mx_MFileBody_inside_thumb .mx_MFileBody_inside_icon")).toHaveTextContent(
            "PDF",
        );
        expect(container).toMatchSnapshot();
    });

    it("cuts a long name in the middle, keeping its end", () => {
        const name = "Quarterly financial statement 2026.pdf";
        const { container } = render(
            <InsideDocumentTile mxEvent={mkEvent({ info: pdfInfo })} mediaEventHelper={mkHelper(name)} />,
        );

        expect(container.querySelector(".mx_MFileBody_inside_name")).toHaveAttribute("title", name);
        expect(container.querySelector(".mx_MFileBody_inside_nameEnd")).toHaveTextContent("2026.pdf");
        expect(container.querySelector(".mx_MFileBody_inside_name")).toHaveTextContent(name);
    });

    it("shows the thumbnail sent with the file", async () => {
        const { container } = render(
            <InsideDocumentTile
                mxEvent={mkEvent({ info: pdfInfo })}
                mediaEventHelper={mkHelper("report.pdf", { hasThumbnail: true, thumbnailUrl: "https://thumb" })}
            />,
        );

        await waitFor(() =>
            expect(container.querySelector(".mx_MFileBody_inside_thumb_picture img")).toHaveAttribute(
                "src",
                "https://thumb",
            ),
        );
    });

    it("opens a PDF in the viewer from anywhere on the tile, and downloads from the button", async () => {
        const open = vi.spyOn(documentViewer, "openDocumentViewer").mockImplementation(() => {});
        const blob = new Blob(["%PDF-1.7"]);
        const mxEvent = mkEvent({ info: pdfInfo });
        render(<InsideDocumentTile mxEvent={mxEvent} mediaEventHelper={mkHelper("report.pdf", { blob })} />);

        await userEvent.click(screen.getByRole("button", { name: "Open PDF" }));
        expect(open).toHaveBeenCalledWith(mxEvent);
        expect(download).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole("button", { name: "Download" }));
        await waitFor(() => expect(download).toHaveBeenCalledWith({ blob, name: "report.pdf" }));
    });

    it("downloads other files from anywhere on the tile", async () => {
        const blob = new Blob(["zip"]);
        const { container } = render(
            <InsideDocumentTile
                mxEvent={mkEvent({ body: "a.zip", info: { mimetype: "application/zip", size: 861 } })}
                mediaEventHelper={mkHelper("a.zip", { blob })}
            />,
        );

        await userEvent.click(container.querySelector(".mx_MFileBody_inside_open")!);
        await waitFor(() => expect(download).toHaveBeenCalledWith({ blob, name: "a.zip" }));
    });

    it("draws the first page of an older PDF once the tile is on screen", async () => {
        let observed: IntersectionObserverCallback | undefined;
        vi.stubGlobal(
            "IntersectionObserver",
            vi.fn(function (callback: IntersectionObserverCallback) {
                observed = callback;
                return { observe: vi.fn(), disconnect: vi.fn() };
            }),
        );
        const lazy = vi.spyOn(pdfThumbnail, "lazyPdfThumbnailUrl").mockResolvedValue("blob:null/page");
        const { container } = render(
            <InsideDocumentTile mxEvent={mkEvent({ info: pdfInfo })} mediaEventHelper={mkHelper("report.pdf")} />,
        );
        expect(lazy).not.toHaveBeenCalled();

        observed!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);

        await waitFor(() =>
            expect(container.querySelector(".mx_MFileBody_inside_thumb img")).toHaveAttribute("src", "blob:null/page"),
        );
        expect(lazy).toHaveBeenCalledWith("mxc://server/file", pdfInfo.size, expect.any(Function));
    });
});
