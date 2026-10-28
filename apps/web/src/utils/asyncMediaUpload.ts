/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Inside: asynchronous media upload (MSC2246, Matrix 1.7). The client asks the server for an mxc
 * URI first (`POST /_matrix/media/v1/create`), sends the event with it right away, and uploads the
 * bytes to that URI afterwards (`PUT /_matrix/media/v3/upload/{server}/{id}`). Until they are there
 * the server holds downloads of the URI for up to 20 s (60 s with `timeout_ms`), then answers 504
 * `M_NOT_YET_UPLOADED`.
 */

import { type MatrixClient, MatrixError, Method, MediaPrefix, type UploadProgress } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

// The spec version that brought asynchronous uploads.
const ASYNC_UPLOAD_VERSION = "v1.7";
// Like the SDK's uploads: give up when no progress was made for this long.
const STALL_TIMEOUT_MS = 30_000;

const support = new WeakMap<MatrixClient, Promise<boolean>>();

/** Whether the homeserver takes asynchronous uploads; asked once per client. */
export function serverSupportsAsyncUploads(client: MatrixClient): Promise<boolean> {
    let supported = support.get(client);
    if (!supported) {
        supported = client
            .isVersionSupported(ASYNC_UPLOAD_VERSION)
            .then((yes) => !!yes)
            .catch(() => false);
        support.set(client, supported);
    }
    return supported;
}

export interface CreatedMedia {
    contentUri: string;
    /** When the server forgets the URI if nothing is uploaded to it, in ms since the epoch. */
    unusedExpiresAt?: number;
}

/** Reserve an mxc URI to upload to later. */
export async function createMediaUri(client: MatrixClient): Promise<CreatedMedia> {
    const response = await client.http.authedRequest<{ content_uri: string; unused_expires_at?: number }>(
        Method.Post,
        "/create",
        undefined,
        undefined,
        { prefix: MediaPrefix.V1 },
    );
    if (!response?.content_uri?.startsWith("mxc://")) throw new Error("No content URI in the response");
    return { contentUri: response.content_uri, unusedExpiresAt: response.unused_expires_at };
}

export interface UploadToUriOptions {
    /** The file name to store with the media. */
    name?: string;
    progressHandler?: (progress: UploadProgress) => void;
    abortController?: AbortController;
}

function parseMxc(contentUri: string): { serverName: string; mediaId: string } {
    const match = /^mxc:\/\/([^/]+)\/([^/]+)$/.exec(contentUri);
    if (!match) throw new Error(`Not an mxc URI: ${contentUri}`);
    return { serverName: match[1], mediaId: match[2] };
}

function putOnce(
    client: MatrixClient,
    contentUri: string,
    body: Blob,
    options: UploadToUriOptions,
    abortController: AbortController,
): Promise<void> {
    const { serverName, mediaId } = parseMxc(contentUri);
    const url = new URL(
        `${client.getHomeserverUrl().replace(/\/$/, "")}${MediaPrefix.V3}/upload/` +
            `${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
    );
    if (options.name) url.searchParams.set("filename", options.name);

    return new Promise<void>((resolve, reject) => {
        if (abortController.signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const xhr = new XMLHttpRequest();
        let timedOut = false;
        const armStallTimer = (): ReturnType<typeof setTimeout> =>
            setTimeout(() => {
                timedOut = true;
                xhr.abort();
            }, STALL_TIMEOUT_MS);
        let stallTimer = armStallTimer();
        const onAbort = (): void => xhr.abort();
        abortController.signal.addEventListener("abort", onAbort);
        const finish = (): void => {
            clearTimeout(stallTimer);
            abortController.signal.removeEventListener("abort", onAbort);
        };

        xhr.upload.onprogress = (ev: ProgressEvent): void => {
            clearTimeout(stallTimer);
            stallTimer = armStallTimer();
            options.progressHandler?.({ loaded: ev.loaded, total: ev.total });
        };
        xhr.onload = (): void => {
            finish();
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
                return;
            }
            let data: Record<string, unknown> = {};
            try {
                data = JSON.parse(xhr.responseText);
            } catch {
                // Not JSON: keep the status alone.
            }
            reject(new MatrixError(data, xhr.status, url.href));
        };
        xhr.onerror = (): void => {
            finish();
            reject(new Error("The upload failed"));
        };
        xhr.onabort = (): void => {
            finish();
            reject(timedOut ? new Error("Timeout") : new DOMException("Aborted", "AbortError"));
        };

        xhr.open(Method.Put, url.href);
        const token = client.getAccessToken();
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.setRequestHeader("Content-Type", body.type || "application/octet-stream");
        xhr.send(body);
    });
}

/**
 * Upload the bytes of a medium to an mxc URI reserved with {@link createMediaUri}. On an expired
 * access token it lets the SDK refresh it and tries once more.
 */
export async function uploadToMediaUri(
    client: MatrixClient,
    contentUri: string,
    body: Blob,
    options: UploadToUriOptions = {},
): Promise<void> {
    const abortController = options.abortController ?? new AbortController();
    try {
        await putOnce(client, contentUri, body, options, abortController);
    } catch (e) {
        if (!(e instanceof MatrixError) || e.errcode !== "M_UNKNOWN_TOKEN" || abortController.signal.aborted) throw e;
        logger.info("The access token expired during an upload; refreshing it and trying again");
        // Any authenticated request makes the SDK refresh the token.
        await client.http.authedRequest(Method.Get, "/account/whoami");
        await putOnce(client, contentUri, body, options, abortController);
    }
}
