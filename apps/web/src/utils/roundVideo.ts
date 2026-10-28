/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Inside: round video messages («кружки»), as in Telegram. A round video is an ordinary `m.video`
 * event whose content carries {@link ROUND_VIDEO_FLAG}; other clients show it as a normal video.
 */

/** Content flag of a round video message (`"estate.inside.lobby.video_note": true`). */
export const ROUND_VIDEO_FLAG = "estate.inside.lobby.video_note";

/** Longest recording, as in Telegram (all clients stop at 60 s). */
export const ROUND_VIDEO_MAX_MS = 60_000;

/** Shorter recordings are thrown away, as Telegram Web A does (1 s). */
export const ROUND_VIDEO_MIN_MS = 1_000;

/** Side of the recorded square, in pixels (Telegram records 400, its Android client 384). */
export const ROUND_VIDEO_SIDE = 384;

/** Frame rate of the recording. */
export const ROUND_VIDEO_FPS = 30;

/** Video bitrate: Telegram Web K and Web A use 1.2 Mbit/s for 400 px; 384 px needs a little less. */
export const ROUND_VIDEO_VIDEO_BPS = 1_000_000;

/** Audio bitrate (all Telegram clients: 64 kbit/s). */
export const ROUND_VIDEO_AUDIO_BPS = 64_000;

/**
 * Container and codecs to record in, best first: MP4 with H.264 and AAC plays everywhere (Safari,
 * iOS, Element X); WebM is what older Chrome and Firefox can make.
 */
export const ROUND_VIDEO_MIME_TYPES = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
];

/**
 * Whether the content of an event is a round video message, as the Lobby contract says: the flag,
 * a square picture (`info.w == info.h`) and at most 60 s (`info.duration`). Anything else with the
 * flag is shown as an ordinary video.
 */
export function isRoundVideoContent(content: { msgtype?: string; [key: string]: unknown } | undefined): boolean {
    if (content?.msgtype !== "m.video" || content[ROUND_VIDEO_FLAG] !== true) return false;
    const info = content.info as { w?: unknown; h?: unknown; duration?: unknown } | undefined;
    if (typeof info?.w !== "number" || info.w <= 0 || info.w !== info.h) return false;
    return typeof info.duration === "number" && info.duration > 0 && info.duration <= ROUND_VIDEO_MAX_MS;
}

/** The first of {@link ROUND_VIDEO_MIME_TYPES} that the recorder supports, or undefined. */
export function pickRoundVideoMimeType(isTypeSupported: (type: string) => boolean): string | undefined {
    return ROUND_VIDEO_MIME_TYPES.find((type) => {
        try {
            return isTypeSupported(type);
        } catch {
            return false;
        }
    });
}

/** The mimetype without codecs, for the file and the event ("video/mp4"). */
export function baseMimeType(type: string): string {
    return type.split(";")[0].trim();
}

/** What the record button of the composer records. */
export type RecordMode = "voice" | "round";

const RECORD_MODE_KEY = "mx_inside_record_mode";

/** The record mode last chosen on this device, voice by default (as Telegram remembers it). */
export function getRecordMode(): RecordMode {
    try {
        return window.localStorage.getItem(RECORD_MODE_KEY) === "round" ? "round" : "voice";
    } catch {
        return "voice";
    }
}

/** Remember the record mode on this device. */
export function setRecordMode(mode: RecordMode): void {
    try {
        window.localStorage.setItem(RECORD_MODE_KEY, mode);
    } catch {
        // private mode or storage full: the mode is just not kept
    }
}

/** "0:07", "1:00". */
export function formatRoundDuration(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Whether the user asked the system for less motion. */
export function prefersReducedMotion(): boolean {
    try {
        return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    } catch {
        return false;
    }
}
