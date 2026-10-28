/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom
// @vitest-environment-options {"settings": {"navigation": {"disableChildFrameNavigation": true }}}

import { describe, expect, it, vi } from "vitest";
import { waitFor } from "test-utils-rtl";

import { isPdfFile, lazyPdfThumbnailUrl, pdfThumbnailForFile, renderPdfThumbnail } from "./pdfThumbnail";
import { type PdfHostMessage } from "../usercontent/pdf/protocol";
import { PDF_IFRAME_PERMISSIONS, PDF_USERCONTENT_URL } from "../components/views/right_panel/PdfViewer";

const PDF = "%PDF-1.7\n%%EOF\n";

interface FakePort {
    postMessage: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent) => void) | null;
    close: ReturnType<typeof vi.fn>;
}

/** Wait for the hidden iframe, say `ready` from it and return its port. */
async function readyIframe(): Promise<{ iframe: HTMLIFrameElement; port: FakePort }> {
    const iframe = await waitFor(() => {
        const found = document.body.querySelector("iframe");
        expect(found).not.toBeNull();
        return found!;
    });
    const win = {};
    Object.defineProperty(iframe, "contentWindow", { configurable: true, value: win });
    const port: FakePort = { postMessage: vi.fn(), onmessage: null, close: vi.fn() };
    const event = new MessageEvent("message", { data: { type: "ready" }, source: win as Window, origin: "null" });
    Object.defineProperty(event, "ports", { value: [port] });
    window.dispatchEvent(event);
    return { iframe, port };
}

describe("pdfThumbnail", () => {
    it("tells PDFs by type, or by name without a type", () => {
        expect(isPdfFile({ type: "application/pdf", name: "a" })).toBe(true);
        expect(isPdfFile({ type: "application/pdf; version=1.7", name: "a" })).toBe(true);
        expect(isPdfFile({ type: "", name: "Report.PDF" })).toBe(true);
        expect(isPdfFile({ type: "text/plain", name: "a.pdf" })).toBe(false);
    });

    it("does not draw empty, oversized or non-PDF files", async () => {
        expect(await renderPdfThumbnail(new Blob([]))).toBeUndefined();
        expect(await renderPdfThumbnail(new Blob([PDF]), { maxBytes: 4 })).toBeUndefined();
        expect(await renderPdfThumbnail(new Blob(["hello"]))).toBeUndefined();
        expect(document.body.querySelector("iframe")).toBeNull();
    });

    it("draws the first page in a sandboxed usercontent iframe and removes it", async () => {
        const result = renderPdfThumbnail(new Blob([PDF]));
        const { iframe, port } = await readyIframe();

        expect(iframe.getAttribute("sandbox")).toBe(PDF_IFRAME_PERMISSIONS);
        expect(iframe.getAttribute("src")).toBe(PDF_USERCONTENT_URL);
        const [request] = port.postMessage.mock.calls[0] as [PdfHostMessage];
        expect(request).toEqual(expect.objectContaining({ type: "thumbnail", maxSide: 320 }));

        port.onmessage!(
            new MessageEvent("message", {
                data: { type: "thumbnail", image: new ArrayBuffer(3), mimetype: "image/jpeg", width: 226, height: 320 },
            }),
        );

        const thumbnail = await result;
        expect(thumbnail).toEqual({ blob: expect.any(Blob), width: 226, height: 320 });
        expect(thumbnail!.blob.type).toBe("image/jpeg");
        expect(document.body.querySelector("iframe")).toBeNull();
        expect(port.close).toHaveBeenCalled();
    });

    it("gives no thumbnail when the iframe reports an error", async () => {
        const result = renderPdfThumbnail(new Blob([PDF]));
        const { port } = await readyIframe();
        port.onmessage!(new MessageEvent("message", { data: { type: "error", message: "PasswordException" } }));

        expect(await result).toBeUndefined();
        expect(document.body.querySelector("iframe")).toBeNull();
    });

    it("draws a file being sent once", async () => {
        const file = new File(["hello"], "notes.pdf", { type: "application/pdf" });
        const first = pdfThumbnailForFile(file);
        expect(pdfThumbnailForFile(file)).toBe(first);
        expect(await first).toBeUndefined();
        expect(await pdfThumbnailForFile(new File(["x"], "a.txt", { type: "text/plain" }))).toBeUndefined();
    });

    it("draws older PDFs in the timeline only when small, and once", async () => {
        const blob = vi.fn(async () => new Blob(["hello"]));
        expect(await lazyPdfThumbnailUrl("mxc://a/large", 6 * 1024 * 1024, blob)).toBeUndefined();
        expect(blob).not.toHaveBeenCalled();

        const url = lazyPdfThumbnailUrl("mxc://a/small", 100, blob);
        expect(lazyPdfThumbnailUrl("mxc://a/small", 100, blob)).toBe(url);
        expect(await url).toBeUndefined();
        expect(blob).toHaveBeenCalledTimes(1);
    });
});
