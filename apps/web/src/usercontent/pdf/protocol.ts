/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * The protocol between the app and the PDF usercontent iframe. The iframe posts `ready` to its parent
 * with one end of a MessageChannel; everything else travels over that channel. Neither side trusts the
 * other: each message is parsed before use.
 */

/**
 * Where the reader is in the document, as pdf.js reports it on `updateviewarea` and accepts it back as
 * an `XYZ` destination. `left` and `top` are in PDF user-space units on `page`.
 */
export interface PdfPosition {
    /** 1-based page at the top of the view. */
    page: number;
    /** A percentage, or one of pdf.js's named scales such as `"page-width"`. */
    scale: number | string;
    left: number;
    top: number;
}

export const PDF_NAMED_SCALES: ReadonlySet<string> = new Set([
    "auto",
    "page-actual",
    "page-fit",
    "page-width",
    "page-height",
]);

/** Which way a zoom step goes. */
export type PdfZoomDirection = "in" | "out";

/** Inside: a keyboard scroll step through the pages: a line, a screen, or to either end. */
export type PdfScrollStep = "line_up" | "line_down" | "page_up" | "page_down" | "start" | "end";

const PDF_SCROLL_STEPS: ReadonlySet<string> = new Set(["line_up", "line_down", "page_up", "page_down", "start", "end"]);

/**
 * Messages the app sends to the iframe: the document (transferred) and where to open it, a page to go
 * to, or a zoom step.
 */
export type PdfHostMessage =
    | { type: "load"; data: ArrayBuffer; position?: PdfPosition }
    | { type: "go_to_page"; page: number }
    | { type: "zoom"; direction: PdfZoomDirection }
    /** Inside: scroll the pages, for the keys the app gets while the frame does not have the focus. */
    | { type: "scroll"; step: PdfScrollStep }
    /** Inside: render the first page of the document (transferred) to an image at most `maxSide` px long. */
    | { type: "thumbnail"; data: ArrayBuffer; maxSide: number };

/** Messages the iframe sends to the app. */
export type PdfUsercontentMessage =
    /** Listening. Carries the app's end of the channel in `event.ports`. */
    | { type: "ready" }
    /** Laid out, saved position applied. */
    | { type: "loaded"; pageCount: number; page: number }
    /** The page at the top of the view changed. */
    | { type: "page"; page: number }
    /** The zoom level changed. `scale` is a percentage. */
    | { type: "scale"; scale: number }
    | { type: "position"; position: PdfPosition }
    /** Inside: Escape was pressed inside the frame; the app closes the viewer if it is a modal one. */
    | { type: "dismiss" }
    /** Inside: the first page as an image, in answer to `thumbnail`. */
    | { type: "thumbnail"; image: ArrayBuffer; mimetype: string; width: number; height: number }
    /** For the log, not the reader. */
    | { type: "error"; message: string };

/** Inside: the largest thumbnail the iframe will draw, whatever the app asks for. */
export const MAX_THUMBNAIL_SIDE = 1024;

/** Inside: the image types a thumbnail may come back as. */
const THUMBNAIL_MIMETYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Cap on an error message from the iframe. */
export const MAX_ERROR_MESSAGE_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 1;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

export function isPdfPosition(value: unknown): value is PdfPosition {
    if (!isRecord(value)) return false;

    const scaleIsValid =
        (isFiniteNumber(value.scale) && value.scale > 0) ||
        (typeof value.scale === "string" && PDF_NAMED_SCALES.has(value.scale));

    return isPositiveInteger(value.page) && scaleIsValid && isFiniteNumber(value.left) && isFiniteNumber(value.top);
}

/** Parse a message received by the iframe; `undefined` if malformed. */
export function parsePdfHostMessage(data: unknown): PdfHostMessage | undefined {
    if (!isRecord(data)) return;

    switch (data.type) {
        case "load": {
            if (!(data.data instanceof ArrayBuffer)) return;
            if (data.position !== undefined && !isPdfPosition(data.position)) return;
            return { type: "load", data: data.data, position: data.position };
        }
        case "go_to_page":
            if (!isPositiveInteger(data.page)) return;
            return { type: "go_to_page", page: data.page };
        case "zoom":
            if (data.direction !== "in" && data.direction !== "out") return;
            return { type: "zoom", direction: data.direction };
        case "scroll":
            if (typeof data.step !== "string" || !PDF_SCROLL_STEPS.has(data.step)) return;
            return { type: "scroll", step: data.step as PdfScrollStep };
        case "thumbnail":
            if (!(data.data instanceof ArrayBuffer)) return;
            if (!isPositiveInteger(data.maxSide) || data.maxSide > MAX_THUMBNAIL_SIDE) return;
            return { type: "thumbnail", data: data.data, maxSide: data.maxSide };
    }
}

/** Parse a message received by the app; `undefined` if malformed. Only known fields are copied out. */
export function parsePdfUsercontentMessage(data: unknown): PdfUsercontentMessage | undefined {
    if (!isRecord(data)) return;

    switch (data.type) {
        case "ready":
            return { type: "ready" };
        case "loaded":
            if (!isPositiveInteger(data.pageCount) || !isPositiveInteger(data.page) || data.page > data.pageCount)
                return;
            return { type: "loaded", pageCount: data.pageCount, page: data.page };
        case "page":
            if (!isPositiveInteger(data.page)) return;
            return { type: "page", page: data.page };
        case "scale":
            if (!isFiniteNumber(data.scale) || data.scale <= 0) return;
            return { type: "scale", scale: data.scale };
        case "position": {
            if (!isPdfPosition(data.position)) return;
            const { page, scale, left, top } = data.position;
            return { type: "position", position: { page, scale, left, top } };
        }
        case "thumbnail":
            if (!(data.image instanceof ArrayBuffer) || data.image.byteLength === 0) return;
            if (typeof data.mimetype !== "string" || !THUMBNAIL_MIMETYPES.has(data.mimetype)) return;
            if (!isPositiveInteger(data.width) || !isPositiveInteger(data.height)) return;
            if (data.width > MAX_THUMBNAIL_SIDE || data.height > MAX_THUMBNAIL_SIDE) return;
            return {
                type: "thumbnail",
                image: data.image,
                mimetype: data.mimetype,
                width: data.width,
                height: data.height,
            };
        case "dismiss":
            return { type: "dismiss" };
        case "error":
            if (typeof data.message !== "string") return;
            return { type: "error", message: data.message.slice(0, MAX_ERROR_MESSAGE_LENGTH) };
    }
}

/** Inside: what a key press does in the PDF viewer, on either side of the frame. */
export type PdfKeyAction =
    | { type: "scroll"; step: PdfScrollStep }
    | { type: "zoom"; direction: PdfZoomDirection }
    | { type: "dismiss" };

/** Inside: the keys of the pages as in macOS Quick Look: arrows, Page Up/Down, Space, Home/End, ⌘/Ctrl +/−, Escape. */
export function pdfKeyAction(
    event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
): PdfKeyAction | undefined {
    if (event.altKey) return;
    if (event.ctrlKey || event.metaKey) {
        if (event.key === "+" || event.key === "=") return { type: "zoom", direction: "in" };
        if (event.key === "-" || event.key === "_") return { type: "zoom", direction: "out" };
        return;
    }
    switch (event.key) {
        case "Escape":
            return { type: "dismiss" };
        case "ArrowUp":
            return { type: "scroll", step: "line_up" };
        case "ArrowDown":
            return { type: "scroll", step: "line_down" };
        case "PageUp":
            return { type: "scroll", step: "page_up" };
        case "PageDown":
            return { type: "scroll", step: "page_down" };
        case " ":
            return { type: "scroll", step: event.shiftKey ? "page_up" : "page_down" };
        case "Home":
            return { type: "scroll", step: "start" };
        case "End":
            return { type: "scroll", step: "end" };
    }
}
