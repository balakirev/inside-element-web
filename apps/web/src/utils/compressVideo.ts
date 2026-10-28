/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Inside: videos are made smaller before they are sent, as Telegram does. A video over 20 MB or
 * taller than 1080p is transcoded with WebCodecs to H.264 of at most 1080p (720p over 100 MB) at
 * 5 Mbps (4 Mbps at 720p), with AAC audio copied or re-encoded, into an MP4 whose index (`moov`)
 * is at the start, so that it can play before it has downloaded completely.
 *
 * Mediabunny (MPL-2.0) reads, transcodes and writes the file; it is loaded only when a video is
 * compressed. Whatever goes wrong, the browser lacks the codecs, or the work takes too long, the
 * original file is sent.
 */

import { logger } from "matrix-js-sdk/src/logger";
import type { ConversionAudioOptions, Input } from "mediabunny";

/** Videos up to this size and 1080p are sent as they are. */
export const VIDEO_MAX_BYTES = 20 * 1024 * 1024;
/** Videos over this size go down to 720p. */
export const VIDEO_LARGE_BYTES = 100 * 1024 * 1024;
/** Videos over this size are sent as they are: the result is built in memory. */
export const VIDEO_MAX_INPUT_BYTES = 1024 * 1024 * 1024;

const HD_SHORT_SIDE = 1080;
const SD_SHORT_SIDE = 720;
const HD_BITRATE = 5_000_000;
const SD_BITRATE = 4_000_000;
const AUDIO_BITRATE = 128_000;
// Not worth it unless the result is clearly smaller.
const MIN_GAIN = 0.8;
// The time the work may take: this much plus the length of the video, but never more than the cap.
const TIME_ALLOWANCE_MS = 30_000;
const TIME_CAP_MS = 10 * 60_000;
// Giving up when the work has not moved on for this long.
const STALL_MS = 10_000;

export interface VideoTarget {
    width: number;
    height: number;
    bitrate: number;
}

function even(n: number): number {
    return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * The size and bitrate to transcode a video to, or null if it is better sent as it is.
 *
 * @param width - the width the video is shown at (after rotation)
 * @param height - the height the video is shown at
 * @param size - the size of the file in bytes
 * @param duration - the length of the video in seconds, if known
 */
export function videoTarget(width: number, height: number, size: number, duration?: number): VideoTarget | null {
    const shortSide = Math.min(width, height);
    if (size <= VIDEO_MAX_BYTES && shortSide <= HD_SHORT_SIDE) return null;
    const maxShortSide = size > VIDEO_LARGE_BYTES ? SD_SHORT_SIDE : HD_SHORT_SIDE;
    const bitrate = maxShortSide === SD_SHORT_SIDE ? SD_BITRATE : HD_BITRATE;
    const scale = Math.min(1, maxShortSide / shortSide);
    if (duration && duration > 0) {
        const expected = ((bitrate + AUDIO_BITRATE) * duration) / 8;
        if (expected > size * MIN_GAIN) return null;
    }
    return { width: even(width * scale), height: even(height * scale), bitrate };
}

/** Whether this browser could compress videos at all (WebCodecs encoding). */
export function canCompressVideos(): boolean {
    return typeof VideoEncoder !== "undefined" && typeof VideoDecoder !== "undefined";
}

/** Whether a file is a video that {@link compressVideoForUpload} may make smaller. */
export function isCompressibleVideo(file: File): boolean {
    return file.type.startsWith("video/") && file.size <= VIDEO_MAX_INPUT_BYTES && canCompressVideos();
}

export interface CompressVideoOptions {
    /** Aborting it stops the work; the original is returned then. */
    signal?: AbortSignal;
    /** Called with the share of the work done, 0 to 1. */
    onProgress?: (progress: number) => void;
    /** Overrides the time the work may take. */
    timeoutMs?: number;
    /** Overrides how long the work may stand still. */
    stallMs?: number;
}

function mp4Name(name: string): string {
    const dot = name.lastIndexOf(".");
    return `${dot > 0 ? name.slice(0, dot) : name || "video"}.mp4`;
}

/**
 * The video to send in place of `file`: transcoded if it is large and the browser can do it, the
 * file itself otherwise.
 */
export async function compressVideoForUpload(file: File, options: CompressVideoOptions = {}): Promise<File> {
    if (!isCompressibleVideo(file) || options.signal?.aborted) return file;
    const started = performance.now();
    let input: Input | undefined;
    try {
        const mb = await import("mediabunny");
        // The containers phones and cameras record to.
        input = new mb.Input({ source: new mb.BlobSource(file), formats: [mb.MP4, mb.QTFF, mb.WEBM, mb.MATROSKA] });
        const video = await input.getPrimaryVideoTrack();
        if (!video) return file;
        const duration = await input.computeDuration();
        const target = videoTarget(video.displayWidth, video.displayHeight, file.size, duration);
        if (!target || !(await video.canDecode())) return file;
        const quality = new mb.Quality({ bitrate: target.bitrate });
        if (!(await mb.canEncodeVideo("avc", { width: target.width, height: target.height, quality }))) {
            logger.info("This browser cannot encode H.264 at this size; sending the video as it is");
            return file;
        }

        // AAC is copied as it is; other audio is re-encoded to AAC, which every player knows.
        const audio = await input.getPrimaryAudioTrack();
        let audioOptions: ConversionAudioOptions | undefined;
        if (audio && audio.codec !== "aac") {
            if (!(await audio.canDecode()) || !(await mb.canEncodeAudio("aac"))) {
                logger.info("This browser cannot re-encode the audio to AAC; sending the video as it is");
                return file;
            }
            audioOptions = { codec: "aac", quality: new mb.Quality({ bitrate: AUDIO_BITRATE }) };
        }

        const bufferTarget = new mb.BufferTarget();
        const output = new mb.Output({
            format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
            target: bufferTarget,
        });
        const conversion = await mb.Conversion.init({
            input,
            output,
            tracks: "primary",
            video: {
                codec: "avc",
                width: target.width,
                height: target.height,
                fit: "contain",
                quality,
                forceTranscode: true,
            },
            audio: audioOptions,
            // Phones write the place a video was taken into its tags; like EXIF of photos, drop them.
            tags: {},
            showWarnings: false,
        });
        if (!conversion.isValid) return file;

        // Stop on cancel, past the time cap, or when the encoder stops moving (some browsers have
        // the API but never produce a frame); the original goes then.
        const cancel = (): void => void conversion.cancel();
        const stallMs = options.stallMs ?? STALL_MS;
        let stallTimer = setTimeout(cancel, stallMs);
        let lastProgress = -1;
        conversion.onProgress = (progress): void => {
            if (progress > lastProgress) {
                lastProgress = progress;
                clearTimeout(stallTimer);
                stallTimer = setTimeout(cancel, stallMs);
            }
            options.onProgress?.(progress);
        };
        const timeoutMs = options.timeoutMs ?? Math.min(TIME_CAP_MS, TIME_ALLOWANCE_MS + duration * 1000);
        const timer = setTimeout(cancel, timeoutMs);
        options.signal?.addEventListener("abort", cancel);
        try {
            await conversion.execute();
        } finally {
            clearTimeout(timer);
            clearTimeout(stallTimer);
            options.signal?.removeEventListener("abort", cancel);
        }

        const buffer = bufferTarget.buffer;
        if (!buffer || buffer.byteLength >= file.size) return file;
        logger.info(
            `Compressed a video from ${file.size} to ${buffer.byteLength} bytes ` +
                `(${target.width}×${target.height}) in ${Math.round(performance.now() - started)} ms`,
        );
        return new File([buffer], mp4Name(file.name), { type: "video/mp4", lastModified: file.lastModified });
    } catch (e) {
        if (!options.signal?.aborted) logger.warn("Unable to compress a video, sending the original", e);
        return file;
    } finally {
        input?.dispose();
    }
}
