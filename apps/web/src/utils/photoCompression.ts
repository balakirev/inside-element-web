/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Inside: photos are made smaller before they are sent, as Telegram's "send as photo" does: the long
 * side at most 2560 px, JPEG at quality 0.85 (WebP or PNG when the picture has transparency). The
 * orientation from EXIF is applied, and EXIF itself (camera, GPS) does not survive the re-encode.
 *
 * This file holds the work itself, which runs in a worker (workers/photoCompression.worker.ts) or on
 * the main thread; `compressPhoto.ts` decides where and falls back to the original file.
 */

/** The long side of a compressed photo, in pixels. */
export const PHOTO_MAX_SIDE = 2560;
/** Photos up to this size and {@link PHOTO_MAX_SIDE} are sent as they are. */
export const PHOTO_MAX_BYTES = 1.5 * 1024 * 1024;
/** Encoder quality for JPEG and WebP. */
export const PHOTO_QUALITY = 0.85;

const COMPRESSIBLE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const PHOTO_EXTENSIONS = ["jpg", "jpeg", "jpe", "jfif", "png", "webp", "heic", "heif"];
// HEIC is converted whatever its size: only Safari can show it, so other receivers would see nothing.
const ALWAYS_CONVERT_TYPES = ["image/heic", "image/heif"];

export interface CompressPhotoOptions {
    maxSide?: number;
    maxBytes?: number;
    quality?: number;
}

export interface CompressedPhoto {
    blob: Blob;
    width: number;
    height: number;
}

/**
 * Whether a file is a photo that may be compressed: one of the still image types browsers decode,
 * under a name that says so. A file named otherwise (say, "plan.dat" with an image type) is a file
 * the user sends as it is.
 */
export function isCompressiblePhoto(file: File): boolean {
    if (!COMPRESSIBLE_TYPES.includes(file.type)) return false;
    const dot = file.name.lastIndexOf(".");
    if (dot < 0) return true;
    return PHOTO_EXTENSIONS.includes(file.name.slice(dot + 1).toLowerCase());
}

/** The size of a picture whose long side is cut down to `maxSide`, keeping the aspect ratio. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
    const longSide = Math.max(width, height);
    if (longSide <= maxSide) return { width, height };
    const scale = maxSide / longSide;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The file name with the extension of the type it was encoded to: "IMG_1.HEIC" → "IMG_1.jpg". */
export function compressedFileName(name: string, mimeType: string): string {
    const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name || "image";
    return `${base}.${extension}`;
}

/**
 * The EXIF orientation (1–8) of a JPEG, 1 if it has none. Reads only the APP1 segment.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
        const marker = view.getUint16(offset);
        if ((marker & 0xff00) !== 0xff00) return 1;
        const length = view.getUint16(offset + 2);
        // Start of scan: the metadata is over.
        if (marker === 0xffda) return 1;
        if (marker === 0xffe1 && offset + 10 <= view.byteLength && view.getUint32(offset + 4) === 0x45786966) {
            return readTiffOrientation(view, offset + 10, Math.min(view.byteLength, offset + 2 + length));
        }
        offset += 2 + length;
    }
    return 1;
}

function readTiffOrientation(view: DataView, start: number, end: number): number {
    if (start + 8 > end) return 1;
    const little = view.getUint16(start) === 0x4949;
    const ifd = start + view.getUint32(start + 4, little);
    if (ifd + 2 > end) return 1;
    const entries = view.getUint16(ifd, little);
    for (let i = 0; i < entries; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > end) return 1;
        if (view.getUint16(entry, little) === 0x0112) {
            const value = view.getUint16(entry + 8, little);
            return value >= 1 && value <= 8 ? value : 1;
        }
    }
    return 1;
}

// A 2×1 JPEG marked "rotate 90° clockwise": a browser that applies EXIF orientation decodes it as 1×2.
const ORIENTATION_TEST_JPEG =
    "/9j/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD//gAPTGF2YzYzLjEuMTAyAP/bAEMACD4+ST5JVVVVVVVVZF1kaGhoZGRkZGho" +
    "aHBwcIODg3BwcGhocHB8fIODj5OPh4eDh5OTm5uburqystnZ4P/////EAEwAAQEAAAAAAAAAAAAAAAAAAAAGAQEBAAAAAAAAAAAAAAAAAAAGBxAB" +
    "AAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAEAAgMBIgACEQADEQD/2gAMAwEAAhEDEQA/AIsATX9//9k=";

let orientationApplied: Promise<boolean> | undefined;

/** Whether `createImageBitmap` applies the EXIF orientation itself (the spec says it does). */
function bitmapsApplyOrientation(): Promise<boolean> {
    orientationApplied ??= (async (): Promise<boolean> => {
        const bytes = Uint8Array.from(atob(ORIENTATION_TEST_JPEG), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }), {
            imageOrientation: "from-image",
        });
        const applied = bitmap.width === 1 && bitmap.height === 2;
        bitmap.close();
        return applied;
    })().catch(() => true);
    return orientationApplied;
}

/**
 * Turn the drawing context so that a picture stored in EXIF `orientation` comes out upright, for
 * a picture drawn at `width`×`height` (its stored, not its displayed, size).
 */
function applyOrientation(
    context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    orientation: number,
    width: number,
    height: number,
): void {
    switch (orientation) {
        case 2:
            context.transform(-1, 0, 0, 1, width, 0);
            break;
        case 3:
            context.transform(-1, 0, 0, -1, width, height);
            break;
        case 4:
            context.transform(1, 0, 0, -1, 0, height);
            break;
        case 5:
            context.transform(0, 1, 1, 0, 0, 0);
            break;
        case 6:
            context.transform(0, 1, -1, 0, height, 0);
            break;
        case 7:
            context.transform(0, -1, -1, 0, height, width);
            break;
        case 8:
            context.transform(0, -1, 1, 0, 0, width);
            break;
    }
}

function hasTransparency(data: Uint8ClampedArray): boolean {
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) return true;
    }
    return false;
}

type Canvas = OffscreenCanvas | HTMLCanvasElement;
type Source = ImageBitmap | HTMLImageElement;

function makeCanvas(width: number, height: number): Canvas {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function encodeCanvas(canvas: Canvas, type: string, quality: number): Promise<Blob> {
    if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
        return canvas.convertToBlob({ type, quality });
    }
    return new Promise<Blob>((resolve, reject) =>
        (canvas as HTMLCanvasElement).toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("Canvas could not be encoded"))),
            type,
            quality,
        ),
    );
}

async function decode(blob: Blob): Promise<{ source: Source; orientation: number; close(): void }> {
    let orientation = 1;
    if (blob.type === "image/jpeg") {
        const head = new Uint8Array(await blob.slice(0, 128 * 1024).arrayBuffer());
        orientation = readJpegOrientation(head);
    }
    if (typeof createImageBitmap !== "undefined" && typeof OffscreenCanvas !== "undefined") {
        const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
        // Turn the picture by hand only where the browser left it as stored.
        if (orientation !== 1 && (await bitmapsApplyOrientation())) orientation = 1;
        return { source: bitmap, orientation, close: () => bitmap.close() };
    }
    // An <img> applies the orientation itself (CSS image-orientation: from-image).
    const url = URL.createObjectURL(blob);
    try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
            img.onload = (): void => resolve();
            img.onerror = (): void => reject(new Error("Image could not be decoded"));
            img.src = url;
        });
        return { source: img, orientation: 1, close: () => {} };
    } finally {
        URL.revokeObjectURL(url);
    }
}

function sourceSize(source: Source): { width: number; height: number } {
    if ("naturalWidth" in source) return { width: source.naturalWidth, height: source.naturalHeight };
    return { width: source.width, height: source.height };
}

/**
 * Make a photo smaller for sending. Resolves to null when the photo is fine as it is (small enough,
 * or the result would not be smaller). Throws when the picture cannot be decoded or encoded.
 * Works both in a worker and on the main thread.
 */
export async function compressPhotoBlob(
    blob: Blob,
    { maxSide = PHOTO_MAX_SIDE, maxBytes = PHOTO_MAX_BYTES, quality = PHOTO_QUALITY }: CompressPhotoOptions = {},
): Promise<CompressedPhoto | null> {
    const decoded = await decode(blob);
    try {
        const stored = sourceSize(decoded.source);
        const turned = decoded.orientation >= 5;
        const shown = turned ? { width: stored.height, height: stored.width } : stored;
        const alwaysConvert = ALWAYS_CONVERT_TYPES.includes(blob.type);
        const needsResize = Math.max(shown.width, shown.height) > maxSide;
        if (!needsResize && blob.size <= maxBytes && !alwaysConvert) return null;

        const target = fitWithin(shown.width, shown.height, maxSide);
        const canvas = makeCanvas(target.width, target.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No 2D canvas context");
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        const drawWidth = turned ? target.height : target.width;
        const drawHeight = turned ? target.width : target.height;
        applyOrientation(context, decoded.orientation, drawWidth, drawHeight);
        context.drawImage(decoded.source, 0, 0, drawWidth, drawHeight);
        context.setTransform(1, 0, 0, 1, 0, 0);

        let type = "image/jpeg";
        if (blob.type !== "image/jpeg") {
            const pixels = context.getImageData(0, 0, target.width, target.height);
            if (hasTransparency(pixels.data)) type = "image/webp";
        }
        let result = await encodeCanvas(canvas, type, quality);
        // Browsers that cannot encode WebP hand back a PNG, which keeps the transparency too.
        if (type === "image/webp" && result.type !== "image/webp") {
            result = await encodeCanvas(canvas, "image/png", quality);
        }
        if (!alwaysConvert && result.size >= blob.size) return null;
        return { blob: result, width: target.width, height: target.height };
    } finally {
        decoded.close();
    }
}

export interface PhotoWorkerRequest {
    seq: number;
    blob: Blob;
    options: CompressPhotoOptions;
}

export interface PhotoWorkerResponse {
    seq: number;
    result?: CompressedPhoto | null;
    error?: string;
}
