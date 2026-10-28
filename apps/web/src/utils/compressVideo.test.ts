/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { compressVideoForUpload, isCompressibleVideo, videoTarget } from "./compressVideo";

const MB = 1024 * 1024;

// A stand-in for the parts of mediabunny the compression uses.
const fake = vi.hoisted(() => ({
    video: { displayWidth: 1920, displayHeight: 1080, canDecode: async (): Promise<boolean> => true } as any,
    audio: { codec: "aac", canDecode: async (): Promise<boolean> => true } as any,
    duration: 20,
    canEncodeVideo: true,
    canEncodeAudio: true,
    outputBytes: 13 * 1024 * 1024,
    valid: true,
    // What execute() does; resolves by default.
    execute: async (conversion: any): Promise<void> => {
        conversion.onProgress?.(0.5, 10);
        conversion.onProgress?.(1, 20);
    },
    conversions: [] as any[],
    outputs: [] as any[],
    disposed: 0,
}));

vi.mock("mediabunny", () => {
    class Quality {
        public constructor(public options: unknown) {}
    }
    class Input {
        public constructor(public options: unknown) {}
        public getPrimaryVideoTrack = async (): Promise<unknown> => fake.video;
        public getPrimaryAudioTrack = async (): Promise<unknown> => fake.audio;
        public computeDuration = async (): Promise<number> => fake.duration;
        public dispose = (): void => {
            fake.disposed++;
        };
    }
    class BufferTarget {
        public buffer: ArrayBuffer | null = null;
    }
    class Mp4OutputFormat {
        public constructor(public options: unknown) {}
    }
    class Output {
        public constructor(public options: { format: unknown; target: BufferTarget }) {
            fake.outputs.push(this);
        }
    }
    const Conversion = {
        init: async (options: any): Promise<unknown> => {
            const conversion: any = {
                options,
                isValid: fake.valid,
                cancelled: false,
                onProgress: undefined,
                cancel: vi.fn(async () => {
                    conversion.cancelled = true;
                    conversion.rejectExecute?.(new Error("Conversion has been canceled."));
                }),
                execute: async (): Promise<void> => {
                    await new Promise<void>((resolve, reject) => {
                        conversion.rejectExecute = reject;
                        fake.execute(conversion).then(resolve, reject);
                    });
                    options.output.options.target.buffer = new ArrayBuffer(fake.outputBytes);
                },
            };
            fake.conversions.push(conversion);
            return conversion;
        },
    };
    return {
        Quality,
        Input,
        BlobSource: class {
            public constructor(public blob: Blob) {}
        },
        BufferTarget,
        Mp4OutputFormat,
        Output,
        Conversion,
        MP4: "mp4",
        QTFF: "qtff",
        WEBM: "webm",
        MATROSKA: "mkv",
        canEncodeVideo: async (): Promise<boolean> => fake.canEncodeVideo,
        canEncodeAudio: async (): Promise<boolean> => fake.canEncodeAudio,
    };
});

function video(size: number, name = "clip.mov", type = "video/quicktime"): File {
    const file = new File(["x"], name, { type });
    Object.defineProperty(file, "size", { value: size });
    return file;
}

describe("videoTarget", () => {
    it("leaves a small video of up to 1080p as it is", () => {
        expect(videoTarget(1920, 1080, 15 * MB, 10)).toBeNull();
    });

    it("keeps 1080p at 5 Mbps for a video over 20 MB", () => {
        expect(videoTarget(1920, 1080, 40 * MB, 20)).toEqual({ width: 1920, height: 1080, bitrate: 5_000_000 });
    });

    it("brings a 4K video down to 1080p, portrait too", () => {
        expect(videoTarget(3840, 2160, 60 * MB, 20)).toEqual({ width: 1920, height: 1080, bitrate: 5_000_000 });
        expect(videoTarget(2160, 3840, 60 * MB, 20)).toEqual({ width: 1080, height: 1920, bitrate: 5_000_000 });
    });

    it("goes down to 720p at 4 Mbps over 100 MB", () => {
        expect(videoTarget(1920, 1080, 150 * MB, 60)).toEqual({ width: 1280, height: 720, bitrate: 4_000_000 });
    });

    it("compresses a small video above 1080p", () => {
        expect(videoTarget(3840, 2160, 10 * MB, 5)).toEqual({ width: 1920, height: 1080, bitrate: 5_000_000 });
    });

    it("keeps the original when the result would hardly be smaller", () => {
        // 5.1 Mbps for 60 s is 38 MB: no gain on a 40 MB file.
        expect(videoTarget(1920, 1080, 40 * MB, 60)).toBeNull();
    });

    it("keeps sizes even, as H.264 needs", () => {
        expect(videoTarget(1918, 1080, 40 * MB, 20)).toEqual({ width: 1918, height: 1080, bitrate: 5_000_000 });
        expect(videoTarget(3841, 2161, 40 * MB, 20)!.width % 2).toBe(0);
    });
});

describe("compressVideoForUpload", () => {
    beforeEach(() => {
        vi.stubGlobal("VideoEncoder", class {});
        vi.stubGlobal("VideoDecoder", class {});
        fake.video = { displayWidth: 1920, displayHeight: 1080, canDecode: async () => true };
        fake.audio = { codec: "aac", canDecode: async () => true };
        fake.duration = 20;
        fake.canEncodeVideo = true;
        fake.canEncodeAudio = true;
        fake.outputBytes = 13 * MB;
        fake.valid = true;
        fake.execute = async (conversion) => {
            conversion.onProgress?.(0.5, 10);
            conversion.onProgress?.(1, 20);
        };
        fake.conversions = [];
        fake.outputs = [];
        fake.disposed = 0;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("is not offered without WebCodecs", () => {
        vi.unstubAllGlobals();
        expect(isCompressibleVideo(video(40 * MB))).toBe(false);
    });

    it("transcodes a large video to H.264 in an MP4 with its index at the start", async () => {
        const progress: number[] = [];
        const result = await compressVideoForUpload(video(40 * MB), { onProgress: (p) => progress.push(p) });

        expect(result.name).toBe("clip.mp4");
        expect(result.type).toBe("video/mp4");
        expect(result.size).toBe(13 * MB);
        expect(progress).toEqual([0.5, 1]);
        const { options } = fake.conversions[0];
        expect(options.video).toEqual(
            expect.objectContaining({ codec: "avc", width: 1920, height: 1080, forceTranscode: true }),
        );
        expect(options.video.quality.options).toEqual({ bitrate: 5_000_000 });
        // AAC is copied as it is.
        expect(options.audio).toBeUndefined();
        // No tags: phones write where the video was taken.
        expect(options.tags).toEqual({});
        expect(fake.outputs[0].options.format.options).toEqual({ fastStart: "in-memory" });
        expect(fake.disposed).toBe(1);
    });

    it("re-encodes other audio to AAC", async () => {
        fake.audio = { codec: "opus", canDecode: async () => true };
        await compressVideoForUpload(video(40 * MB));
        expect(fake.conversions[0].options.audio).toEqual({ codec: "aac", quality: expect.anything() });
    });

    it("sends the original when the audio cannot become AAC", async () => {
        fake.audio = { codec: "opus", canDecode: async () => true };
        fake.canEncodeAudio = false;
        const file = video(40 * MB);
        expect(await compressVideoForUpload(file)).toBe(file);
    });

    it("sends the original when H.264 cannot be encoded", async () => {
        fake.canEncodeVideo = false;
        const file = video(40 * MB);
        expect(await compressVideoForUpload(file)).toBe(file);
        expect(fake.conversions).toHaveLength(0);
    });

    it("sends small videos and non-videos as they are", async () => {
        const small = video(10 * MB);
        expect(await compressVideoForUpload(small)).toBe(small);
        const doc = new File(["x"], "a.pdf", { type: "application/pdf" });
        expect(await compressVideoForUpload(doc)).toBe(doc);
        expect(fake.conversions).toHaveLength(0);
    });

    it("sends the original when the result is not smaller", async () => {
        fake.outputBytes = 41 * MB;
        const file = video(40 * MB);
        expect(await compressVideoForUpload(file)).toBe(file);
    });

    it("stops and sends the original when cancelled", async () => {
        fake.execute = () => new Promise(() => {});
        const controller = new AbortController();
        const file = video(40 * MB);
        const result = compressVideoForUpload(file, { signal: controller.signal });
        await vi.waitFor(() => expect(fake.conversions).toHaveLength(1));

        controller.abort();

        expect(await result).toBe(file);
        expect(fake.conversions[0].cancel).toHaveBeenCalled();
    });

    it("gives up past the time cap", async () => {
        fake.execute = async (conversion) => {
            // Keeps moving, but too slowly.
            for (let i = 1; !conversion.cancelled; i++) {
                conversion.onProgress?.(i / 1000, i);
                await new Promise((resolve) => setTimeout(resolve, 5));
            }
            await new Promise(() => {});
        };
        const file = video(40 * MB);
        expect(await compressVideoForUpload(file, { timeoutMs: 50 })).toBe(file);
        expect(fake.conversions[0].cancel).toHaveBeenCalled();
    });

    it("gives up when the encoder stands still", async () => {
        fake.execute = async (conversion) => {
            conversion.onProgress?.(0, 0);
            await new Promise(() => {});
        };
        const file = video(40 * MB);
        expect(await compressVideoForUpload(file, { stallMs: 30 })).toBe(file);
        expect(fake.conversions[0].cancel).toHaveBeenCalled();
    });
});
