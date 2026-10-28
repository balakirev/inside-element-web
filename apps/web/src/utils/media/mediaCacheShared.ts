/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Inside: names shared by the app and the service worker's media cache (`serviceworker/mediaCache.ts`).
 */

/** The Cache Storage cache holding media responses. Bump the suffix to drop every cached entry. */
export const MEDIA_CACHE_NAME = "inside-media-v1";

/**
 * A request header the app sets on media requests that must not wait for media still being uploaded
 * (asynchronous uploads, MSC2246): prefetching and probing why an image failed. The service worker
 * then answers the server's "not yet uploaded" at once instead of polling for it.
 */
export const NO_WAIT_HEADER = "X-Inside-No-Wait";

/**
 * A query parameter the app adds to a media URL to make the browser load it again after an error.
 * The service worker leaves it out of the cache key and of the request it sends.
 */
export const RETRY_PARAM = "inside_retry";

/** Forget every cached media response, e.g. on logout. Never rejects. */
export async function clearMediaCache(): Promise<void> {
    try {
        if (typeof caches === "undefined") return;
        await caches.delete(MEDIA_CACHE_NAME);
    } catch {
        // Cache Storage can be unavailable (private mode, insecure context): nothing to clear then.
    }
}
