/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Inside: which picture to load for an image in the timeline.
 *
 * Our Synapse runs with `dynamic_thumbnails: false`: it makes thumbnails once, at upload, in the sizes
 * of `thumbnail_sizes`, and answers every thumbnail request with the closest of those. Element asked
 * for 800×600 (times the device pixel ratio) whatever the bubble size, and on high-DPI screens for the
 * original file. Here we ask for the smallest prepared size that is still sharp in the bubble on this
 * screen: 320×240 for a normal bubble on a standard screen, 640×480 on a Retina one.
 *
 * The prefetcher (`InsideMediaPrefetcher.ts`) uses the same choice, so that what it loads in advance
 * is exactly what the timeline asks for later.
 */

import { type ImageContent } from "matrix-js-sdk/src/types";

import { mediaFromContent } from "../../customisations/Media";
import { type ImageSize, suggestedSize as suggestedImageSize } from "../../settings/enums/ImageSize";

export interface Size {
    w: number;
    h: number;
}

/**
 * The `scale` sizes of `thumbnail_sizes` in the server's homeserver.yaml (Synapse's defaults; the
 * Inside deployment does not change them). Smallest first.
 */
export const SERVER_SCALE_THUMBNAIL_SIZES: readonly Size[] = [
    { w: 320, h: 240 },
    { w: 640, h: 480 },
    { w: 800, h: 600 },
];

/** The largest prepared size: what Element always asked for. */
const LARGEST = SERVER_SCALE_THUMBNAIL_SIZES[SERVER_SCALE_THUMBNAIL_SIZES.length - 1];

/** Up to 3 % of upscaling is invisible, and saves picking the next size up for a few pixels. */
const UPSCALE_TOLERANCE = 0.97;

/**
 * When no prepared size is sharp enough (a large bubble on a high-DPI screen), Element shows the
 * original if it is no bigger than this, as before.
 */
const SMALL_ORIGINAL_BYTES = 1024 * 1024;

/**
 * The size of Synapse's `scale` thumbnail of an image of size `natural` for the box `box`: the image
 * fitted into the box keeping its aspect ratio, never larger than the image itself.
 */
export function fitInto(box: Size, natural: Size): Size {
    let w: number;
    let h: number;
    if (box.w * natural.h < box.h * natural.w) {
        w = box.w;
        h = Math.floor((box.w * natural.h) / natural.w);
    } else {
        w = Math.floor((box.h * natural.w) / natural.h);
        h = box.h;
    }
    return { w: Math.min(w, natural.w), h: Math.min(h, natural.h) };
}

/**
 * The smallest prepared size whose thumbnail covers `needed` device pixels, or null if none does.
 */
export function pickServerThumbnailSize(natural: Size, needed: Size): Size | null {
    for (const box of SERVER_SCALE_THUMBNAIL_SIZES) {
        const thumb = fitInto(box, natural);
        if (thumb.w >= needed.w * UPSCALE_TOLERANCE && thumb.h >= needed.h * UPSCALE_TOLERANCE) return box;
    }
    return null;
}

export interface ImageThumbnailOptions {
    imageSize: ImageSize;
    maxImageHeight?: number;
    devicePixelRatio: number;
    isAnimated?: boolean;
}

/**
 * The HTTP URL to show an unencrypted image event in its bubble: a server thumbnail of the right size,
 * or the original when no thumbnail is sharp enough and the original is small.
 */
export function imageThumbnailHttp(content: ImageContent, options: ImageThumbnailOptions): string | null {
    const media = mediaFromContent(content);
    const info = content.info;

    if (info?.mimetype === "image/svg+xml" && media.hasThumbnail) {
        return media.getThumbnailHttp(LARGEST.w, LARGEST.h, "scale");
    }

    if (options.isAnimated || !info?.w || !info?.h) {
        return media.getServerThumbnailOfSourceHttp(LARGEST.w, LARGEST.h);
    }

    const natural = { w: info.w, h: info.h };
    const display = suggestedImageSize(options.imageSize, natural, options.maxImageHeight);
    const dpr = options.devicePixelRatio || 1;
    const box = pickServerThumbnailSize(natural, { w: display.w * dpr, h: display.h * dpr });
    if (box) return media.getServerThumbnailOfSourceHttp(box.w, box.h);

    if (info.size && info.size <= SMALL_ORIGINAL_BYTES) return media.srcHttp;
    return media.getServerThumbnailOfSourceHttp(LARGEST.w, LARGEST.h);
}
