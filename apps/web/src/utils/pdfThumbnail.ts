/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { logger } from "matrix-js-sdk/src/logger";

import { PDF_IFRAME_PERMISSIONS, PDF_USERCONTENT_URL } from "../components/views/right_panel/PdfViewer";
import { type PdfHostMessage, parsePdfUsercontentMessage } from "../usercontent/pdf/protocol";
import { PDF_MIMETYPE } from "./pdfViewer";

/**
 * Inside: a picture of the first page of a PDF, as Telegram shows for documents. Drawn by pdf.js in the
 * same sandboxed usercontent iframe as the PDF viewer (opaque origin, no network), one at a time, in a
 * hidden iframe that is removed again afterwards.
 */

const log = logger.getChild("pdfThumbnail");

/** The long side of the thumbnail sent with a PDF, in pixels. */
export const PDF_THUMBNAIL_SIDE = 320;
/** Larger files are not drawn when sending them. */
export const MAX_PDF_THUMBNAIL_BYTES = 50 * 1024 * 1024;
/** Older PDFs without a thumbnail are drawn in the timeline only up to this size. */
export const MAX_LAZY_PDF_THUMBNAIL_BYTES = 5 * 1024 * 1024;
/** How long one page may take before we give up. */
const TIMEOUT_MS = 20_000;
/** How many drawn pages of events are kept as object URLs. */
const MAX_CACHED_URLS = 100;

export interface PdfThumbnail {
    blob: Blob;
    width: number;
    height: number;
}

/** Whether a file to send is a PDF, by its type or, if it has none, by its name. */
export function isPdfFile(file: Pick<File, "type" | "name">): boolean {
    const type = file.type.split(";")[0].trim().toLowerCase();
    if (type) return type === PDF_MIMETYPE;
    return file.name.toLowerCase().endsWith(".pdf");
}

/** `%PDF-`, which every PDF carries near its start. */
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PDF_HEADER_SEARCH_LIMIT = 1024;

function hasPdfHeader(data: Uint8Array): boolean {
    const lastStart = Math.min(data.length - PDF_HEADER.length, PDF_HEADER_SEARCH_LIMIT);
    for (let start = 0; start <= lastStart; start++) {
        if (PDF_HEADER.every((byte, offset) => data[start + offset] === byte)) return true;
    }
    return false;
}

function renderInIframe(data: ArrayBuffer, maxSide: number): Promise<PdfThumbnail> {
    return new Promise<PdfThumbnail>((resolve, reject) => {
        const iframe = document.createElement("iframe");
        iframe.setAttribute("sandbox", PDF_IFRAME_PERMISSIONS);
        iframe.setAttribute("aria-hidden", "true");
        iframe.tabIndex = -1;
        iframe.title = "";
        // Laid out (browsers may not run a display:none frame) but out of sight and out of the way.
        Object.assign(iframe.style, {
            position: "fixed",
            left: "-10000px",
            top: "0",
            width: "400px",
            height: "400px",
            border: "0",
            opacity: "0",
            pointerEvents: "none",
        });

        let port: MessagePort | undefined;
        let done = false;
        const finish = (settle: () => void): void => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            window.removeEventListener("message", onWindowMessage);
            port?.close();
            iframe.remove();
            settle();
        };
        const timer = setTimeout(() => finish(() => reject(new Error("PDF thumbnail timed out"))), TIMEOUT_MS);

        const onPortMessage = (event: MessageEvent): void => {
            const message = parsePdfUsercontentMessage(event.data);
            if (message?.type === "thumbnail") {
                const { image, mimetype, width, height } = message;
                finish(() => resolve({ blob: new Blob([image], { type: mimetype }), width, height }));
            } else if (message?.type === "error") {
                finish(() => reject(new Error(message.message)));
            }
        };

        // As in PdfViewer: only our iframe, with the "null" origin of a sandboxed frame, hands over a port.
        const onWindowMessage = (event: MessageEvent): void => {
            if (event.source !== iframe.contentWindow || event.origin !== "null") return;
            const received = event.ports[0];
            if (parsePdfUsercontentMessage(event.data)?.type !== "ready" || !received || port) return;
            port = received;
            port.onmessage = onPortMessage;
            const request: PdfHostMessage = { type: "thumbnail", data, maxSide };
            port.postMessage(request, [data]);
        };

        window.addEventListener("message", onWindowMessage);
        iframe.src = PDF_USERCONTENT_URL;
        document.body.appendChild(iframe);
    });
}

// One page at a time: each one starts pdf.js and its worker.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Draw the first page of a PDF, at most `maxSide` pixels long. Resolves to `undefined`, never rejects,
 * when the file is too large, is not a PDF, is protected by a password, is broken or takes too long.
 */
export function renderPdfThumbnail(
    source: Blob,
    { maxSide = PDF_THUMBNAIL_SIDE, maxBytes = MAX_PDF_THUMBNAIL_BYTES }: { maxSide?: number; maxBytes?: number } = {},
): Promise<PdfThumbnail | undefined> {
    if (source.size === 0 || source.size > maxBytes) return Promise.resolve(undefined);

    const run = async (): Promise<PdfThumbnail | undefined> => {
        try {
            const data = new Uint8Array(await source.arrayBuffer());
            if (!hasPdfHeader(data)) return undefined;
            return await renderInIframe(data.buffer, maxSide);
        } catch (e) {
            log.warn("Unable to draw the first page of a PDF", e);
            return undefined;
        }
    };
    const result = queue.then(run, run);
    queue = result;
    return result;
}

const fileThumbnails = new WeakMap<Blob, Promise<PdfThumbnail | undefined>>();

/**
 * The first page of a PDF being sent, drawn once per file: the upload dialog, the pending bubble and
 * the thumbnail sent with the file share it.
 */
export function pdfThumbnailForFile(file: File): Promise<PdfThumbnail | undefined> {
    if (!isPdfFile(file)) return Promise.resolve(undefined);
    let thumbnail = fileThumbnails.get(file);
    if (!thumbnail) {
        thumbnail = renderPdfThumbnail(file);
        fileThumbnails.set(file, thumbnail);
    }
    return thumbnail;
}

const urlCache = new Map<string, Promise<string | undefined>>();

/**
 * An object URL of the first page of a PDF in the timeline that was sent without a thumbnail, drawn on
 * first request and kept for the session (the oldest are dropped past a hundred). Only for files up to
 * {@link MAX_LAZY_PDF_THUMBNAIL_BYTES}, as the whole file has to be downloaded for it.
 */
export function lazyPdfThumbnailUrl(key: string, size: number, blob: () => Promise<Blob>): Promise<string | undefined> {
    const cached = urlCache.get(key);
    if (cached) return cached;
    if (!(size > 0 && size <= MAX_LAZY_PDF_THUMBNAIL_BYTES)) return Promise.resolve(undefined);

    const url = blob()
        .then((source) => renderPdfThumbnail(source, { maxBytes: MAX_LAZY_PDF_THUMBNAIL_BYTES }))
        .then((thumbnail) => (thumbnail ? URL.createObjectURL(thumbnail.blob) : undefined))
        .catch((e) => {
            log.warn("Unable to fetch a PDF for its thumbnail", e);
            return undefined;
        });
    urlCache.set(key, url);
    while (urlCache.size > MAX_CACHED_URLS) {
        const [oldestKey, oldest] = urlCache.entries().next().value!;
        urlCache.delete(oldestKey);
        void oldest.then((oldUrl) => oldUrl && URL.revokeObjectURL(oldUrl));
    }
    return url;
}
