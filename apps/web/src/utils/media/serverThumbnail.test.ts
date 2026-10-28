/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from "vitest";
import { type ImageContent } from "matrix-js-sdk/src/types";

import { fitInto, imageThumbnailHttp, pickServerThumbnailSize } from "./serverThumbnail";
import { ImageSize } from "../../settings/enums/ImageSize";
import { stubClient } from "../../test/test-utils";

describe("serverThumbnail", () => {
    describe("fitInto", () => {
        it("fits like Synapse's scale method and never upscales", () => {
            expect(fitInto({ w: 640, h: 480 }, { w: 3000, h: 2000 })).toEqual({ w: 640, h: 426 });
            expect(fitInto({ w: 640, h: 480 }, { w: 2000, h: 3000 })).toEqual({ w: 320, h: 480 });
            expect(fitInto({ w: 640, h: 480 }, { w: 100, h: 80 })).toEqual({ w: 100, h: 80 });
        });
    });

    describe("pickServerThumbnailSize", () => {
        it("picks the smallest prepared size covering the bubble", () => {
            // A normal landscape bubble, 324×243, on a standard screen: 320×240 is close enough.
            expect(pickServerThumbnailSize({ w: 4000, h: 3000 }, { w: 324, h: 243 })).toEqual({ w: 320, h: 240 });
            // The same bubble on a 2× screen.
            expect(pickServerThumbnailSize({ w: 4000, h: 3000 }, { w: 648, h: 486 })).toEqual({ w: 640, h: 480 });
            // A large bubble on a standard screen.
            expect(pickServerThumbnailSize({ w: 4000, h: 3000 }, { w: 800, h: 600 })).toEqual({ w: 800, h: 600 });
        });

        it("returns null when no prepared size is sharp enough", () => {
            expect(pickServerThumbnailSize({ w: 4000, h: 3000 }, { w: 1600, h: 1200 })).toBeNull();
            // Smaller than the bubble needs on this screen: only the original has every pixel.
            expect(pickServerThumbnailSize({ w: 200, h: 150 }, { w: 400, h: 300 })).toBeNull();
        });
    });

    describe("imageThumbnailHttp", () => {
        beforeEach(() => {
            const client = stubClient();
            // eslint-disable-next-line no-restricted-properties
            vi.mocked(client.mxcUrlToHttp).mockImplementation(
                (mxc: string, width?: number, height?: number, method?: string) =>
                    `https://hs/${mxc.slice(6)}${width ? `?width=${width}&height=${height}&method=${method}` : ""}`,
            );
        });

        const content = (info: ImageContent["info"]): ImageContent =>
            ({ msgtype: "m.image", body: "photo", url: "mxc://hs/photo", info }) as ImageContent;
        const options = (devicePixelRatio: number, imageSize = ImageSize.Normal) => ({ imageSize, devicePixelRatio });

        it("asks for the prepared size that fits the bubble", () => {
            const photo = content({ w: 4000, h: 3000, size: 5_000_000, mimetype: "image/jpeg" });
            expect(imageThumbnailHttp(photo, options(1))).toBe("https://hs/hs/photo?width=320&height=240&method=scale");
            expect(imageThumbnailHttp(photo, options(2))).toBe("https://hs/hs/photo?width=640&height=480&method=scale");
            expect(imageThumbnailHttp(photo, options(1, ImageSize.Large))).toBe(
                "https://hs/hs/photo?width=800&height=600&method=scale",
            );
        });

        it("uses a small original when no prepared size is sharp enough, the largest one otherwise", () => {
            expect(imageThumbnailHttp(content({ w: 4000, h: 3000, size: 500_000 }), options(2, ImageSize.Large))).toBe(
                "https://hs/hs/photo",
            );
            expect(
                imageThumbnailHttp(content({ w: 4000, h: 3000, size: 5_000_000 }), options(2, ImageSize.Large)),
            ).toBe("https://hs/hs/photo?width=800&height=600&method=scale");
        });

        it("asks for the largest prepared size when the dimensions are unknown", () => {
            expect(imageThumbnailHttp(content({ size: 5_000_000 }), options(2))).toBe(
                "https://hs/hs/photo?width=800&height=600&method=scale",
            );
        });
    });
});
