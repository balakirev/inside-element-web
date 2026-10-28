/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Inside: compress a photo before sending it (see photoCompression.ts), in a worker with an
 * OffscreenCanvas where the browser has them, on the main thread otherwise. Whatever goes wrong,
 * the original file is sent.
 */

import { logger } from "matrix-js-sdk/src/logger";

import { blobIsAnimated } from "./Image";
import photoCompressionWorkerFactory from "../workers/photoCompressionWorkerFactory";
import {
    compressedFileName,
    compressPhotoBlob,
    isCompressiblePhoto,
    type CompressedPhoto,
    type CompressPhotoOptions,
    type PhotoWorkerRequest,
    type PhotoWorkerResponse,
} from "./photoCompression";

// Giving up on the worker after this long and sending the original.
const WORKER_TIMEOUT_MS = 30_000;

// The worker that does the work, started on first use.
let worker: Worker | undefined;
let nextSeq = 0;
const pending = new Map<number, (response: PhotoWorkerResponse) => void>();

function workerAvailable(): boolean {
    return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
}

function compressInWorker(blob: Blob, options: CompressPhotoOptions): Promise<CompressedPhoto | null> {
    if (!worker) {
        worker = photoCompressionWorkerFactory();
        worker.onmessage = (event: MessageEvent<PhotoWorkerResponse>): void => {
            pending.get(event.data.seq)?.(event.data);
            pending.delete(event.data.seq);
        };
    }
    const seq = nextSeq++;
    const { promise, resolve, reject } = Promise.withResolvers<CompressedPhoto | null>();
    const timer = setTimeout(() => {
        pending.delete(seq);
        reject(new Error("Photo compression timed out"));
    }, WORKER_TIMEOUT_MS);
    pending.set(seq, (response) => {
        clearTimeout(timer);
        if (response.error !== undefined) reject(new Error(response.error));
        else resolve(response.result ?? null);
    });
    worker.postMessage({ seq, blob, options } satisfies PhotoWorkerRequest);
    return promise;
}

/**
 * The photo to send in place of `file`: smaller if it is a large still photo, the file itself
 * otherwise (animations, other types, anything that fails).
 */
export async function compressPhotoForUpload(file: File, options: CompressPhotoOptions = {}): Promise<File> {
    if (!isCompressiblePhoto(file)) return file;
    try {
        if (file.type !== "image/jpeg" && (await blobIsAnimated(file))) return file;
        let result: CompressedPhoto | null;
        try {
            result = workerAvailable() ? await compressInWorker(file, options) : await compressPhotoBlob(file, options);
        } catch (e) {
            if (!workerAvailable()) throw e;
            logger.warn("Photo compression in the worker failed, trying on the main thread", e);
            result = await compressPhotoBlob(file, options);
        }
        if (!result) return file;
        return new File([result.blob], compressedFileName(file.name, result.blob.type), {
            type: result.blob.type,
            lastModified: file.lastModified,
        });
    } catch (e) {
        logger.warn("Unable to compress a photo, sending the original", e);
        return file;
    }
}

/**
 * Whether the file is one that {@link compressPhotoForUpload} may make smaller, so that the upload
 * dialog offers to send it as it is.
 */
export function mayCompressForUpload(file: File): boolean {
    return isCompressiblePhoto(file);
}
