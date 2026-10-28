/*
Copyright 2026 Element Creations Ltd.
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import "vitest-canvas-mock";
import {
    type ISendEventResponse,
    type MatrixClient,
    MatrixError,
    RelationType,
    THREAD_RELATION_TYPE,
    type UploadResponse,
} from "matrix-js-sdk/src/matrix";
import { type ImageInfo } from "matrix-js-sdk/src/types";
import encrypt, { type IEncryptedFile } from "matrix-encrypt-attachment";
import { createTestClient, flushPromises, mkEvent } from "test-utils";

import ContentMessages, { UploadCanceledError, uploadFile } from "./ContentMessages";
import { clearUploadedMediaCache, queryUploadedMediaCache } from "./utils/UploadedMediaCache";
import { doMaybeLocalRoomAction } from "./utils/local-room";
import { BlurhashEncoder } from "./BlurhashEncoder";
import Modal from "./Modal";
import ErrorDialog from "./components/views/dialogs/ErrorDialog";
import UploadConfirmDialog from "./components/views/dialogs/UploadConfirmDialog";
import { _t } from "./languageHandler";
import { PosthogAnalytics } from "./PosthogAnalytics";
import * as pdfThumbnail from "./utils/pdfThumbnail";
import dispatcher from "./dispatcher/dispatcher";
import { Action } from "./dispatcher/actions";
import { type UploadFinishedPayload } from "./dispatcher/payloads/UploadPayload";
import { compressPhotoForUpload } from "./utils/compressPhoto";
import { compressVideoForUpload, isCompressibleVideo } from "./utils/compressVideo";
import { createMediaUri, serverSupportsAsyncUploads, uploadToMediaUri } from "./utils/asyncMediaUpload";
import SettingsStore from "./settings/SettingsStore";

vi.mock("matrix-encrypt-attachment", () => ({ default: { encryptAttachment: vi.fn().mockResolvedValue({}) } }));

vi.mock("./BlurhashEncoder", () => ({
    BlurhashEncoder: {
        instance: {
            getBlurhash: vi.fn(),
        },
    },
}));

vi.mock("./utils/local-room", () => ({
    doMaybeLocalRoomAction: vi.fn(),
}));

// Inside: photos go out as they are unless a test makes them smaller.
vi.mock("./utils/compressPhoto", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./utils/compressPhoto")>()),
    compressPhotoForUpload: vi.fn(async (file: File) => file),
}));
// Inside: the classic upload unless a test lets the server take asynchronous ones.
vi.mock("./utils/asyncMediaUpload", () => ({
    serverSupportsAsyncUploads: vi.fn(async () => false),
    createMediaUri: vi.fn(),
    uploadToMediaUri: vi.fn(),
}));
vi.mock("./utils/compressVideo", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./utils/compressVideo")>()),
    isCompressibleVideo: vi.fn(() => false),
    compressVideoForUpload: vi.fn(async (file: File) => file),
}));

const createElement = document.createElement.bind(document);

vi.stubGlobal("OffscreenCanvas", undefined);

describe("ContentMessages", () => {
    const stickerUrl = "https://example.com/sticker";
    const roomId = "!room:example.com";
    const imageInfo = {} as unknown as ImageInfo;
    const text = "test sticker";
    let client: MatrixClient;
    let contentMessages: ContentMessages;
    let prom: Promise<ISendEventResponse>;

    beforeEach(() => {
        client = createTestClient();
        contentMessages = new ContentMessages();
        prom = Promise.resolve<ISendEventResponse>({ event_id: "$event_id" });
    });

    describe("sendStickerContentToRoom", () => {
        beforeEach(() => {
            vi.mocked(client.sendStickerMessage).mockReturnValue(prom);
            vi.mocked(doMaybeLocalRoomAction).mockImplementation(
                <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>, client?: MatrixClient) => {
                    return fn(roomId);
                },
            );
        });

        it("should forward the call to doMaybeLocalRoomAction", async () => {
            await contentMessages.sendStickerContentToRoom(stickerUrl, roomId, null, imageInfo, text, client);
            expect(client.sendStickerMessage).toHaveBeenCalledWith(roomId, null, stickerUrl, imageInfo, text);
        });
    });

    describe("sendContentToRoom", () => {
        const roomId = "!roomId:server";
        beforeEach(() => {
            Object.defineProperty(global.Image.prototype, "src", {
                // Define the property setter
                configurable: true,
                set(src) {
                    window.setTimeout(() => this.onload());
                },
            });
            Object.defineProperty(global.Image.prototype, "height", {
                configurable: true,
                get() {
                    return 600;
                },
            });
            Object.defineProperty(global.Image.prototype, "width", {
                configurable: true,
                get() {
                    return 800;
                },
            });
            vi.mocked(doMaybeLocalRoomAction).mockImplementation(
                <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>) => fn(roomId),
            );
            vi.mocked(BlurhashEncoder.instance.getBlurhash).mockResolvedValue("blurhashstring");
        });

        it("should use m.image for image files", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "image/jpeg" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.image",
                }),
            );
        });

        it("should send a caption in body and move the file name to filename", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "photo.jpg", { type: "image/jpeg" });
            await contentMessages.sendContentToRoom(
                file,
                roomId,
                undefined,
                client,
                undefined,
                undefined,
                "  Look at this view  ",
            );
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    body: "Look at this view",
                    filename: "photo.jpg",
                    msgtype: "m.image",
                }),
            );
        });

        it("should keep the file name in body when the caption is blank", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "photo.jpg", { type: "image/jpeg" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined, undefined, "   ");
            const content = vi.mocked(client.sendMessage).mock.calls[0][2] as unknown as Record<string, unknown>;
            expect(content.body).toBe("photo.jpg");
            expect(content.filename).toBeUndefined();
        });

        it("should use m.image for PNG files which cannot be parsed but successfully thumbnail", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "image/png" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.image",
                }),
            );
        });

        it("should fall back to m.file for invalid image files", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "image/jpeg" });
            vi.mocked(BlurhashEncoder.instance.getBlurhash).mockRejectedValue("NOT_AN_IMAGE");
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.file",
                }),
            );
        });

        it("should use m.video for video files", async () => {
            vi.spyOn(document, "createElement").mockImplementation((tagName) => {
                const element = createElement(tagName);
                if (tagName === "video") {
                    (<HTMLVideoElement>element).load = vi.fn();
                    (<HTMLVideoElement>element).play = () => element.onloadeddata!(new Event("loadeddata"));
                    (<HTMLVideoElement>element).pause = vi.fn();
                    Object.defineProperty(element, "videoHeight", {
                        get() {
                            return 600;
                        },
                    });
                    Object.defineProperty(element, "videoWidth", {
                        get() {
                            return 800;
                        },
                    });
                    Object.defineProperty(element, "duration", {
                        get() {
                            return 123;
                        },
                    });
                }
                return element;
            });

            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "video/mp4" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.video",
                    info: expect.objectContaining({
                        duration: 123000,
                    }),
                }),
            );
        });

        it("should use m.audio for audio files", async () => {
            vi.spyOn(document, "createElement").mockImplementation((tagName) => {
                const element = createElement(tagName);
                if (tagName === "audio") {
                    Object.defineProperty(element, "duration", {
                        get() {
                            return 621;
                        },
                    });
                    Object.defineProperty(element, "src", {
                        set() {
                            element.onloadedmetadata!(new Event("loadedmetadata"));
                        },
                    });
                }
                return element;
            });

            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "audio/mp3" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.audio",
                    info: expect.objectContaining({
                        duration: 621000,
                    }),
                }),
            );
        });

        it("should fall back to m.file for invalid audio files", async () => {
            vi.spyOn(document, "createElement").mockImplementation((tagName) => {
                const element = createElement(tagName);
                if (tagName === "audio") {
                    Object.defineProperty(element, "src", {
                        set() {
                            element.onerror!("fail");
                        },
                    });
                }
                return element;
            });
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "audio/mp3" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.file",
                }),
            );
        });

        it("should default to name 'Attachment' if file doesn't have a name", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "", { type: "text/plain" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.file",
                    body: "Attachment",
                }),
            );
        });

        it("should keep RoomUpload's total and loaded values up to date", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "", { type: "text/plain" });
            const prom = contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            const [upload] = contentMessages.getCurrentUploads();

            expect(upload.loaded).toBe(0);
            expect(upload.total).toBe(file.size);
            await flushPromises();
            const { progressHandler } = vi.mocked(client.uploadContent).mock.calls[0][1]!;
            progressHandler!({ loaded: 123, total: 1234 });
            expect(upload.loaded).toBe(123);
            expect(upload.total).toBe(1234);
            await prom;
        });

        it("properly handles replies", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "image/jpeg" });
            const replyToEvent = mkEvent({
                type: "m.room.message",
                user: "@bob:test",
                room: roomId,
                content: {},
                event: true,
            });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, replyToEvent);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    "url": "mxc://server/file",
                    "msgtype": "m.image",
                    "m.mentions": {
                        user_ids: ["@bob:test"],
                    },
                }),
            );
        });

        it("handles 413 error", async () => {
            vi.mocked(client.uploadContent).mockRejectedValue(
                new MatrixError(
                    {
                        errcode: "M_TOO_LARGE",
                        error: "File size limit exceeded",
                    },
                    413,
                ),
            );
            const file = new File([], "fileName", { type: "image/jpeg" });
            const dialogSpy = vi.spyOn(Modal, "createDialog");
            // Inside: a failure in a thread is still reported in a dialog; the main timeline shows it in place.
            const relation = { rel_type: THREAD_RELATION_TYPE.name, event_id: "$thread" };
            await contentMessages.sendContentToRoom(file, roomId, relation, client, undefined);
            expect(dialogSpy).toHaveBeenCalledWith(
                ErrorDialog,
                expect.objectContaining({
                    description: _t("upload_failed_size", { fileName: "fileName" }),
                }),
            );
            dialogSpy.mockRestore();
        });

        describe("Inside: pending uploads in the main timeline", () => {
            it("keeps the file, the caption and the content URI on the upload", async () => {
                vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
                const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
                const dispatchSpy = vi.spyOn(dispatcher, "dispatch");

                await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined, undefined, " Hi ");

                const finished = dispatchSpy.mock.calls.find(([payload]) => payload.action === Action.UploadFinished);
                const upload = (finished![0] as UploadFinishedPayload).upload;
                expect(upload.file).toBe(file);
                expect(upload.caption).toBe("Hi");
                expect(upload.contentUri).toBe("mxc://server/file");
                dispatchSpy.mockRestore();
            });

            it("shows a failure in place, without a dialog, and can retry it", async () => {
                vi.mocked(client.uploadContent).mockRejectedValueOnce(new Error("network"));
                const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
                const dialogSpy = vi.spyOn(Modal, "createDialog");

                await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined, undefined, "Hi");

                expect(dialogSpy).not.toHaveBeenCalledWith(ErrorDialog, expect.anything());
                const [failed] = contentMessages.getFailedUploads(roomId);
                expect(failed.failed).toBe(true);
                expect(failed.failureReason).toBe(_t("upload_failed_generic", { fileName: "doc.pdf" }));
                expect(contentMessages.getFailedUploads("!other:server")).toEqual([]);

                vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
                await contentMessages.retryUpload(failed);

                expect(contentMessages.getFailedUploads(roomId)).toEqual([]);
                expect(client.sendMessage).toHaveBeenCalledWith(
                    roomId,
                    null,
                    expect.objectContaining({ body: "Hi", filename: "doc.pdf", url: "mxc://server/file" }),
                );
                dialogSpy.mockRestore();
            });

            it("leaves a failed send after the upload to the unsent event", async () => {
                vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
                vi.mocked(client.sendMessage).mockRejectedValueOnce(new Error("network"));
                const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
                const dialogSpy = vi.spyOn(Modal, "createDialog");
                const dispatchSpy = vi.spyOn(dispatcher, "dispatch");

                await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);

                expect(dialogSpy).not.toHaveBeenCalledWith(ErrorDialog, expect.anything());
                expect(contentMessages.getFailedUploads(roomId)).toEqual([]);
                expect(contentMessages.getCurrentUploads()).toEqual([]);
                expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ action: Action.UploadFailed }));
                dialogSpy.mockRestore();
                dispatchSpy.mockRestore();
            });

            it("counts the thumbnail upload into the progress", async () => {
                vi.mocked(client.uploadContent).mockImplementation(async (_body, opts) => {
                    opts?.progressHandler?.({ loaded: 50, total: 100 });
                    return { content_uri: "mxc://server/file" };
                });
                const progress: Array<[number, number]> = [];
                const dispatchSpy = vi.spyOn(dispatcher, "dispatch").mockImplementation((payload) => {
                    const { upload } = payload as UploadFinishedPayload;
                    // Inside: the compressing phase dispatches progress too, before any bytes go out.
                    if (payload.action === Action.UploadProgress && !upload.compressing && upload.total > 0) {
                        progress.push([upload.loaded, upload.total]);
                    }
                });
                vi.mocked(BlurhashEncoder.instance.getBlurhash).mockResolvedValue("blurhashstring");
                // A WebP always gets a thumbnail, whatever its size.
                const file = new File([], "photo.webp", { type: "image/webp" });

                await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);

                // The file and the thumbnail, together.
                expect(client.uploadContent).toHaveBeenCalledTimes(2);
                expect(progress).toEqual([
                    [50, 100],
                    [100, 200],
                ]);
                dispatchSpy.mockRestore();
            });

            it("uploads the thumbnail next to the file rather than before it", async () => {
                const pending: Array<PromiseWithResolvers<UploadResponse>> = [];
                const bodies: unknown[] = [];
                vi.mocked(client.uploadContent).mockImplementation((body) => {
                    bodies.push(body);
                    const deferred = Promise.withResolvers<UploadResponse>();
                    pending.push(deferred);
                    return deferred.promise;
                });
                const file = new File([], "photo.webp", { type: "image/webp" });

                const sent = contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
                await vi.waitFor(() => expect(pending).toHaveLength(2));

                // The file went first, the thumbnail while it is still going.
                expect(bodies[0]).toBe(file);
                expect(bodies[1]).toBeInstanceOf(Blob);
                pending[1].resolve({ content_uri: "mxc://server/thumb" });
                pending[0].resolve({ content_uri: "mxc://server/file" });
                await sent;
                expect(client.sendMessage).toHaveBeenCalledWith(
                    roomId,
                    null,
                    expect.objectContaining({
                        url: "mxc://server/file",
                        info: expect.objectContaining({ thumbnail_url: "mxc://server/thumb" }),
                    }),
                );
            });

            it("sends a photo without its thumbnail when only the thumbnail fails", async () => {
                vi.mocked(client.uploadContent).mockImplementation(async (body) => {
                    if (body instanceof File) return { content_uri: "mxc://server/file" };
                    throw new Error("network");
                });
                const file = new File([], "photo.webp", { type: "image/webp" });

                await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);

                const content = vi.mocked(client.sendMessage).mock.calls.at(-1)![2] as unknown as {
                    msgtype: string;
                    info: Record<string, unknown>;
                };
                expect(content.msgtype).toBe("m.image");
                expect(content.info.thumbnail_url).toBeUndefined();
                expect(content.info.thumbnail_info).toBeUndefined();
                expect(content.info["xyz.amorgan.blurhash"]).toBe("blurhashstring");
            });

            it("sends the first page of a PDF as its thumbnail", async () => {
                const thumbnail = { blob: new Blob(["jpeg"], { type: "image/jpeg" }), width: 226, height: 320 };
                const spy = vi.spyOn(pdfThumbnail, "pdfThumbnailForFile").mockResolvedValue(thumbnail);
                vi.mocked(client.uploadContent).mockImplementation(async (body) => ({
                    content_uri: body === thumbnail.blob ? "mxc://server/thumb" : "mxc://server/file",
                }));
                const file = new File(["%PDF-1.7"], "spec.pdf", { type: "application/pdf" });

                await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);

                expect(spy).toHaveBeenCalledWith(file);
                expect(client.sendMessage).toHaveBeenCalledWith(
                    roomId,
                    null,
                    expect.objectContaining({
                        msgtype: "m.file",
                        url: "mxc://server/file",
                        info: expect.objectContaining({
                            mimetype: "application/pdf",
                            thumbnail_url: "mxc://server/thumb",
                            thumbnail_info: { w: 226, h: 320, mimetype: "image/jpeg", size: 4 },
                        }),
                    }),
                );
                spy.mockRestore();
            });

            it("sends a PDF without a thumbnail when its page cannot be drawn or uploaded", async () => {
                const thumbnail = { blob: new Blob(["jpeg"], { type: "image/jpeg" }), width: 226, height: 320 };
                const spy = vi.spyOn(pdfThumbnail, "pdfThumbnailForFile").mockResolvedValue(thumbnail);
                vi.mocked(client.uploadContent).mockImplementation(async (body) => {
                    if (body === thumbnail.blob) throw new Error("network");
                    return { content_uri: "mxc://server/file" };
                });
                const file = new File(["%PDF-1.7"], "spec.pdf", { type: "application/pdf" });

                await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);

                const content = vi.mocked(client.sendMessage).mock.calls.at(-1)![2] as unknown as {
                    info: Record<string, unknown>;
                };
                expect(content.info.thumbnail_url).toBeUndefined();
                expect(content.info.thumbnail_info).toBeUndefined();
                expect(contentMessages.getFailedUploads(roomId)).toEqual([]);
                spy.mockRestore();
            });

            it("sends a compressed photo with its own name, size and type", async () => {
                const compressed = new File([new Uint8Array(1000)], "IMG_1.jpg", { type: "image/jpeg" });
                vi.mocked(compressPhotoForUpload).mockResolvedValueOnce(compressed);
                vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
                const original = new File([new Uint8Array(5000)], "IMG_1.HEIC", { type: "image/heic" });
                const dispatchSpy = vi.spyOn(dispatcher, "dispatch");

                await contentMessages.sendContentToRoom(original, roomId, undefined, client, undefined);

                expect(compressPhotoForUpload).toHaveBeenCalledWith(original);
                expect(client.uploadContent).toHaveBeenCalledWith(compressed, expect.anything());
                expect(client.sendMessage).toHaveBeenCalledWith(
                    roomId,
                    null,
                    expect.objectContaining({
                        body: "IMG_1.jpg",
                        msgtype: "m.image",
                        info: expect.objectContaining({ size: 1000, mimetype: "image/jpeg", w: 800, h: 600 }),
                    }),
                );
                const finished = dispatchSpy.mock.calls.find(([payload]) => payload.action === Action.UploadFinished);
                expect((finished![0] as UploadFinishedPayload).upload.file).toBe(compressed);
                dispatchSpy.mockRestore();
            });

            it("says it is compressing while the photo is made smaller", async () => {
                const { promise, resolve } = Promise.withResolvers<File>();
                vi.mocked(compressPhotoForUpload).mockReturnValueOnce(promise);
                vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
                const original = new File([new Uint8Array(5000)], "IMG_1.jpg", { type: "image/jpeg" });

                const sent = contentMessages.sendContentToRoom(original, roomId, undefined, client, undefined);
                await flushPromises();
                const [upload] = contentMessages.getCurrentUploads();
                expect(upload.compressing).toBe(true);
                expect(client.uploadContent).not.toHaveBeenCalled();

                resolve(original);
                await sent;
                expect(upload.compressing).toBe(false);
            });

            it("sends the original with compression off, from the dialog or the device setting", async () => {
                vi.mocked(compressPhotoForUpload).mockClear();
                vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
                const original = new File([new Uint8Array(5000)], "IMG_1.jpg", { type: "image/jpeg" });

                await contentMessages.sendContentToRoom(
                    original,
                    roomId,
                    undefined,
                    client,
                    undefined,
                    undefined,
                    undefined,
                    { compress: false },
                );
                expect(compressPhotoForUpload).not.toHaveBeenCalled();

                const settingSpy = vi
                    .spyOn(SettingsStore, "getValue")
                    .mockImplementation((name) => name === "Inside.uploadOriginals");
                await contentMessages.sendContentToRoom(original, roomId, undefined, client, undefined);
                expect(compressPhotoForUpload).not.toHaveBeenCalled();
                expect(client.uploadContent).toHaveBeenCalledWith(original, expect.anything());
                settingSpy.mockRestore();
            });

            it("compresses a video first, following its progress, and sends the result", async () => {
                const compressed = new File([new Uint8Array(3000)], "clip.mp4", { type: "video/mp4" });
                let seen: Array<[boolean, number | undefined]> = [];
                vi.mocked(isCompressibleVideo).mockReturnValueOnce(true);
                vi.mocked(compressVideoForUpload).mockImplementationOnce(async (_file, options) => {
                    const [upload] = contentMessages.getCurrentUploads();
                    options!.onProgress!(0.4);
                    seen.push([upload.compressing, upload.compressionProgress]);
                    expect(options!.signal).toBe(upload.abortController.signal);
                    return compressed;
                });
                vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
                vi.spyOn(document, "createElement").mockImplementation((tagName) => {
                    const element = createElement(tagName);
                    if (tagName === "video") {
                        (<HTMLVideoElement>element).load = vi.fn();
                        (<HTMLVideoElement>element).play = () => element.onloadeddata!(new Event("loadeddata"));
                        (<HTMLVideoElement>element).pause = vi.fn();
                        Object.defineProperty(element, "videoWidth", { get: () => 1280 });
                        Object.defineProperty(element, "videoHeight", { get: () => 720 });
                        Object.defineProperty(element, "duration", { get: () => 20 });
                    }
                    return element;
                });
                const original = new File([new Uint8Array(9000)], "clip.mov", { type: "video/quicktime" });

                await contentMessages.sendContentToRoom(original, roomId, undefined, client, undefined);

                expect(seen).toEqual([[true, 0.4]]);
                expect(client.uploadContent).toHaveBeenCalledWith(compressed, expect.anything());
                expect(client.sendMessage).toHaveBeenCalledWith(
                    roomId,
                    null,
                    expect.objectContaining({
                        body: "clip.mp4",
                        msgtype: "m.video",
                        info: expect.objectContaining({ size: 3000, mimetype: "video/mp4", w: 1280, h: 720 }),
                    }),
                );
                seen = [];
            });

            it("sends nothing when cancelled while the video is compressed", async () => {
                vi.mocked(isCompressibleVideo).mockReturnValueOnce(true);
                vi.mocked(compressVideoForUpload).mockImplementationOnce(async (file) => {
                    contentMessages.cancelUpload(contentMessages.getCurrentUploads()[0]);
                    return file;
                });
                const original = new File([new Uint8Array(9000)], "clip.mov", { type: "video/quicktime" });

                await contentMessages.sendContentToRoom(original, roomId, undefined, client, undefined);

                expect(client.uploadContent).not.toHaveBeenCalled();
                expect(client.sendMessage).not.toHaveBeenCalled();
                expect(contentMessages.getFailedUploads(roomId)).toEqual([]);
            });

            it("forgets a failed upload on delete", async () => {
                vi.mocked(client.uploadContent).mockRejectedValueOnce(new Error("network"));
                const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
                await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
                const [failed] = contentMessages.getFailedUploads(roomId);
                const dispatchSpy = vi.spyOn(dispatcher, "dispatch");

                contentMessages.dismissFailedUpload(failed);

                expect(contentMessages.getFailedUploads(roomId)).toEqual([]);
                expect(dispatchSpy).toHaveBeenCalledWith({ action: Action.UploadCanceled, upload: failed });
                dispatchSpy.mockRestore();
            });
        });
    });

    describe("Inside: asynchronous upload (MSC2246)", () => {
        const roomId = "!roomId:server";
        let put: PromiseWithResolvers<void>;

        beforeEach(() => {
            vi.mocked(doMaybeLocalRoomAction).mockImplementation(
                <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>) => fn(roomId),
            );
            vi.mocked(BlurhashEncoder.instance.getBlurhash).mockResolvedValue("blurhashstring");
            Object.defineProperty(global.Image.prototype, "src", {
                configurable: true,
                set() {
                    window.setTimeout(() => this.onload());
                },
            });
            Object.defineProperty(global.Image.prototype, "height", { configurable: true, get: () => 600 });
            Object.defineProperty(global.Image.prototype, "width", { configurable: true, get: () => 800 });
            vi.mocked(serverSupportsAsyncUploads).mockResolvedValue(true);
            vi.mocked(createMediaUri).mockResolvedValue({ contentUri: "mxc://server/reserved" });
            put = Promise.withResolvers<void>();
            vi.mocked(uploadToMediaUri).mockReset().mockReturnValue(put.promise);
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/thumb" });
            vi.mocked(client.sendMessage).mockResolvedValue({ event_id: "$sent" });
            vi.mocked(client.redactEvent).mockResolvedValue({ event_id: "$redaction" });
        });

        afterEach(() => {
            vi.mocked(serverSupportsAsyncUploads).mockResolvedValue(false);
        });

        // Only files of 2 MB and more go up after their event.
        function big(file: File): File {
            Object.defineProperty(file, "size", { value: 3 * 1024 * 1024 });
            return file;
        }

        function mediaEvent(url: string): ReturnType<typeof mkEvent> {
            return mkEvent({
                type: "m.room.message",
                user: client.getSafeUserId(),
                room: roomId,
                content: { msgtype: "m.image", body: "photo.webp", url },
                event: true,
            });
        }

        it("sends the event with thumbnail and blurhash before the file, then puts the file", async () => {
            const file = big(new File([new Uint8Array(100)], "photo.webp", { type: "image/webp" }));
            const dispatchSpy = vi.spyOn(dispatcher, "dispatch");

            const sent = contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            await vi.waitFor(() => expect(client.sendMessage).toHaveBeenCalled());

            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/reserved",
                    info: expect.objectContaining({
                        "thumbnail_url": "mxc://server/thumb",
                        "xyz.amorgan.blurhash": "blurhashstring",
                        "w": 800,
                        "h": 600,
                        "size": 3 * 1024 * 1024,
                    }),
                }),
            );
            // Only the thumbnail went the classic way; the file goes to the reserved URI.
            expect(client.uploadContent).toHaveBeenCalledTimes(1);
            expect(uploadToMediaUri).toHaveBeenCalledWith(
                client,
                "mxc://server/reserved",
                file,
                expect.objectContaining({ name: "photo.webp" }),
            );
            // The sender's own tile has the bytes, and the timeline shows the bubble in its place.
            expect(queryUploadedMediaCache("mxc://server/reserved")).toBe(file);
            const [upload] = contentMessages.getCurrentUploads();
            expect(upload.awaitingMedia).toBe(true);
            expect(contentMessages.isMediaPendingFor(mediaEvent("mxc://server/reserved"))).toBe(true);
            expect(contentMessages.isMediaPendingFor(mediaEvent("mxc://server/other"))).toBe(false);
            expect(dispatchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ action: Action.UploadFinished }));

            put.resolve();
            await sent;

            expect(upload.awaitingMedia).toBe(false);
            expect(contentMessages.isMediaPendingFor(mediaEvent("mxc://server/reserved"))).toBe(false);
            expect(dispatchSpy).toHaveBeenCalledWith({ action: Action.UploadFinished, upload });
            expect(contentMessages.getCurrentUploads()).toEqual([]);
            dispatchSpy.mockRestore();
        });

        it("sends small files the classic way", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            await contentMessages.sendContentToRoom(
                new File(["x"], "doc.pdf", { type: "application/pdf" }),
                roomId,
                undefined,
                client,
                undefined,
            );
            expect(createMediaUri).not.toHaveBeenCalled();
            expect(uploadToMediaUri).not.toHaveBeenCalled();
        });

        it("goes the classic way when the server cannot reserve a URI", async () => {
            vi.mocked(createMediaUri).mockRejectedValue(new MatrixError({ errcode: "M_LIMIT_EXCEEDED" }, 429));
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = big(new File(["x"], "doc.pdf", { type: "application/pdf" }));

            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);

            expect(uploadToMediaUri).not.toHaveBeenCalled();
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({ url: "mxc://server/file" }),
            );
        });

        it("goes the classic way in encrypted rooms, without server support or with the setting off", async () => {
            vi.mocked(createMediaUri).mockClear();
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = big(new File(["x"], "doc.pdf", { type: "application/pdf" }));

            vi.mocked(serverSupportsAsyncUploads).mockResolvedValueOnce(false);
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);

            const settingSpy = vi
                .spyOn(SettingsStore, "getValue")
                .mockImplementation((name) => (name === "Inside.asyncMediaUpload" ? false : null));
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            settingSpy.mockRestore();

            vi.mocked(client.getCrypto()!.isEncryptionEnabledInRoom).mockResolvedValueOnce(true);
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);

            expect(createMediaUri).toHaveBeenCalledTimes(0);
            expect(uploadToMediaUri).not.toHaveBeenCalled();
            expect(client.sendMessage).toHaveBeenCalledTimes(3);
        });

        it("takes the event back when cancelled while the file goes up", async () => {
            vi.mocked(uploadToMediaUri).mockImplementation(
                (_client, _uri, _body, options) =>
                    new Promise((_resolve, reject) =>
                        options!.abortController!.signal.addEventListener("abort", () =>
                            reject(new DOMException("Aborted", "AbortError")),
                        ),
                    ),
            );
            const file = big(new File(["x"], "doc.pdf", { type: "application/pdf" }));
            const sent = contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            await vi.waitFor(() => expect(uploadToMediaUri).toHaveBeenCalled());

            contentMessages.cancelUpload(contentMessages.getCurrentUploads()[0]);
            await sent;

            expect(client.redactEvent).toHaveBeenCalledWith(roomId, "$sent");
            expect(queryUploadedMediaCache("mxc://server/reserved")).toBeUndefined();
            expect(contentMessages.getFailedUploads(roomId)).toEqual([]);
        });

        it("keeps a failed file upload as a bubble: retry puts it again, delete takes the event back", async () => {
            const file = big(new File(["x"], "doc.pdf", { type: "application/pdf" }));
            const sent = contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            await vi.waitFor(() => expect(uploadToMediaUri).toHaveBeenCalled());
            put.reject(new Error("network"));
            await sent;

            const [failed] = contentMessages.getFailedUploads(roomId);
            expect(failed.failed).toBe(true);
            // The event stays hidden behind the failed bubble.
            expect(contentMessages.isMediaPendingFor(mediaEvent("mxc://server/reserved"))).toBe(true);

            vi.mocked(uploadToMediaUri).mockResolvedValueOnce(undefined);
            await contentMessages.retryUpload(failed);
            expect(uploadToMediaUri).toHaveBeenCalledTimes(2);
            expect(vi.mocked(uploadToMediaUri).mock.calls[1][1]).toBe("mxc://server/reserved");
            // The event is not sent again.
            expect(client.sendMessage).toHaveBeenCalledTimes(1);
            expect(contentMessages.getFailedUploads(roomId)).toEqual([]);
            expect(contentMessages.isMediaPendingFor(mediaEvent("mxc://server/reserved"))).toBe(false);

            // Fails again, and this time the user deletes it.
            vi.mocked(uploadToMediaUri).mockReset().mockRejectedValue(new Error("network"));
            const second = contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            await second;
            const [again] = contentMessages.getFailedUploads(roomId);
            contentMessages.dismissFailedUpload(again);
            await vi.waitFor(() => expect(client.redactEvent).toHaveBeenCalledWith(roomId, "$sent"));
            expect(contentMessages.getFailedUploads(roomId)).toEqual([]);
        });

        it("sends the next file's event without waiting for this file to go up", async () => {
            vi.spyOn(Modal, "createDialog").mockImplementation((component: unknown) => {
                if (component === UploadConfirmDialog) return { finished: Promise.resolve([true, true]) } as any;
                return { finished: new Promise(() => {}), close: vi.fn() } as any;
            });
            vi.mocked(client.getMediaConfig).mockResolvedValue({});
            vi.mocked(createMediaUri)
                .mockResolvedValueOnce({ contentUri: "mxc://server/one" })
                .mockResolvedValueOnce({ contentUri: "mxc://server/two" });
            const files = [big(new File(["1"], "a.pdf", { type: "application/pdf" }))];
            files.push(big(new File(["2"], "b.pdf", { type: "application/pdf" })));

            await contentMessages.sendContentListToRoom(files, roomId, undefined, undefined, client);
            await vi.waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(2));

            const urls = vi.mocked(client.sendMessage).mock.calls.map((call) => (call[2] as { url?: string }).url);
            expect(urls).toEqual(["mxc://server/one", "mxc://server/two"]);
            put.resolve();
        });
    });

    describe("getCurrentUploads", () => {
        const file1 = new File([], "file1");
        const file2 = new File([], "file2");
        const roomId = "!roomId:server";

        beforeEach(() => {
            vi.mocked(doMaybeLocalRoomAction).mockImplementation(
                <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>) => fn(roomId),
            );
        });

        it("should return only uploads for the given relation", async () => {
            const relation = {
                rel_type: RelationType.Thread,
                event_id: "!threadId:server",
            };
            const p1 = contentMessages.sendContentToRoom(file1, roomId, relation, client, undefined);
            const p2 = contentMessages.sendContentToRoom(file2, roomId, undefined, client, undefined);

            const uploads = contentMessages.getCurrentUploads(relation);
            expect(uploads).toHaveLength(1);
            expect(uploads[0].relation).toEqual(relation);
            expect(uploads[0].fileName).toEqual("file1");
            await Promise.all([p1, p2]);
        });

        it("should return only uploads for no relation when not passed one", async () => {
            const relation = {
                rel_type: RelationType.Thread,
                event_id: "!threadId:server",
            };
            const p1 = contentMessages.sendContentToRoom(file1, roomId, relation, client, undefined);
            const p2 = contentMessages.sendContentToRoom(file2, roomId, undefined, client, undefined);

            const uploads = contentMessages.getCurrentUploads();
            expect(uploads).toHaveLength(1);
            expect(uploads[0].relation).toEqual(undefined);
            expect(uploads[0].fileName).toEqual("file2");
            await Promise.all([p1, p2]);
        });
    });

    describe("cancelUpload", () => {
        it("should cancel in-flight upload", async () => {
            const deferred = Promise.withResolvers<UploadResponse>();
            vi.mocked(client.uploadContent).mockReturnValue(deferred.promise);
            const file1 = new File([], "file1");
            const prom = contentMessages.sendContentToRoom(file1, roomId, undefined, client, undefined);
            await flushPromises();
            const { abortController } = vi.mocked(client.uploadContent).mock.calls[0][1]!;
            expect(abortController!.signal.aborted).toBeFalsy();
            const [upload] = contentMessages.getCurrentUploads();
            contentMessages.cancelUpload(upload);
            expect(abortController!.signal.aborted).toBeTruthy();
            deferred.resolve({} as UploadResponse);
            await prom;
        });
    });
});

describe("uploadFile", () => {
    let client: MatrixClient;

    beforeEach(() => {
        vi.clearAllMocks();
        client = createTestClient();
    });

    it("should not encrypt the file if the room isn't encrypted", async () => {
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
        const progressHandler = vi.fn();
        const file = new Blob([]);

        const res = await uploadFile(client, "!roomId:server", file, progressHandler);

        expect(res.url).toBe("mxc://server/file");
        expect(res.file).toBeFalsy();
        expect(encrypt.encryptAttachment).not.toHaveBeenCalled();
        expect(client.uploadContent).toHaveBeenCalledWith(file, expect.objectContaining({ progressHandler }));
    });

    it("should encrypt the file if the room is encrypted", async () => {
        vi.spyOn(client.getCrypto()!, "isEncryptionEnabledInRoom").mockResolvedValue(true);
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
        vi.mocked(encrypt.encryptAttachment).mockResolvedValue({
            data: new ArrayBuffer(123),
            info: {} as IEncryptedFile,
        });
        const progressHandler = vi.fn();
        const file = new Blob(["123"]);

        const res = await uploadFile(client, "!roomId:server", file, progressHandler);

        expect(res.url).toBeFalsy();
        expect(res.file).toEqual(
            expect.objectContaining({
                url: "mxc://server/file",
            }),
        );
        expect(encrypt.encryptAttachment).toHaveBeenCalled();
        expect(client.uploadContent).toHaveBeenCalledWith(
            expect.any(Blob),
            expect.objectContaining({
                progressHandler,
                includeFilename: false,
                type: "application/octet-stream",
            }),
        );
        expect(vi.mocked(client.uploadContent).mock.calls[0][0]).not.toBe(file);
    });

    it("should keep the uploaded file so it does not have to be downloaded again", async () => {
        clearUploadedMediaCache();
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/plain" });
        const file = new Blob(["hello"]);

        await uploadFile(client, "!roomId:server", file);

        expect(queryUploadedMediaCache("mxc://server/plain")).toBe(file);
    });

    it("should keep the plaintext of an encrypted upload rather than the ciphertext", async () => {
        clearUploadedMediaCache();
        vi.spyOn(client.getCrypto()!, "isEncryptionEnabledInRoom").mockResolvedValue(true);
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/encrypted" });
        vi.mocked(encrypt.encryptAttachment).mockResolvedValue({
            data: new ArrayBuffer(123),
            info: {} as IEncryptedFile,
        });
        const file = new Blob(["hello"]);

        await uploadFile(client, "!roomId:server", file);

        expect(queryUploadedMediaCache("mxc://server/encrypted")).toBe(file);
    });

    it("should throw UploadCanceledError upon aborting the upload", async () => {
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://foo/bar" });
        const file = new Blob([]);
        const controller = new AbortController();
        controller.abort();

        await expect(uploadFile(client, "!roomId:server", file, undefined, controller)).rejects.toThrow(
            UploadCanceledError,
        );
    });
});

describe("sendContentListToRoom analytics", () => {
    const roomId = "!roomId:server";
    let client: MatrixClient;
    let contentMessages: ContentMessages;
    let trackEvent: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        client = createTestClient();
        vi.mocked(client.getMediaConfig).mockResolvedValue({});
        vi.mocked(doMaybeLocalRoomAction).mockImplementation(
            <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>) => fn(roomId),
        );
        contentMessages = new ContentMessages();
        vi.spyOn(contentMessages, "sendContentToRoom").mockResolvedValue(undefined);
        trackEvent = vi.spyOn(PosthogAnalytics.instance, "trackEvent").mockImplementation(() => {});
        // Automatically continue through the per-file confirmation dialog.
        vi.spyOn(Modal, "createDialog").mockImplementation((component: unknown, ...rest: any[]) => {
            if (component === UploadConfirmDialog) {
                return { finished: Promise.resolve([true, false]) } as any;
            }
            // Any other dialog (e.g. the fetching-media-config spinner) never resolves on its own.
            return { finished: new Promise(() => {}), close: vi.fn() } as any;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function mkFile(type: string, name = "file"): File {
        return new File(["content"], name, { type });
    }

    it("tracks AttachmentSend with the most common file type when files are sent", async () => {
        const files = [mkFile("image/png", "a.png"), mkFile("image/jpeg", "b.jpg"), mkFile("video/mp4", "c.mp4")];
        await contentMessages.sendContentListToRoom(files, roomId, undefined, undefined, client);

        expect(trackEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                eventName: "AttachmentSend",
                count: 3,
                kind: "local",
                type: "image",
            }),
        );
    });

    it("marks the attachment as a reply and in-thread when applicable", async () => {
        const replyToEvent = { getId: () => "$event" } as any;
        const relation = { rel_type: "m.thread" } as any;
        await contentMessages.sendContentListToRoom([mkFile("text/plain")], roomId, relation, replyToEvent, client);

        expect(trackEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                eventName: "AttachmentSend",
                isReply: true,
                inThread: true,
            }),
        );
    });

    it("passes the caption from the confirmation dialog to the first file only", async () => {
        vi.spyOn(Modal, "createDialog").mockImplementation((component: unknown) => {
            if (component === UploadConfirmDialog) {
                return { finished: Promise.resolve([true, true, "Our new office"]) } as any;
            }
            return { finished: new Promise(() => {}), close: vi.fn() } as any;
        });
        const files = [mkFile("image/png", "a.png"), mkFile("image/png", "b.png")];
        await contentMessages.sendContentListToRoom(files, roomId, undefined, undefined, client);

        const calls = vi.mocked(contentMessages.sendContentToRoom).mock.calls;
        expect(calls[0][0].name).toBe("a.png");
        expect(calls[0][6]).toBe("Our new office");
        expect(calls[1][0].name).toBe("b.png");
        expect(calls[1][6]).toBeUndefined();
    });

    it("passes the dialog's no-compression choice on to all files sent with it", async () => {
        vi.spyOn(Modal, "createDialog").mockImplementation((component: unknown) => {
            if (component === UploadConfirmDialog) {
                return { finished: Promise.resolve([true, true, undefined, true]) } as any;
            }
            return { finished: new Promise(() => {}), close: vi.fn() } as any;
        });
        const files = [mkFile("image/jpeg", "a.jpg"), mkFile("image/jpeg", "b.jpg")];
        await contentMessages.sendContentListToRoom(files, roomId, undefined, undefined, client);

        const calls = vi.mocked(contentMessages.sendContentToRoom).mock.calls;
        expect(calls.map((call) => call[7]?.compress)).toEqual([false, false]);
    });

    it("compresses by default when the dialog does not ask", async () => {
        const files = [mkFile("text/plain", "a.txt")];
        await contentMessages.sendContentListToRoom(files, roomId, undefined, undefined, client);
        expect(vi.mocked(contentMessages.sendContentToRoom).mock.calls[0][7]?.compress).toBe(true);
    });

    it("tracks AttachmentCancel when the user cancels at the confirmation dialog", async () => {
        vi.spyOn(Modal, "createDialog").mockImplementation((component: unknown) => {
            if (component === UploadConfirmDialog) {
                return { finished: Promise.resolve([false, false]) } as any;
            }
            return { finished: new Promise(() => {}), close: vi.fn() } as any;
        });

        await contentMessages.sendContentListToRoom([mkFile("text/plain")], roomId, undefined, undefined, client);

        expect(trackEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                eventName: "AttachmentCancel",
                kind: "local",
                stage: "Confirmation",
            }),
        );
        expect(contentMessages.sendContentToRoom).not.toHaveBeenCalled();
    });
});
