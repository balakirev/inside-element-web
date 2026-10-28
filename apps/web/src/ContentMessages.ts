/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.
Copyright 2019 New Vector Ltd
Copyright 2015, 2016 OpenMarket Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    type MatrixClient,
    MsgType,
    HTTPError,
    type IEventRelation,
    type ISendEventResponse,
    type MatrixEvent,
    type UploadOpts,
    type UploadProgress,
    THREAD_RELATION_TYPE,
} from "matrix-js-sdk/src/matrix";
import {
    type ImageInfo,
    type FileInfo,
    type AudioInfo,
    type VideoInfo,
    type EncryptedFile,
    type MediaEventContent,
    type MediaEventInfo,
} from "matrix-js-sdk/src/types";
import encrypt from "matrix-encrypt-attachment";
import extractPngChunks from "png-chunks-extract";
import { logger } from "matrix-js-sdk/src/logger";
import { removeElement } from "matrix-js-sdk/src/utils";
import type { AttachmentSend } from "@matrix-org/analytics-events/types/typescript/AttachmentSend";
import type { AttachmentCancel } from "@matrix-org/analytics-events/types/typescript/AttachmentCancel";

import dis from "./dispatcher/dispatcher";
import { _t } from "./languageHandler";
import Modal from "./Modal";
import Spinner from "./components/views/elements/Spinner";
import { Action } from "./dispatcher/actions";
import {
    type UploadCanceledPayload,
    type UploadErrorPayload,
    type UploadFinishedPayload,
    type UploadProgressPayload,
    type UploadStartedPayload,
} from "./dispatcher/payloads/UploadPayload";
import { RoomUpload } from "./models/RoomUpload";
import SettingsStore from "./settings/SettingsStore";
import { decorateStartSendingTime, sendRoundTripMetric } from "./sendTimePerformanceMetrics";
import { TimelineRenderingType } from "./contexts/RoomContext";
import { addReplyToMessageContent } from "./utils/Reply";
import ErrorDialog from "./components/views/dialogs/ErrorDialog";
import UploadFailureDialog from "./components/views/dialogs/UploadFailureDialog";
import UploadConfirmDialog from "./components/views/dialogs/UploadConfirmDialog";
import { createThumbnail } from "./utils/image-media";
import { attachMentions, attachRelation } from "./utils/messages.ts";
import { doMaybeLocalRoomAction } from "./utils/local-room";
import { blobIsAnimated } from "./utils/Image.ts";
import { PosthogAnalytics } from "./PosthogAnalytics.ts";
import { cacheUploadedMedia, forgetUploadedMedia } from "./utils/UploadedMediaCache";
import { isPdfFile, pdfThumbnailForFile } from "./utils/pdfThumbnail";
import { isCompressiblePhoto } from "./utils/photoCompression";
import { compressPhotoForUpload } from "./utils/compressPhoto";
import { compressVideoForUpload, isCompressibleVideo } from "./utils/compressVideo";
import {
    type CreatedMedia,
    createMediaUri,
    serverSupportsAsyncUploads,
    uploadToMediaUri,
} from "./utils/asyncMediaUpload";

// scraped out of a macOS hidpi (5660ppm) screenshot png
//                  5669 px (x-axis)      , 5669 px (y-axis)      , per metre
const PHYS_HIDPI = [0x00, 0x00, 0x16, 0x25, 0x00, 0x00, 0x16, 0x25, 0x01];

export class UploadCanceledError extends Error {}
export class UploadFailedError extends Error {
    public constructor(cause: any) {
        super();
        this.cause = cause;
    }
}

interface IMediaConfig {
    "m.upload.size"?: number;
}

/** Inside: how one file is sent. */
export interface SendContentOptions {
    /** Whether a photo or a video may be compressed; by default as the device setting says. */
    compress?: boolean;
    /**
     * Called once the event of the file is sent (or sending it is over), so that the next file can
     * follow. With asynchronous uploads that is before the file itself is up.
     */
    onEventSent?: () => void;
}

type MediaContent = Omit<MediaEventContent, "info"> & { info: Partial<MediaEventInfo> };

function contentUriOf(event: MatrixEvent): string | undefined {
    const content = event.getContent();
    return content.url ?? content.file?.url;
}

/**
 * Load a file into a newly created image element.
 *
 * @param {File} imageFile The file to load in an image element.
 * @returns {Promise} A promise that resolves with the html image element.
 */
async function loadImageElement(imageFile: File): Promise<{
    width: number;
    height: number;
    img: HTMLImageElement;
}> {
    // Load the file into an html element
    const img = new Image();
    const objectUrl = URL.createObjectURL(imageFile);
    const imgPromise = new Promise((resolve, reject) => {
        img.onload = function (): void {
            URL.revokeObjectURL(objectUrl);
            resolve(img);
        };
        img.onerror = function (e): void {
            reject(e);
        };
    });
    img.src = objectUrl;

    // check for hi-dpi PNGs and fudge display resolution as needed.
    // this is mainly needed for macOS screencaps
    let parsePromise = Promise.resolve(false);
    if (imageFile.type === "image/png") {
        // in practice macOS happens to order the chunks so they fall in
        // the first 0x1000 bytes (thanks to a massive ICC header).
        // Thus we could slice the file down to only sniff the first 0x1000
        // bytes (but this makes extractPngChunks choke on the corrupt file)
        const headers = imageFile; //.slice(0, 0x1000);
        parsePromise = readFileAsArrayBuffer(headers)
            .then((arrayBuffer) => {
                const buffer = new Uint8Array(arrayBuffer);
                const chunks = extractPngChunks(buffer);
                for (const chunk of chunks) {
                    if (chunk.name === "pHYs") {
                        if (chunk.data.byteLength !== PHYS_HIDPI.length) return false;
                        return chunk.data.every((val, i) => val === PHYS_HIDPI[i]);
                    }
                }
                return false;
            })
            .catch((e) => {
                console.error("Failed to parse PNG", e);
                return false;
            });
    }

    const [hidpi] = await Promise.all([parsePromise, imgPromise]);
    const width = hidpi ? img.width >> 1 : img.width;
    const height = hidpi ? img.height >> 1 : img.height;
    return { width, height, img };
}

// Minimum size for image files before we generate a thumbnail for them.
const IMAGE_SIZE_THRESHOLD_THUMBNAIL = 1 << 15; // 32KB
// Minimum size improvement for image thumbnails, if both are not met then don't bother uploading thumbnail.
const IMAGE_THUMBNAIL_MIN_REDUCTION_SIZE = 1 << 16; // 1MB
const IMAGE_THUMBNAIL_MIN_REDUCTION_PERCENT = 0.1; // 10%
// We don't apply these thresholds to video thumbnails as a poster image is always useful
// and videos tend to be much larger.

// Inside: files smaller than this go the classic way even where asynchronous uploads are possible.
// Their upload takes about as long as reserving a URI and sending the thumbnail first, and
// receivers then get the event with its media ready rather than waiting for it.
const ASYNC_UPLOAD_MIN_BYTES = 2 * 1024 * 1024;

// Image mime types for which to always include a thumbnail for even if it is larger than the input for wider support.
const ALWAYS_INCLUDE_THUMBNAIL = ["image/avif", "image/webp", "image/svg+xml"];

/**
 * Inside: what the event says about a medium besides the file itself, and the thumbnail to upload
 * with it. Making it no longer uploads the thumbnail, so that it can go up next to the file.
 */
interface MediaDescription<T> {
    info: T;
    thumbnail?: Blob;
}

/**
 * Read the metadata for an image file and create a thumbnail of the image.
 *
 * @param {File} imageFile The image to read and thumbnail.
 * @returns {Promise} A promise that resolves with the attachment info and the thumbnail to upload, if any.
 */
async function infoForImageFile(imageFile: File): Promise<MediaDescription<ImageInfo>> {
    let thumbnailType = "image/png";
    if (imageFile.type === "image/jpeg") {
        thumbnailType = "image/jpeg";
    }

    // We don't await this immediately so it can happen in the background
    const isAnimatedPromise = blobIsAnimated(imageFile);

    const imageElement = await loadImageElement(imageFile);

    const result = await createThumbnail(imageElement.img, imageElement.width, imageElement.height, thumbnailType);
    const imageInfo = result.info;

    const isAnimated = await isAnimatedPromise;
    if (isAnimated !== undefined) {
        imageInfo["org.matrix.msc4230.is_animated"] = await isAnimatedPromise;
    }

    // For lesser supported image types, always include the thumbnail even if it is larger
    if (!ALWAYS_INCLUDE_THUMBNAIL.includes(imageFile.type)) {
        // we do all sizing checks here because we still rely on thumbnail generation for making a blurhash from.
        const sizeDifference = imageFile.size - imageInfo.thumbnail_info!.size!;
        if (
            // image is small enough already
            imageFile.size <= IMAGE_SIZE_THRESHOLD_THUMBNAIL ||
            // thumbnail is not sufficiently smaller than original
            (sizeDifference <= IMAGE_THUMBNAIL_MIN_REDUCTION_SIZE &&
                sizeDifference <= imageFile.size * IMAGE_THUMBNAIL_MIN_REDUCTION_PERCENT)
        ) {
            delete imageInfo["thumbnail_info"];
            return { info: imageInfo };
        }
    }

    return { info: imageInfo, thumbnail: result.thumbnail };
}

/**
 * Load a file into a newly created audio element and load the metadata
 *
 * @param {File} audioFile The file to load in an audio element.
 * @returns {Promise} A promise that resolves with the audio element.
 */
function loadAudioElement(audioFile: File): Promise<HTMLAudioElement> {
    return new Promise((resolve, reject) => {
        // Load the file into a html element
        const audio = document.createElement("audio");
        audio.preload = "metadata";
        audio.muted = true;

        const reader = new FileReader();

        reader.onload = function (ev): void {
            audio.onloadedmetadata = async function (): Promise<void> {
                resolve(audio);
            };
            audio.onerror = function (e): void {
                reject(e);
            };

            audio.src = ev.target?.result as string;
        };
        reader.onerror = function (e): void {
            reject(e);
        };
        reader.readAsDataURL(audioFile);
    });
}

/**
 * Read the metadata for an audio file.
 *
 * @param {File} audioFile The audio to read.
 * @returns {Promise} A promise that resolves with the attachment info.
 */
async function infoForAudioFile(audioFile: File): Promise<AudioInfo> {
    const audio = await loadAudioElement(audioFile);
    return { duration: Math.ceil(audio.duration * 1000) };
}

/**
 * Load a file into a newly created video element and pull some strings
 * in an attempt to guarantee the first frame will be showing.
 *
 * @param {File} videoFile The file to load in a video element.
 * @returns {Promise} A promise that resolves with the video element.
 */
function loadVideoElement(videoFile: File): Promise<HTMLVideoElement> {
    return new Promise((resolve, reject) => {
        // Load the file into a html element
        const video = document.createElement("video");
        video.preload = "metadata";
        video.playsInline = true;
        video.muted = true;

        // Inside: an object URL rather than the whole file read into a data URL (53 MB of text for a
        // 40 MB video). Chrome chokes on quicktime but likes mp4, so a .mov is handed over as mp4.
        const blob = videoFile.type === "video/quicktime" ? new Blob([videoFile], { type: "video/mp4" }) : videoFile;
        const objectUrl = URL.createObjectURL(blob);

        // Wait until we have enough data to thumbnail the first frame.
        video.onloadeddata = async function (): Promise<void> {
            resolve(video);
            video.pause();
            // The first frame stays drawable once loaded.
            URL.revokeObjectURL(objectUrl);
        };
        video.onerror = function (e): void {
            URL.revokeObjectURL(objectUrl);
            reject(e);
        };

        video.src = objectUrl;
        video.load();
        void video.play();
    });
}

/**
 * Read the metadata for a video file and create a thumbnail of the video.
 *
 * @param {File} videoFile The video to read and thumbnail.
 * @returns {Promise} A promise that resolves with the attachment info and the thumbnail to upload.
 */
async function infoForVideoFile(videoFile: File): Promise<MediaDescription<VideoInfo>> {
    const thumbnailType = "image/jpeg";

    const video = await loadVideoElement(videoFile);
    const videoInfo: VideoInfo = { duration: Math.ceil(video.duration * 1000) };
    const result = await createThumbnail(video, video.videoWidth, video.videoHeight, thumbnailType);
    Object.assign(videoInfo, result.info);
    return { info: videoInfo, thumbnail: result.thumbnail };
}

/**
 * Inside: draw the first page of a PDF as the thumbnail of the file. Resolves to no thumbnail if
 * the page cannot be drawn.
 */
async function infoForPdfFile(pdfFile: File): Promise<MediaDescription<FileInfo>> {
    const thumbnail = await pdfThumbnailForFile(pdfFile);
    if (!thumbnail) return { info: {} };
    return {
        info: {
            thumbnail_info: {
                w: thumbnail.width,
                h: thumbnail.height,
                mimetype: thumbnail.blob.type,
                size: thumbnail.blob.size,
            },
        },
        thumbnail: thumbnail.blob,
    };
}

/**
 * Read the file as an ArrayBuffer.
 * @param {File} file The file to read
 * @returns {Promise} A promise that resolves with an ArrayBuffer when the file
 *   is read.
 */
function readFileAsArrayBuffer(file: File | Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (e): void {
            resolve(e.target?.result as ArrayBuffer);
        };
        reader.onerror = function (e): void {
            reject(e);
        };
        reader.readAsArrayBuffer(file);
    });
}

/**
 * Upload the file to the content repository.
 * If the room is encrypted then encrypt the file before uploading.
 *
 * @param {MatrixClient} matrixClient The matrix client to upload the file with.
 * @param {String} roomId The ID of the room being uploaded to.
 * @param {File} file The file to upload.
 * @param {Function?} progressHandler optional callback to be called when a chunk of
 *    data is uploaded.
 * @param {AbortController?} controller optional abortController to use for this upload.
 * @returns {Promise} A promise that resolves with an object.
 *  If the file is unencrypted then the object will have a "url" key.
 *  If the file is encrypted then the object will have a "file" key.
 */
export async function uploadFile(
    matrixClient: MatrixClient,
    roomId: string,
    file: File | Blob,
    progressHandler?: UploadOpts["progressHandler"],
    controller?: AbortController,
): Promise<{ url?: string; file?: EncryptedFile }> {
    const abortController = controller ?? new AbortController();

    // If the room is encrypted then encrypt the file before uploading it.
    if (await matrixClient.getCrypto()?.isEncryptionEnabledInRoom(roomId)) {
        // First read the file into memory.
        const data = await readFileAsArrayBuffer(file);
        if (abortController.signal.aborted) throw new UploadCanceledError();

        // Then encrypt the file.
        const encryptResult = await encrypt.encryptAttachment(data);
        if (abortController.signal.aborted) throw new UploadCanceledError();

        // Pass the encrypted data as a Blob to the uploader.
        const blob = new Blob([encryptResult.data]);

        let url: string;
        try {
            ({ content_uri: url } = await matrixClient.uploadContent(blob, {
                progressHandler,
                abortController,
                includeFilename: false,
                type: "application/octet-stream",
            }));
        } catch (e) {
            if (abortController.signal.aborted) throw new UploadCanceledError();
            console.error("Failed to upload file", e);
            throw new UploadFailedError(e);
        }
        if (abortController.signal.aborted) throw new UploadCanceledError();

        cacheUploadedMedia(url, file);

        // If the attachment is encrypted then bundle the URL along with the information
        // needed to decrypt the attachment and add it under a file key.
        return {
            file: {
                ...encryptResult.info,
                url,
            } as EncryptedFile,
        };
    } else {
        let url: string;
        try {
            ({ content_uri: url } = await matrixClient.uploadContent(file, { progressHandler, abortController }));
        } catch (e) {
            if (abortController.signal.aborted) throw new UploadCanceledError();
            console.error("Failed to upload file", e);
            throw new UploadFailedError(e);
        }
        if (abortController.signal.aborted) throw new UploadCanceledError();
        cacheUploadedMedia(url, file);
        // If the attachment isn't encrypted then include the URL directly.
        return { url };
    }
}

/** Inside: put the uploaded thumbnail into the event, or drop its info when there is none. */
function applyThumbnail(content: MediaContent, uploaded?: { url?: string; file?: EncryptedFile }): void {
    const info = content.info as ImageInfo;
    if (uploaded) {
        info.thumbnail_url = uploaded.url;
        info.thumbnail_file = uploaded.file;
    } else {
        delete info.thumbnail_info;
    }
}

export default class ContentMessages {
    private inprogress: RoomUpload[] = [];
    // Inside: failed uploads of the main timeline, shown there as bubbles with "retry" and "delete",
    // each with what sends it again.
    private failed = new Map<RoomUpload, { retry: () => Promise<void>; dismiss?: () => void }>();
    private mediaConfig: IMediaConfig | null = null;

    public sendStickerContentToRoom(
        url: string,
        roomId: string,
        threadId: string | null,
        info: ImageInfo,
        text: string,
        matrixClient: MatrixClient,
    ): Promise<ISendEventResponse> {
        return doMaybeLocalRoomAction(
            roomId,
            (actualRoomId: string) => matrixClient.sendStickerMessage(actualRoomId, threadId, url, info, text),
            matrixClient,
        ).catch((e) => {
            logger.warn(`Failed to send content with URL ${url} to room ${roomId}`, e);
            throw e;
        });
    }

    public getUploadLimit(): number | null {
        return this.mediaConfig?.["m.upload.size"] ?? null;
    }

    /**
     * Sends a list of files to a room.
     * @param files - The files to send.
     * @param roomId - The ID of the room to send the files to.
     * @param relation - The relation to the event being replied to.
     * @param replyToEvent - The event being replied to, if any.
     * @param matrixClient - The Matrix client to use for sending the files.
     * @param context - The context in which the files are being sent.
     * @returns A promise that resolves when the files have been sent.
     */
    public async sendContentListToRoom(
        files: File[],
        roomId: string,
        relation: IEventRelation | undefined,
        replyToEvent: MatrixEvent | undefined,
        matrixClient: MatrixClient,
        context = TimelineRenderingType.Room,
    ): Promise<void> {
        if (matrixClient.isGuest()) {
            dis.dispatch({ action: "require_registration" });
            return;
        }

        if (!this.mediaConfig) {
            // hot-path optimization to not flash a spinner if we don't need to
            const modal = Modal.createDialog(Spinner, undefined, "mx_Dialog_spinner");
            await Promise.race([this.ensureMediaConfigFetched(matrixClient), modal.finished]);
            if (!this.mediaConfig) {
                // User cancelled by clicking away on the spinner
                return;
            } else {
                modal.close();
            }
        }

        const tooBigFiles: File[] = [];
        const okFiles: File[] = [];

        for (const file of files) {
            if (this.isFileSizeAcceptable(file)) {
                okFiles.push(file);
            } else {
                tooBigFiles.push(file);
            }
        }

        if (tooBigFiles.length > 0) {
            const { finished } = Modal.createDialog(UploadFailureDialog, {
                badFiles: tooBigFiles,
                totalFiles: files.length,
                contentMessages: this,
            });
            const [shouldContinue] = await finished;
            if (!shouldContinue) return;
        }

        let uploadAll = false;
        let caption: string | undefined;
        // Inside: the "No compression" switch of the dialog, which also holds for "upload all".
        let compress = !SettingsStore.getValue("Inside.uploadOriginals");
        // Promise to complete before sending next file into room, used for synchronisation of file-sending
        // to match the order the files were specified in
        let promBefore: Promise<any> = Promise.resolve();
        const sentFileTypes: string[] = [];
        for (let i = 0; i < okFiles.length; ++i) {
            const file = okFiles[i];
            const loopPromiseBefore = promBefore;

            if (!uploadAll) {
                const { finished } = Modal.createDialog(UploadConfirmDialog, {
                    file,
                    currentIndex: i,
                    totalFiles: okFiles.length,
                });
                const [shouldContinue, shouldUploadAll, dialogCaption, sendOriginal] = await finished;
                if (!shouldContinue) break;
                if (shouldUploadAll) {
                    uploadAll = true;
                }
                caption = dialogCaption;
                if (sendOriginal !== undefined) compress = !sendOriginal;
            } else {
                // Files sent with "upload all" go without the caption typed for the first one.
                caption = undefined;
            }
            const fileCaption = caption;
            const fileCompress = compress;
            // Inside: the next file follows once this one's event is out, which with asynchronous
            // uploads is before its file is up.
            const eventSent = Promise.withResolvers<void>();
            sentFileTypes.push(file.type.split("/")[0]);

            const sending = doMaybeLocalRoomAction(
                roomId,
                (actualRoomId) =>
                    this.sendContentToRoom(
                        file,
                        actualRoomId,
                        relation,
                        matrixClient,
                        replyToEvent ?? undefined,
                        loopPromiseBefore,
                        fileCaption,
                        { compress: fileCompress, onEventSent: eventSent.resolve },
                    ),
                matrixClient,
            );
            // However it ends, the files after it are not held up.
            sending.finally(eventSent.resolve).catch(() => {});
            promBefore = eventSent.promise;
        }
        if (sentFileTypes.length) {
            // Find the most common type.
            const [type] = sentFileTypes.sort(
                (a, b) => sentFileTypes.filter((v) => v === b).length - sentFileTypes.filter((v) => v === a).length,
            );
            PosthogAnalytics.instance.trackEvent<AttachmentSend>({
                eventName: "AttachmentSend",
                isReply: !!replyToEvent,
                inThread: relation?.rel_type === "m.thread",
                count: okFiles.length,
                kind: "local",
                type,
            });
        } else {
            PosthogAnalytics.instance.trackEvent<AttachmentCancel>({
                eventName: "AttachmentCancel",
                isReply: !!replyToEvent,
                inThread: relation?.rel_type === "m.thread",
                kind: "local",
                stage: "Confirmation",
            });
        }

        if (replyToEvent) {
            // Clear event being replied to
            dis.dispatch({
                action: "reply_to_event",
                event: null,
                context,
            });
        }

        // Focus the correct composer
        dis.dispatch({
            action: Action.FocusSendMessageComposer,
            context,
        });
    }

    public getCurrentUploads(relation?: IEventRelation): RoomUpload[] {
        return this.inprogress.filter((roomUpload) => {
            const noRelation = !relation && !roomUpload.relation;
            const matchingRelation =
                relation &&
                roomUpload.relation &&
                relation.rel_type === roomUpload.relation.rel_type &&
                relation.event_id === roomUpload.relation.event_id;

            return (noRelation || matchingRelation) && !roomUpload.cancelled;
        });
    }

    /**
     * Inside: the uploads into the main timeline of a room that failed and were not dismissed yet.
     */
    public getFailedUploads(roomId: string): RoomUpload[] {
        return [...this.failed.keys()].filter((upload) => upload.roomId === roomId);
    }

    /**
     * Inside: send a failed upload again, with the same file, caption and reply.
     */
    public retryUpload(upload: RoomUpload): Promise<void> {
        const failure = this.failed.get(upload);
        if (!failure) return Promise.resolve();
        this.failed.delete(upload);
        return failure.retry();
    }

    /**
     * Inside: forget a failed upload without sending it again.
     */
    public dismissFailedUpload(upload: RoomUpload): void {
        const failure = this.failed.get(upload);
        if (!failure) return;
        this.failed.delete(upload);
        // Inside: an event already sent for it is taken back.
        failure.dismiss?.();
        dis.dispatch<UploadCanceledPayload>({ action: Action.UploadCanceled, upload });
    }

    /**
     * Inside: whether the event is the sender's own media event whose file is still being uploaded
     * after it (asynchronous upload) into the main timeline. The timeline shows the pending bubble
     * of the upload in its place until the file is up.
     */
    public isMediaPendingFor(event: MatrixEvent): boolean {
        const uri = contentUriOf(event);
        if (!uri) return false;
        return [...this.inprogress, ...this.failed.keys()].some(
            (upload) => upload.awaitingMedia && !upload.relation && upload.contentUri === uri,
        );
    }

    public cancelUpload(upload: RoomUpload): void {
        upload.abort();
        dis.dispatch<UploadCanceledPayload>({ action: Action.UploadCanceled, upload });
    }

    public async sendContentToRoom(
        file: File,
        roomId: string,
        relation: IEventRelation | undefined,
        matrixClient: MatrixClient,
        replyToEvent: MatrixEvent | undefined,
        promBefore?: Promise<any>,
        caption?: string,
        options: SendContentOptions = {},
    ): Promise<void> {
        const compress = options.compress ?? !SettingsStore.getValue("Inside.uploadOriginals");
        const upload = new RoomUpload(roomId, file.name || _t("common|attachment"), relation, file.size);
        upload.file = file;
        upload.caption = caption?.trim() || undefined;
        this.inprogress.push(upload);
        dis.dispatch<UploadStartedPayload>({ action: Action.UploadStarted, upload });

        // Inside: the file that is actually sent, smaller than the one picked if it was compressed.
        let sending = file;
        try {
            if (compress) {
                sending = await this.compressForUpload(file, upload);
                if (upload.cancelled) throw new UploadCanceledError();
            }
            await this.uploadAndSend(
                sending,
                upload,
                roomId,
                relation,
                matrixClient,
                replyToEvent,
                promBefore,
                caption,
                options.onEventSent,
            );
        } catch (error) {
            this.onUploadError(error, upload, () =>
                this.sendContentToRoom(sending, roomId, relation, matrixClient, replyToEvent, undefined, caption, {
                    compress: false,
                }),
            );
        } finally {
            options.onEventSent?.();
            // Inside: this very upload; `promise` is never set, so matching on it removed whichever
            // upload came first.
            removeElement(this.inprogress, (e) => e === upload);
        }
    }

    /**
     * Inside: a smaller copy of a photo or a video for sending, or the file itself. The pending
     * bubble shows "Compressing…" meanwhile, with the share done for videos.
     */
    private async compressForUpload(file: File, upload: RoomUpload): Promise<File> {
        const photo = isCompressiblePhoto(file);
        if (!photo && !isCompressibleVideo(file)) return file;
        upload.compressing = true;
        dis.dispatch<UploadProgressPayload>({ action: Action.UploadProgress, upload });
        try {
            const compressed = photo
                ? await compressPhotoForUpload(file)
                : await compressVideoForUpload(file, {
                      signal: upload.abortController.signal,
                      onProgress: (progress) => {
                          upload.compressionProgress = progress;
                          dis.dispatch<UploadProgressPayload>({ action: Action.UploadProgress, upload });
                      },
                  });
            if (compressed !== file) {
                upload.file = compressed;
                upload.fileSize = compressed.size;
            }
            return compressed;
        } finally {
            upload.compressing = false;
            upload.compressionProgress = undefined;
            dis.dispatch<UploadProgressPayload>({ action: Action.UploadProgress, upload });
        }
    }

    private async uploadAndSend(
        file: File,
        upload: RoomUpload,
        roomId: string,
        relation: IEventRelation | undefined,
        matrixClient: MatrixClient,
        replyToEvent: MatrixEvent | undefined,
        promBefore: Promise<any> | undefined,
        caption: string | undefined,
        onEventSent: (() => void) | undefined,
    ): Promise<void> {
        const fileName = file.name || _t("common|attachment");
        const content: MediaContent = {
            body: fileName,
            info: {
                size: file.size,
            },
            msgtype: MsgType.File, // set more specifically later
        };
        // Media captions (Matrix spec v1.10): the caption goes in `body` and the real name moves to
        // `filename`. Clients that predate captions still show the text, just as a file name.
        if (caption?.trim()) {
            content.body = caption.trim();
            content.filename = fileName;
        }

        // Attach mentions, which really only applies if there's a replyToEvent.
        attachMentions(matrixClient.getSafeUserId(), content, null, replyToEvent);
        attachRelation(content, relation);
        if (replyToEvent) {
            addReplyToMessageContent(content, replyToEvent);
        }

        if (SettingsStore.getValue("Performance.addSendMessageTimingMetadata")) {
            decorateStartSendingTime(content);
        }

        // if we have a mime type for the file, add it to the message metadata
        if (file.type) {
            content.info.mimetype = file.type;
        }

        function onProgress(progress: UploadProgress): void {
            upload.onProgress(progress);
            dis.dispatch<UploadProgressPayload>({ action: Action.UploadProgress, upload });
        }
        // Inside: images and videos first upload a thumbnail; count it into the progress, so the bubble
        // does not stand at zero meanwhile.
        function onThumbnailProgress(progress: UploadProgress): void {
            upload.onThumbnailProgress(progress);
            dis.dispatch<UploadProgressPayload>({ action: Action.UploadProgress, upload });
        }

        // Inside: the file goes up at once, and its thumbnail next to it as soon as it is made, rather
        // than the thumbnail first and the file after it.
        const threadId = (relation?.rel_type === THREAD_RELATION_TYPE.name ? relation.event_id : null) ?? null;
        const describePromise = this.describeMedia(file, content);
        // Handled below; this only keeps a failure from being reported as unhandled meanwhile.
        describePromise.catch(() => {});

        // Inside: with asynchronous uploads (MSC2246) the event goes out first and the file after it.
        const created = await this.createMediaUriIfPossible(matrixClient, roomId, file);
        if (upload.cancelled) throw new UploadCanceledError();
        if (created) {
            await this.sendThenUpload(file, created, content, describePromise, upload, matrixClient, threadId, {
                promBefore,
                onEventSent,
                onThumbnailProgress,
            });
            return;
        }

        const filePromise = uploadFile(matrixClient, roomId, file, onProgress, upload.abortController);
        const thumbnailPromise = describePromise.then((thumbnail) =>
            thumbnail ? this.uploadThumbnail(matrixClient, roomId, thumbnail, onThumbnailProgress, upload) : undefined,
        );
        const [result, thumbnailResult] = await Promise.all([filePromise, thumbnailPromise]);
        applyThumbnail(content, thumbnailResult);
        content.file = result.file;
        content.url = result.url;
        upload.contentUri = result.url ?? result.file?.url;

        if (upload.cancelled) throw new UploadCanceledError();
        // Await previous message being sent into the room
        if (promBefore) await promBefore;

        if (upload.cancelled) throw new UploadCanceledError();

        const response = await matrixClient.sendMessage(roomId, threadId ?? null, content as MediaEventContent);

        if (SettingsStore.getValue("Performance.addSendMessageTimingMetadata")) {
            sendRoundTripMetric(matrixClient, roomId, response.event_id);
        }

        dis.dispatch<UploadFinishedPayload>({ action: Action.UploadFinished, upload });
        dis.dispatch({ action: "message_sent" });
    }

    /**
     * Inside: an mxc URI to upload to after the event is sent, where that is possible and worth it:
     * the setting is on, the file is large, the room is not encrypted and the server takes
     * asynchronous uploads (MSC2246). Undefined otherwise, or when the server refuses (it allows
     * only a few pending URIs), so that the file goes the classic way.
     */
    private async createMediaUriIfPossible(
        matrixClient: MatrixClient,
        roomId: string,
        file: File,
    ): Promise<CreatedMedia | undefined> {
        if (file.size < ASYNC_UPLOAD_MIN_BYTES || !SettingsStore.getValue("Inside.asyncMediaUpload")) return undefined;
        try {
            if (await matrixClient.getCrypto()?.isEncryptionEnabledInRoom(roomId)) return undefined;
            if (!(await serverSupportsAsyncUploads(matrixClient))) return undefined;
            return await createMediaUri(matrixClient);
        } catch (e) {
            logger.warn("Unable to reserve a media URI, uploading the classic way", e);
            return undefined;
        }
    }

    /**
     * Inside: send the event of a medium with its thumbnail and blurhash at once, then upload the
     * file to the URI reserved for it. Receivers see the message (blurred) right away and the media
     * once it is up. The pending bubble stays until then and its cancel takes the event back.
     */
    private async sendThenUpload(
        file: File,
        created: CreatedMedia,
        content: MediaContent,
        describePromise: Promise<Blob | undefined>,
        upload: RoomUpload,
        matrixClient: MatrixClient,
        threadId: string | null,
        {
            promBefore,
            onEventSent,
            onThumbnailProgress,
        }: {
            promBefore?: Promise<any>;
            onEventSent?: () => void;
            onThumbnailProgress: (progress: UploadProgress) => void;
        },
    ): Promise<void> {
        const { roomId } = upload;
        const { contentUri } = created;
        content.url = contentUri;
        // The sender's own tile shows the local file, without waiting for the upload.
        cacheUploadedMedia(contentUri, file);

        try {
            const thumbnail = await describePromise;
            const thumbnailResult = thumbnail
                ? await this.uploadThumbnail(matrixClient, roomId, thumbnail, onThumbnailProgress, upload)
                : undefined;
            applyThumbnail(content, thumbnailResult);
            if (upload.cancelled) throw new UploadCanceledError();
            if (promBefore) await promBefore;
            if (upload.cancelled) throw new UploadCanceledError();
        } catch (e) {
            forgetUploadedMedia(contentUri);
            throw e;
        }

        upload.contentUri = contentUri;
        upload.awaitingMedia = true;
        const sent = matrixClient.sendMessage(roomId, threadId, content as MediaEventContent);
        upload.sentEvent = sent.then(
            (response) => response.event_id,
            (e) => {
                // Its local echo stays as an unsent message that can be sent again once the file is up.
                logger.warn("The event of an upload failed to send", e);
                return undefined;
            },
        );
        // The file goes up while the event is on its way; a retry puts it to the same URI.
        const putFor = (target: RoomUpload): Promise<void> =>
            uploadToMediaUri(matrixClient, contentUri, file, {
                name: file.name || undefined,
                progressHandler: (progress) => {
                    target.onProgress(progress);
                    dis.dispatch<UploadProgressPayload>({ action: Action.UploadProgress, upload: target });
                },
                abortController: target.abortController,
            });
        const put = putFor(upload);
        const eventId = await upload.sentEvent;
        onEventSent?.();
        if (eventId) {
            if (SettingsStore.getValue("Performance.addSendMessageTimingMetadata")) {
                sendRoundTripMetric(matrixClient, roomId, eventId);
            }
            dis.dispatch({ action: "message_sent" });
        }
        await this.awaitMedia(upload, put, matrixClient, putFor);
    }

    /**
     * Inside: wait for the file of an event already sent. Cancelling takes the event back; a
     * failure leaves the bubble with "retry" (the same file to the same URI) and "delete" (the
     * event is taken back), in threads a dialog and the event is taken back.
     */
    private async awaitMedia(
        upload: RoomUpload,
        put: Promise<void>,
        matrixClient: MatrixClient,
        putFor: (upload: RoomUpload) => Promise<void>,
    ): Promise<void> {
        try {
            await put;
        } catch (e) {
            if (upload.cancelled) {
                await this.withdrawEvent(matrixClient, upload);
                throw new UploadCanceledError();
            }
            logger.warn("The file of a sent event failed to upload", e);
            const description = _t("upload_failed_generic", { fileName: upload.fileName });
            if (upload.relation) {
                await this.withdrawEvent(matrixClient, upload);
                Modal.createDialog(ErrorDialog, { title: _t("upload_failed_title"), description });
            } else {
                upload.failed = true;
                upload.failureReason = description;
                this.failed.set(upload, {
                    retry: () => this.retryMedia(upload, matrixClient, putFor),
                    dismiss: () => void this.withdrawEvent(matrixClient, upload),
                });
            }
            dis.dispatch<UploadErrorPayload>({ action: Action.UploadFailed, upload, error: e });
            return;
        }
        upload.awaitingMedia = false;
        dis.dispatch<UploadFinishedPayload>({ action: Action.UploadFinished, upload });
    }

    /** Inside: upload the file of a sent event again, after its upload failed. */
    private async retryMedia(
        failed: RoomUpload,
        matrixClient: MatrixClient,
        putFor: (upload: RoomUpload) => Promise<void>,
    ): Promise<void> {
        const upload = new RoomUpload(failed.roomId, failed.fileName, failed.relation, failed.fileSize);
        upload.file = failed.file;
        upload.caption = failed.caption;
        upload.contentUri = failed.contentUri;
        upload.sentEvent = failed.sentEvent;
        upload.awaitingMedia = true;
        this.inprogress.push(upload);
        dis.dispatch<UploadStartedPayload>({ action: Action.UploadStarted, upload });
        try {
            await this.awaitMedia(upload, putFor(upload), matrixClient, putFor);
        } catch {
            // Cancelled: the event was taken back.
        } finally {
            removeElement(this.inprogress, (e) => e === upload);
        }
    }

    /** Inside: take back the event of an upload whose file will not come: redact it, or drop its local echo. */
    private async withdrawEvent(matrixClient: MatrixClient, upload: RoomUpload): Promise<void> {
        const { contentUri } = upload;
        if (contentUri) forgetUploadedMedia(contentUri);
        try {
            const eventId = await upload.sentEvent;
            if (eventId) {
                await matrixClient.redactEvent(upload.roomId, eventId);
                return;
            }
            const room = matrixClient.getRoom(upload.roomId);
            const echo = room?.getPendingEvents().find((event) => contentUriOf(event) === contentUri);
            if (echo) matrixClient.cancelPendingEvent(echo);
        } catch (e) {
            logger.warn("Unable to take back the event of a cancelled upload", e);
        }
    }

    /**
     * Set the msgtype and the info of a media event from its file; resolves to the thumbnail to
     * upload with it, if there is one. A file that cannot be read as what its type says goes as
     * m.file.
     */
    private async describeMedia(
        file: File,
        content: { msgtype: string; info: Partial<MediaEventInfo> },
    ): Promise<Blob | undefined> {
        let description: MediaDescription<MediaEventInfo> | undefined;
        if (file.type.startsWith("image/")) {
            content.msgtype = MsgType.Image;
            try {
                description = await infoForImageFile(file);
            } catch (e) {
                // We failed to thumbnail, fall back to uploading an m.file
                logger.error(`Expected file of type "${file.type}" to be an image, but got`, e);
                content.msgtype = MsgType.File;
            }
        } else if (file.type.startsWith("audio/")) {
            content.msgtype = MsgType.Audio;
            try {
                description = { info: await infoForAudioFile(file) };
            } catch (e) {
                // Failed to process audio file, fall back to uploading an m.file
                logger.error(e);
                content.msgtype = MsgType.File;
            }
        } else if (file.type.startsWith("video/")) {
            content.msgtype = MsgType.Video;
            try {
                description = await infoForVideoFile(file);
            } catch (e) {
                // Failed to thumbnail, fall back to uploading an m.file
                logger.error(e);
                content.msgtype = MsgType.File;
            }
        } else {
            content.msgtype = MsgType.File;
            if (isPdfFile(file)) {
                // Inside: the first page as the thumbnail of the file, as in Telegram. Without it the
                // file is still sent, just with the document icon.
                description = await infoForPdfFile(file);
            }
        }
        if (description) Object.assign(content.info, description.info);
        return description?.thumbnail;
    }

    /**
     * Inside: upload the thumbnail of a medium. The medium is sent without one if this fails; only
     * cancelling the upload throws.
     */
    private async uploadThumbnail(
        matrixClient: MatrixClient,
        roomId: string,
        thumbnail: Blob,
        progressHandler: UploadOpts["progressHandler"],
        upload: RoomUpload,
    ): Promise<{ url?: string; file?: EncryptedFile } | undefined> {
        try {
            return await uploadFile(matrixClient, roomId, thumbnail, progressHandler, upload.abortController);
        } catch (e) {
            if (e instanceof UploadCanceledError || upload.cancelled) throw new UploadCanceledError();
            logger.warn("Unable to upload a thumbnail, sending without it", e);
            return undefined;
        }
    }

    /** Report a failed upload: in place in the main timeline (Inside), in a dialog in threads. */
    private onUploadError(error: unknown, upload: RoomUpload, retry: () => Promise<void>): void {
        // Unwrap UploadFailedError to get the underlying error
        const unwrappedError = error instanceof UploadFailedError && error.cause ? error.cause : error;

        // 413: File was too big or upset the server in some way:
        // clear the media size limit so we fetch it again next time we try to upload
        if (unwrappedError instanceof HTTPError && unwrappedError.httpStatus === 413) {
            this.mediaConfig = null;
        }

        if (!upload.cancelled) {
            let desc = _t("upload_failed_generic", { fileName: upload.fileName });
            if (unwrappedError instanceof HTTPError && unwrappedError.httpStatus === 413) {
                desc = _t("upload_failed_size", {
                    fileName: upload.fileName,
                });
            }
            if (upload.relation) {
                Modal.createDialog(ErrorDialog, {
                    title: _t("upload_failed_title"),
                    description: desc,
                });
            } else if (upload.contentUri) {
                // Inside: the file is on the server and the event failed to send. Its local echo is in
                // the timeline as an unsent message (red mark, "resend" in the room status bar), which
                // resends it without uploading again; a failed bubble next to it would be a duplicate.
            } else {
                // Inside: the main timeline shows the failed upload in place, with "retry" and
                // "delete" (InsidePendingUploads), so no dialog over it.
                upload.failed = true;
                upload.failureReason = desc;
                this.failed.set(upload, { retry });
            }
            dis.dispatch<UploadErrorPayload>({ action: Action.UploadFailed, upload, error });
        }
    }

    private isFileSizeAcceptable(file: File): boolean {
        if (this.mediaConfig?.["m.upload.size"] !== undefined && file.size > this.mediaConfig["m.upload.size"]) {
            return false;
        }
        return true;
    }

    private ensureMediaConfigFetched(matrixClient: MatrixClient): Promise<void> {
        if (this.mediaConfig !== null) return Promise.resolve();

        logger.log("[Media Config] Fetching");
        return matrixClient
            .getMediaConfig()
            .then((config) => {
                logger.log("[Media Config] Fetched config:", config);
                return config;
            })
            .catch(() => {
                // Media repo can't or won't report limits, so provide an empty object (no limits).
                logger.log("[Media Config] Could not fetch config, so not limiting uploads.");
                return {};
            })
            .then((config) => {
                this.mediaConfig = config;
            });
    }

    public static sharedInstance(): ContentMessages {
        if (window.mxContentMessages === undefined) {
            window.mxContentMessages = new ContentMessages();
        }
        return window.mxContentMessages;
    }
}
