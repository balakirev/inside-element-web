/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    compressedFileName,
    compressPhotoBlob,
    fitWithin,
    isCompressiblePhoto,
    readJpegOrientation,
} from "./photoCompression";

// A 2×1 JPEG with EXIF orientation 6 (big-endian TIFF), as in photoCompression.ts.
const ROTATED_JPEG =
    "/9j/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD//gAPTGF2YzYzLjEuMTAyAP/bAEMACD4+ST5JVVVVVVVVZF1kaGhoZGRkZGho" +
    "aHBwcIODg3BwcGhocHB8fIODj5OPh4eDh5OTm5uburqystnZ4P/////EAEwAAQEAAAAAAAAAAAAAAAAAAAAGAQEBAAAAAAAAAAAAAAAAAAAGBxAB" +
    "AAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAEAAgMBIgACEQADEQD/2gAMAwEAAhEDEQA/AIsATX9//9k=";

function bytesOf(base64: string): Uint8Array {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** A JPEG header with an APP1 EXIF segment in little-endian ("II") order carrying `orientation`. */
function littleEndianExif(orientation: number): Uint8Array {
    const tiff = [0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0];
    const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const length = app1.length + 2;
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...app1, 0xff, 0xda, 0, 2]);
}

describe("photo compression helpers", () => {
    it("compresses only still photo types under a photo name", () => {
        expect(isCompressiblePhoto(new File([], "IMG_1.JPG", { type: "image/jpeg" }))).toBe(true);
        expect(isCompressiblePhoto(new File([], "shot.png", { type: "image/png" }))).toBe(true);
        expect(isCompressiblePhoto(new File([], "IMG_2.HEIC", { type: "image/heic" }))).toBe(true);
        expect(isCompressiblePhoto(new File([], "pasted", { type: "image/webp" }))).toBe(true);
        expect(isCompressiblePhoto(new File([], "cat.gif", { type: "image/gif" }))).toBe(false);
        expect(isCompressiblePhoto(new File([], "icon.svg", { type: "image/svg+xml" }))).toBe(false);
        // A file named otherwise is sent as it is.
        expect(isCompressiblePhoto(new File([], "scan.tiffx", { type: "image/jpeg" }))).toBe(false);
    });

    it("fits the long side within the limit, keeping the aspect ratio", () => {
        expect(fitWithin(4032, 3024, 2560)).toEqual({ width: 2560, height: 1920 });
        expect(fitWithin(3024, 4032, 2560)).toEqual({ width: 1920, height: 2560 });
        expect(fitWithin(1200, 800, 2560)).toEqual({ width: 1200, height: 800 });
    });

    it("names the file after the type it was encoded to", () => {
        expect(compressedFileName("IMG_1.HEIC", "image/jpeg")).toBe("IMG_1.jpg");
        expect(compressedFileName("logo.png", "image/webp")).toBe("logo.webp");
        expect(compressedFileName("", "image/jpeg")).toBe("image.jpg");
    });

    it("reads the EXIF orientation of a JPEG", () => {
        expect(readJpegOrientation(bytesOf(ROTATED_JPEG))).toBe(6);
        expect(readJpegOrientation(littleEndianExif(3))).toBe(3);
        expect(readJpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1);
        expect(readJpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(1);
    });
});

interface FakeContext {
    transform: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
    setTransform: ReturnType<typeof vi.fn>;
    getImageData: ReturnType<typeof vi.fn>;
    imageSmoothingEnabled?: boolean;
    imageSmoothingQuality?: string;
}

describe("compressPhotoBlob", () => {
    let decodedSize: { width: number; height: number };
    // Whether the fake browser applies EXIF orientation in createImageBitmap.
    let appliesOrientation: boolean;
    let alpha: number;
    let encodedSize: number;
    let encodableTypes: string[];
    let canvases: Array<{ width: number; height: number; context: FakeContext }>;
    let encodes: Array<{ type?: string; quality?: number }>;

    beforeEach(() => {
        decodedSize = { width: 4032, height: 3024 };
        appliesOrientation = true;
        alpha = 255;
        encodedSize = 700_000;
        encodableTypes = ["image/jpeg", "image/png", "image/webp"];
        canvases = [];
        encodes = [];

        vi.stubGlobal(
            "createImageBitmap",
            vi.fn(async (blob: Blob) => {
                // The orientation probe is a 2×1 picture turned by 90°.
                if (blob.size === bytesOf(ROTATED_JPEG).length) {
                    return appliesOrientation
                        ? { width: 1, height: 2, close: vi.fn() }
                        : { width: 2, height: 1, close: vi.fn() };
                }
                return { ...decodedSize, close: vi.fn() };
            }),
        );
        vi.stubGlobal(
            "OffscreenCanvas",
            class {
                public context: FakeContext;
                public constructor(
                    public width: number,
                    public height: number,
                ) {
                    this.context = {
                        transform: vi.fn(),
                        drawImage: vi.fn(),
                        setTransform: vi.fn(),
                        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, alpha, 0, 0, 0, 255]) })),
                    };
                    canvases.push(this);
                }
                public getContext(): FakeContext {
                    return this.context;
                }
                public async convertToBlob(options: { type?: string; quality?: number }): Promise<Blob> {
                    encodes.push(options);
                    const type = encodableTypes.includes(options.type!) ? options.type : "image/png";
                    return new Blob([new Uint8Array(encodedSize)], { type });
                }
            },
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function photo(size: number, type = "image/jpeg", head?: Uint8Array): Blob {
        const bytes = new Uint8Array(size);
        if (head) bytes.set(head);
        return new Blob([bytes], { type });
    }

    it("leaves a small photo as it is", async () => {
        decodedSize = { width: 1600, height: 1200 };
        expect(await compressPhotoBlob(photo(900_000))).toBeNull();
        expect(canvases).toHaveLength(0);
    });

    it("shrinks a large photo to 2560 px on the long side as JPEG 0.85", async () => {
        const result = await compressPhotoBlob(photo(5_000_000));

        expect(result).toEqual({ blob: expect.any(Blob), width: 2560, height: 1920 });
        expect(result!.blob.type).toBe("image/jpeg");
        expect(encodes).toEqual([{ type: "image/jpeg", quality: 0.85 }]);
        expect(canvases[0].context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2560, 1920);
        expect(canvases[0].context.transform).not.toHaveBeenCalled();
    });

    it("re-encodes a heavy photo that is not too large", async () => {
        decodedSize = { width: 2000, height: 1500 };
        const result = await compressPhotoBlob(photo(2_000_000));
        expect(result).toEqual({ blob: expect.any(Blob), width: 2000, height: 1500 });
    });

    it("keeps the original when the result would not be smaller", async () => {
        decodedSize = { width: 2000, height: 1500 };
        encodedSize = 2_500_000;
        expect(await compressPhotoBlob(photo(2_000_000))).toBeNull();
    });

    it("turns the picture itself where the browser does not apply EXIF orientation", async () => {
        appliesOrientation = false;
        // The probe's answer is kept for the session, so take a fresh module.
        vi.resetModules();
        const fresh = await import("./photoCompression");
        const result = await fresh.compressPhotoBlob(photo(5_000_000, "image/jpeg", littleEndianExif(6)));

        // Stored 4032×3024 and turned by 90°: shown upright as 1920×2560.
        expect(result).toEqual({ blob: expect.any(Blob), width: 1920, height: 2560 });
        expect(canvases[0].context.transform).toHaveBeenCalledWith(0, 1, -1, 0, 1920, 0);
        expect(canvases[0].context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2560, 1920);
    });

    it("keeps a transparent PNG transparent, as WebP or else PNG", async () => {
        alpha = 0;
        let result = await compressPhotoBlob(photo(5_000_000, "image/png"));
        expect(result!.blob.type).toBe("image/webp");

        encodableTypes = ["image/jpeg", "image/png"];
        encodes = [];
        result = await compressPhotoBlob(photo(5_000_000, "image/png"));
        expect(result!.blob.type).toBe("image/png");
        expect(encodes.map((e) => e.type)).toEqual(["image/webp", "image/png"]);
    });

    it("sends an opaque PNG as JPEG", async () => {
        const result = await compressPhotoBlob(photo(5_000_000, "image/png"));
        expect(result!.blob.type).toBe("image/jpeg");
    });

    it("always converts HEIC, which most browsers cannot show", async () => {
        decodedSize = { width: 1000, height: 800 };
        encodedSize = 600_000;
        const result = await compressPhotoBlob(photo(500_000, "image/heic"));
        expect(result).toEqual({ blob: expect.any(Blob), width: 1000, height: 800 });
        expect(result!.blob.type).toBe("image/jpeg");
    });
});
