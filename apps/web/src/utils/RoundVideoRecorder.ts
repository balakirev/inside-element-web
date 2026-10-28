/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { logger } from "matrix-js-sdk/src/logger";

import {
    ROUND_VIDEO_AUDIO_BPS,
    ROUND_VIDEO_FPS,
    ROUND_VIDEO_MAX_MS,
    ROUND_VIDEO_MIN_MS,
    ROUND_VIDEO_SIDE,
    ROUND_VIDEO_VIDEO_BPS,
    baseMimeType,
    pickRoundVideoMimeType,
} from "./roundVideo";

/**
 * Inside: records a round video message. The front camera is drawn, cropped to its centre square
 * and mirrored as the user sees themselves, onto a {@link ROUND_VIDEO_SIDE} px canvas; the
 * canvas stream and the microphone go into a MediaRecorder (MP4 H.264/AAC where the browser can,
 * WebM otherwise), so the file is square and small and needs no compression afterwards.
 */

export type RoundVideoRecorderState = "idle" | "starting" | "recording" | "stopping" | "done" | "cancelled";

export type RoundVideoErrorCode = "permission" | "no_camera" | "unsupported" | "failed";

export class RoundVideoError extends Error {
    public constructor(
        public readonly code: RoundVideoErrorCode,
        cause?: unknown,
    ) {
        super(`Round video recording failed: ${code}`, { cause });
    }
}

export interface RoundVideoResult {
    blob: Blob;
    /** Without codecs, e.g. "video/mp4". */
    mimeType: string;
    durationMs: number;
    width: number;
    height: number;
}

/** The part of MediaRecorder that is used, so that tests can stand in for it. */
export interface RecorderLike {
    state: string;
    mimeType?: string;
    ondataavailable: ((ev: { data: Blob }) => void) | null;
    onstop: (() => void) | null;
    onerror: ((ev: unknown) => void) | null;
    start(timeslice?: number): void;
    stop(): void;
}

export interface RoundVideoRecorderDeps {
    getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
    isTypeSupported(type: string): boolean;
    createRecorder(stream: MediaStream, options: MediaRecorderOptions): RecorderLike;
    /** The camera picture drawn into the canvas; returns the stream of the canvas. */
    createCanvasStream(canvas: HTMLCanvasElement, fps: number): MediaStream;
    combineStreams(tracks: MediaStreamTrack[]): MediaStream;
    createCanvas(): HTMLCanvasElement;
    createVideo(): HTMLVideoElement;
    now(): number;
    requestFrame(cb: () => void): number;
    cancelFrame(id: number): void;
    setTimeout(cb: () => void, ms: number): number;
    clearTimeout(id: number): void;
}

function browserDeps(): RoundVideoRecorderDeps {
    return {
        getUserMedia: (constraints) => {
            if (!navigator.mediaDevices?.getUserMedia) throw new RoundVideoError("unsupported");
            return navigator.mediaDevices.getUserMedia(constraints);
        },
        isTypeSupported: (type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
        createRecorder: (stream, options) => new MediaRecorder(stream, options) as unknown as RecorderLike,
        createCanvasStream: (canvas, fps) => canvas.captureStream(fps),
        combineStreams: (tracks) => new MediaStream(tracks),
        createCanvas: () => document.createElement("canvas"),
        createVideo: () => document.createElement("video"),
        now: () => performance.now(),
        requestFrame: (cb) => window.requestAnimationFrame(cb),
        cancelFrame: (id) => window.cancelAnimationFrame(id),
        setTimeout: (cb, ms) => window.setTimeout(cb, ms),
        clearTimeout: (id) => window.clearTimeout(id),
    };
}

/** Sort a getUserMedia failure into what the user is told. */
export function classifyMediaError(e: unknown): RoundVideoErrorCode {
    if (e instanceof RoundVideoError) return e.code;
    const name = (e as { name?: string } | null)?.name;
    if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
        return "permission";
    }
    if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
        return "no_camera";
    }
    if (name === "NotReadableError" || name === "TrackStartError") return "no_camera";
    return "failed";
}

type Listener = () => void;

export class RoundVideoRecorder {
    public readonly canvas: HTMLCanvasElement;
    private stateValue: RoundVideoRecorderState = "idle";
    private stream: MediaStream | null = null;
    private video: HTMLVideoElement | null = null;
    private recorder: RecorderLike | null = null;
    private chunks: Blob[] = [];
    private mimeType = "video/webm";
    private startedAt = 0;
    private stoppedAt = 0;
    private frame: number | null = null;
    private maxTimer: number | null = null;
    private stopPromise: Promise<RoundVideoResult | null> | null = null;
    private listeners = new Set<Listener>();
    private lockedValue = false;
    /** Called when the recording reached {@link ROUND_VIDEO_MAX_MS} and stopped by itself. */
    public onMaxDuration: ((result: Promise<RoundVideoResult | null>) => void) | null = null;

    public constructor(private readonly deps: RoundVideoRecorderDeps = browserDeps()) {
        this.canvas = deps.createCanvas();
        this.canvas.width = ROUND_VIDEO_SIDE;
        this.canvas.height = ROUND_VIDEO_SIDE;
    }

    public get state(): RoundVideoRecorderState {
        return this.stateValue;
    }

    public get locked(): boolean {
        return this.lockedValue;
    }

    /** Time recorded so far, in ms. */
    public get elapsedMs(): number {
        if (this.stateValue === "recording") return Math.min(ROUND_VIDEO_MAX_MS, this.deps.now() - this.startedAt);
        if (this.startedAt && this.stoppedAt) return Math.min(ROUND_VIDEO_MAX_MS, this.stoppedAt - this.startedAt);
        return 0;
    }

    public on(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Ask for the camera and the microphone and start recording. Throws a {@link RoundVideoError}. */
    public async start(): Promise<void> {
        if (this.stateValue !== "idle") throw new Error(`Cannot start a recorder that is ${this.stateValue}`);
        this.setState("starting");
        const mimeType = pickRoundVideoMimeType((type) => this.deps.isTypeSupported(type));
        if (!mimeType) {
            this.setState("cancelled");
            throw new RoundVideoError("unsupported");
        }

        let stream: MediaStream;
        try {
            stream = await this.deps.getUserMedia({
                video: {
                    facingMode: "user",
                    width: { ideal: 720 },
                    height: { ideal: 720 },
                    frameRate: { ideal: ROUND_VIDEO_FPS },
                },
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
        } catch (e) {
            if (this.isStarting()) this.setState("cancelled");
            throw new RoundVideoError(classifyMediaError(e), e);
        }
        // Cancelled while the browser was asking: let the camera go at once.
        if (!this.isStarting()) {
            stream.getTracks().forEach((t) => t.stop());
            return;
        }
        this.stream = stream;

        try {
            const video = this.deps.createVideo();
            video.muted = true;
            video.playsInline = true;
            video.srcObject = stream;
            this.video = video;
            await video.play();
            if (!this.isStarting()) return;

            this.drawFrame();
            const canvasStream = this.deps.createCanvasStream(this.canvas, ROUND_VIDEO_FPS);
            const tracks = [...canvasStream.getVideoTracks(), ...stream.getAudioTracks()];
            const recorder = this.deps.createRecorder(this.deps.combineStreams(tracks), {
                mimeType,
                videoBitsPerSecond: ROUND_VIDEO_VIDEO_BPS,
                audioBitsPerSecond: ROUND_VIDEO_AUDIO_BPS,
            });
            this.mimeType = baseMimeType(recorder.mimeType || mimeType);
            recorder.ondataavailable = (ev): void => {
                if (ev.data?.size) this.chunks.push(ev.data);
            };
            recorder.onerror = (ev): void => logger.warn("Round video recorder error", ev);
            this.recorder = recorder;
            recorder.start(1000);
            this.startedAt = this.deps.now();
            this.maxTimer = this.deps.setTimeout(() => {
                this.maxTimer = null;
                const result = this.stop();
                this.onMaxDuration?.(result);
            }, ROUND_VIDEO_MAX_MS);
            this.setState("recording");
        } catch (e) {
            this.release();
            this.setState("cancelled");
            throw new RoundVideoError("failed", e);
        }
    }

    /** Recording goes on without holding the button. */
    public lock(): void {
        if (this.lockedValue) return;
        this.lockedValue = true;
        this.emit();
    }

    /**
     * Stop and hand over the file; null when it is shorter than {@link ROUND_VIDEO_MIN_MS} or the
     * recording never started.
     */
    public stop(): Promise<RoundVideoResult | null> {
        if (this.stopPromise) return this.stopPromise;
        if (this.stateValue !== "recording" || !this.recorder) {
            this.cancel();
            return Promise.resolve(null);
        }
        const recorder = this.recorder;
        this.stoppedAt = this.deps.now();
        this.setState("stopping");
        this.stopPromise = new Promise<RoundVideoResult | null>((resolve) => {
            recorder.onstop = (): void => {
                this.release();
                const durationMs = Math.min(ROUND_VIDEO_MAX_MS, Math.round(this.stoppedAt - this.startedAt));
                this.setState("done");
                if (durationMs < ROUND_VIDEO_MIN_MS || !this.chunks.length) {
                    resolve(null);
                    return;
                }
                resolve({
                    blob: new Blob(this.chunks, { type: this.mimeType }),
                    mimeType: this.mimeType,
                    durationMs,
                    width: ROUND_VIDEO_SIDE,
                    height: ROUND_VIDEO_SIDE,
                });
            };
            try {
                recorder.stop();
            } catch (e) {
                logger.warn("Unable to stop the round video recorder", e);
                recorder.onstop?.();
            }
        });
        return this.stopPromise;
    }

    /** Throw the recording away and let the camera go. */
    public cancel(): void {
        if (this.stateValue === "cancelled" || this.stateValue === "done") return;
        const recorder = this.recorder;
        if (recorder) {
            recorder.onstop = null;
            recorder.ondataavailable = null;
            if (recorder.state !== "inactive") {
                try {
                    recorder.stop();
                } catch {
                    // already stopped
                }
            }
        }
        this.chunks = [];
        this.release();
        this.setState("cancelled");
    }

    private drawFrame = (): void => {
        this.frame = null;
        const video = this.video;
        if (!video) return;
        const ctx = this.canvas.getContext("2d");
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (ctx && vw && vh) {
            const side = Math.min(vw, vh);
            const sx = (vw - side) / 2;
            const sy = (vh - side) / 2;
            ctx.save();
            // Mirrored, as the user sees themselves in the preview (Telegram does the same).
            ctx.translate(ROUND_VIDEO_SIDE, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(video, sx, sy, side, side, 0, 0, ROUND_VIDEO_SIDE, ROUND_VIDEO_SIDE);
            ctx.restore();
        }
        if (this.stateValue === "starting" || this.stateValue === "recording") {
            this.frame = this.deps.requestFrame(this.drawFrame);
        }
    };

    private release(): void {
        if (this.frame !== null) {
            this.deps.cancelFrame(this.frame);
            this.frame = null;
        }
        if (this.maxTimer !== null) {
            this.deps.clearTimeout(this.maxTimer);
            this.maxTimer = null;
        }
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = null;
        if (this.video) {
            this.video.pause();
            this.video.srcObject = null;
            this.video = null;
        }
    }

    /** Not narrowed by TypeScript: the state changes while start() awaits. */
    private isStarting(): boolean {
        return this.stateValue === "starting";
    }

    private setState(state: RoundVideoRecorderState): void {
        this.stateValue = state;
        this.emit();
    }

    private emit(): void {
        Array.from(this.listeners).forEach((listener) => listener());
    }
}
