/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    type RecorderLike,
    RoundVideoError,
    RoundVideoRecorder,
    type RoundVideoRecorderDeps,
    classifyMediaError,
} from "./RoundVideoRecorder";
import { sendRoundVideo, roundVideoFileName } from "./sendRoundVideo";
import type ContentMessages from "../ContentMessages";
import { ROUND_VIDEO_MAX_MS, pickRoundVideoMimeType, isRoundVideoContent, formatRoundDuration } from "./roundVideo";

class FakeRecorder implements RecorderLike {
    public state = "inactive";
    public ondataavailable: ((ev: { data: Blob }) => void) | null = null;
    public onstop: (() => void) | null = null;
    public onerror: ((ev: unknown) => void) | null = null;
    public constructor(public mimeType: string) {}
    public start(): void {
        this.state = "recording";
    }
    public stop(): void {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["frames"], { type: this.mimeType }) });
        this.onstop?.();
    }
}

function fakeTrack(): MediaStreamTrack {
    return { stop: vi.fn() } as unknown as MediaStreamTrack;
}

describe("RoundVideoRecorder", () => {
    let now: number;
    let timers: Map<number, () => void>;
    let nextTimer: number;
    let tracks: MediaStreamTrack[];
    let recorders: FakeRecorder[];
    let deps: RoundVideoRecorderDeps;
    let getUserMedia: Mock<(constraints: MediaStreamConstraints) => Promise<MediaStream>>;
    let supported: string[];

    beforeEach(() => {
        now = 1000;
        timers = new Map();
        nextTimer = 1;
        tracks = [fakeTrack(), fakeTrack()];
        recorders = [];
        supported = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/webm"];
        getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>().mockResolvedValue({
            getTracks: () => tracks,
            getAudioTracks: () => [tracks[1]],
        } as unknown as MediaStream);
        deps = {
            getUserMedia,
            isTypeSupported: (type) => supported.includes(type),
            createRecorder: (_stream, options) => {
                const r = new FakeRecorder(options.mimeType!);
                recorders.push(r);
                return r;
            },
            createCanvasStream: () => ({ getVideoTracks: () => [fakeTrack()] }) as unknown as MediaStream,
            combineStreams: (t) => ({ getTracks: () => t }) as unknown as MediaStream,
            createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement,
            createVideo: () =>
                ({
                    play: vi.fn().mockResolvedValue(undefined),
                    pause: vi.fn(),
                    videoWidth: 1280,
                    videoHeight: 720,
                }) as unknown as HTMLVideoElement,
            now: () => now,
            requestFrame: () => 0,
            cancelFrame: vi.fn(),
            setTimeout: (cb) => {
                const id = nextTimer++;
                timers.set(id, cb);
                return id;
            },
            clearTimeout: (id) => timers.delete(id),
        };
    });

    it("asks for the front camera and the microphone and records a 384 px square as MP4", async () => {
        const rec = new RoundVideoRecorder(deps);
        expect(rec.canvas.width).toBe(384);
        expect(rec.canvas.height).toBe(384);
        await rec.start();
        expect(rec.state).toBe("recording");
        expect(getUserMedia).toHaveBeenCalledWith(
            expect.objectContaining({
                video: expect.objectContaining({ facingMode: "user" }),
                audio: expect.anything(),
            }),
        );
        expect(recorders[0].mimeType).toBe("video/mp4;codecs=avc1.42E01E,mp4a.40.2");

        now += 7200;
        const result = await rec.stop();
        expect(rec.state).toBe("done");
        expect(result).toEqual(
            expect.objectContaining({ mimeType: "video/mp4", durationMs: 7200, width: 384, height: 384 }),
        );
        expect(result!.blob.size).toBeGreaterThan(0);
        // the camera is let go
        expect(tracks[0].stop).toHaveBeenCalled();
        expect(tracks[1].stop).toHaveBeenCalled();
    });

    it("falls back to WebM where MP4 cannot be recorded", async () => {
        supported = ["video/webm;codecs=vp8,opus"];
        const rec = new RoundVideoRecorder(deps);
        await rec.start();
        now += 2000;
        const result = await rec.stop();
        expect(result?.mimeType).toBe("video/webm");
    });

    it("throws a recording shorter than a second away", async () => {
        const rec = new RoundVideoRecorder(deps);
        await rec.start();
        now += 400;
        expect(await rec.stop()).toBeNull();
    });

    it("locks", async () => {
        const rec = new RoundVideoRecorder(deps);
        const listener = vi.fn();
        rec.on(listener);
        await rec.start();
        rec.lock();
        expect(rec.locked).toBe(true);
        expect(listener).toHaveBeenCalled();
        expect(rec.state).toBe("recording");
    });

    it("cancels: nothing is handed over and the camera is let go", async () => {
        const rec = new RoundVideoRecorder(deps);
        await rec.start();
        now += 5000;
        rec.cancel();
        expect(rec.state).toBe("cancelled");
        expect(tracks[0].stop).toHaveBeenCalled();
        expect(timers.size).toBe(0);
        expect(await rec.stop()).toBeNull();
    });

    it("lets the camera go when cancelled while the browser asks for it", async () => {
        let resolve!: (s: MediaStream) => void;
        getUserMedia.mockReturnValue(new Promise((r) => (resolve = r)));
        const rec = new RoundVideoRecorder(deps);
        const started = rec.start();
        rec.cancel();
        resolve({ getTracks: () => tracks, getAudioTracks: () => [] } as unknown as MediaStream);
        await started;
        expect(rec.state).toBe("cancelled");
        expect(tracks[0].stop).toHaveBeenCalled();
        expect(recorders).toHaveLength(0);
    });

    it("stops by itself at 60 seconds", async () => {
        const rec = new RoundVideoRecorder(deps);
        const onMax = vi.fn();
        rec.onMaxDuration = onMax;
        await rec.start();
        expect(timers.size).toBe(1);
        now += ROUND_VIDEO_MAX_MS + 30;
        [...timers.values()][0]();
        expect(onMax).toHaveBeenCalledTimes(1);
        const result = await onMax.mock.calls[0][0];
        expect(result.durationMs).toBe(ROUND_VIDEO_MAX_MS);
        expect(rec.state).toBe("done");
    });

    it("reports a refused permission and a missing camera", async () => {
        getUserMedia.mockRejectedValue(Object.assign(new Error("no"), { name: "NotAllowedError" }));
        const rec = new RoundVideoRecorder(deps);
        await expect(rec.start()).rejects.toMatchObject({ code: "permission" });
        expect(rec.state).toBe("cancelled");

        getUserMedia.mockRejectedValue(Object.assign(new Error("no"), { name: "NotFoundError" }));
        await expect(new RoundVideoRecorder(deps).start()).rejects.toMatchObject({ code: "no_camera" });
    });

    it("reports a browser without a recorder", async () => {
        supported = [];
        const rec = new RoundVideoRecorder(deps);
        await expect(rec.start()).rejects.toBeInstanceOf(RoundVideoError);
        expect(getUserMedia).not.toHaveBeenCalled();
    });
});

describe("round video helpers", () => {
    it("classifies media errors", () => {
        expect(classifyMediaError({ name: "SecurityError" })).toBe("permission");
        expect(classifyMediaError({ name: "OverconstrainedError" })).toBe("no_camera");
        expect(classifyMediaError({ name: "NotReadableError" })).toBe("no_camera");
        expect(classifyMediaError(new Error("x"))).toBe("failed");
    });

    it("picks the best supported mimetype", () => {
        expect(pickRoundVideoMimeType(() => false)).toBeUndefined();
        expect(pickRoundVideoMimeType((t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9,opus");
        expect(
            pickRoundVideoMimeType(() => {
                throw new Error("old browser");
            }),
        ).toBeUndefined();
    });

    it("recognises a round video as the Lobby contract says: flag, square, at most 60 s", () => {
        const info = { w: 384, h: 384, duration: 7000 };
        const flag = "estate.inside.lobby.video_note";
        expect(isRoundVideoContent({ msgtype: "m.video", [flag]: true, info })).toBe(true);
        expect(isRoundVideoContent({ msgtype: "m.video", [flag]: true, info: { ...info, duration: 60000 } })).toBe(
            true,
        );
        expect(isRoundVideoContent({ msgtype: "m.video", info })).toBe(false);
        expect(isRoundVideoContent({ msgtype: "m.image", [flag]: true, info })).toBe(false);
        expect(isRoundVideoContent({ msgtype: "m.video", [flag]: "yes", info })).toBe(false);
        expect(isRoundVideoContent({ msgtype: "m.video", [flag]: true, info: { ...info, h: 400 } })).toBe(false);
        expect(isRoundVideoContent({ msgtype: "m.video", [flag]: true, info: { ...info, duration: 60001 } })).toBe(
            false,
        );
        expect(isRoundVideoContent({ msgtype: "m.video", [flag]: true, info: { w: 384, h: 384 } })).toBe(false);
        expect(isRoundVideoContent({ msgtype: "m.video", [flag]: true })).toBe(false);
    });

    it("sends a recording as video_note with the flag and the recorder's info, uncompressed", async () => {
        const sendContentToRoom = vi.fn().mockResolvedValue(undefined);
        const client = {} as MatrixClient;
        await sendRoundVideo(
            {
                blob: new Blob(["x"], { type: "video/mp4" }),
                mimeType: "video/mp4",
                durationMs: 5300,
                width: 384,
                height: 384,
            },
            "!room:server",
            undefined,
            client,
            undefined,
            { sendContentToRoom } as unknown as ContentMessages,
        );
        const [file, roomId, , , , , caption, options] = sendContentToRoom.mock.calls[0];
        expect(file.name).toBe("video_note.mp4");
        expect(file.type).toBe("video/mp4");
        expect(roomId).toBe("!room:server");
        expect(caption).toBeUndefined();
        expect(options).toEqual({
            compress: false,
            extraContent: { "estate.inside.lobby.video_note": true },
            info: { duration: 5300, w: 384, h: 384 },
        });
        expect(roundVideoFileName("video/webm")).toBe("video_note.webm");
    });

    it("formats durations", () => {
        expect(formatRoundDuration(7200)).toBe("0:07");
        expect(formatRoundDuration(60000)).toBe("1:00");
        expect(formatRoundDuration(-5)).toBe("0:00");
    });
});
