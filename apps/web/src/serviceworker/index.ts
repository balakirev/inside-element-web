/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type AESEncryptedSecretStoragePayload } from "matrix-js-sdk/src/types";

import { idbLoad } from "../utils/StorageAccess";
import { ACCESS_TOKEN_NAME, tryDecryptToken } from "../utils/tokens/tokens";
import { buildAndEncodePickleKey } from "../utils/tokens/pickling";
import { NO_WAIT_HEADER } from "../utils/media/mediaCacheShared";
import {
    type ByteRange,
    isNotYetUploaded,
    MediaCache,
    type MediaRequestInfo,
    parseMediaUrl,
    parseRange,
    rangeFromCached,
    rangeFromFullResponse,
    stripRetryParam,
} from "./mediaCache";

const serverSupportMap: {
    [serverUrl: string]: {
        supportsAuthedMedia: boolean;
        cacheExpiryTimeMs: number;
    };
} = {};

global.addEventListener("install", (event) => {
    // We skipWaiting() to update the service worker more frequently, particularly in development environments.
    // @ts-expect-error - service worker types are not available. See 'fetch' event handler.
    event.waitUntil(skipWaiting());
});

global.addEventListener("activate", (event) => {
    // We force all clients to be under our control, immediately. This could be old tabs.
    // @ts-expect-error - service worker types are not available. See 'fetch' event handler.
    event.waitUntil(clients.claim());
});

// @ts-expect-error - the service worker types conflict with the DOM types available through TypeScript. Many hours
// have been spent trying to convince the type system that there's no actual conflict, but it has yet to work. Instead
// of trying to make it do the thing, we force-cast to something close enough where we can (and ignore errors otherwise).
global.addEventListener("fetch", (event: FetchEvent) => {
    // This is the authenticated media (MSC3916) check, proxying what was unauthenticated to the authenticated variants.

    if (event.request.method !== "GET") {
        return; // not important to us
    }

    // Note: ideally we'd keep the request headers etc, but in practice we can't even see those details.
    // See https://stackoverflow.com/a/59152482
    const url = new URL(event.request.url);

    // We only intercept v3 download and thumbnail requests as presumably everything else is deliberate.
    // For example, `/_matrix/media/unstable` or `/_matrix/media/v3/preview_url` are something well within
    // the control of the application, and appear to be choices made at a higher level than us.
    if (
        !url.pathname.startsWith("/_matrix/media/v3/download") &&
        !url.pathname.startsWith("/_matrix/media/v3/thumbnail")
    ) {
        return; // not a URL we care about
    }

    // We need to call respondWith synchronously, otherwise we may never execute properly. This means
    // later on we need to proxy the request through if it turns out the server doesn't support authentication.
    event.respondWith(handleMediaRequest(event, url));
});

/** Inside: the cache of media responses, see `mediaCache.ts`. */
const mediaCache = new MediaCache(() => (typeof caches === "undefined" ? undefined : caches));

/** Inside: how long a media request waits for a file that is still being uploaded (MSC2246). */
const UPLOAD_WAIT_MS = 4 * 60 * 1000;
/** Inside: the longest a single request may ask Synapse to hold it while the upload goes on. */
const UPLOAD_POLL_TIMEOUT_MS = 60 * 1000;
/**
 * Inside: a thumbnail request that took this long and then failed with 404 most likely waited for an
 * upload which has just finished, before Synapse made the thumbnails. Worth asking again.
 */
const SLOW_THUMBNAIL_404_MS = 1000;

/**
 * Inside: answers a media request: from the media cache when it has the file (content behind an mxc
 * URI never changes), otherwise from the server, with authentication, waiting for files that are still
 * being uploaded, emulating `Range` that Synapse ignores, and caching what is worth caching.
 */
/** Inside: the parts of a `FetchEvent` used here (service worker types are not available, see above). */
interface MediaFetchEvent {
    request: Request;
    clientId: string;
    waitUntil?(promise: Promise<unknown>): void;
}

async function handleMediaRequest(event: MediaFetchEvent, url: URL): Promise<Response> {
    const info = parseMediaUrl(url);
    const rangeHeader = event.request.headers?.get?.("Range") ?? null;
    const range = parseRange(rangeHeader);
    const noWait = !!event.request.headers?.get?.(NO_WAIT_HEADER);

    if (info) {
        const cached = await fromCache(info, range);
        if (cached) return cached;

        // The same file is on its way already (the prefetcher and the timeline, or two tiles): wait for
        // it to land in the cache instead of downloading it twice.
        const inFlight = downloadsInFlight.get(info.key);
        if (inFlight && !noWait) {
            await inFlight;
            const landed = await fromCache(info, range);
            if (landed) return landed;
        }
    }

    let finished = (): void => {};
    if (info && !range && !downloadsInFlight.has(info.key)) {
        const key = info.key;
        downloadsInFlight.set(
            key,
            new Promise<void>((resolve) => {
                finished = (): void => {
                    downloadsInFlight.delete(key);
                    resolve();
                };
            }),
        );
    }

    try {
        const response = await fetchFromServer(event, url, info, rangeHeader, noWait);

        let forPage = response;
        if (info && MediaCache.isCacheable(info.kind, response) && coversWholeBody(range, response)) {
            let caching: Promise<void>;
            if (info.kind === "thumbnail") {
                // Small, and always wanted: read a copy into the cache whatever the page does.
                caching = response
                    .clone()
                    .blob()
                    .then((body) => mediaCache.put(info.key, body, response.headers));
            } else {
                // An original is cached only if the page reads all of it: a video element fetching just
                // the metadata, or a cancelled download, must not pull the rest of the file over the network.
                let collected: Promise<Blob | null>;
                [forPage, collected] = collectWhileStreaming(response);
                caching = collected.then((body) =>
                    body ? mediaCache.put(info.key, body, response.headers) : undefined,
                );
            }
            const done = caching.catch(() => {}).finally(finished);
            event.waitUntil?.(done);
        } else {
            finished();
        }

        if (range && forPage.status === 200) return rangeFromFullResponse(forPage, range);
        return forPage;
    } catch (e) {
        finished();
        throw e;
    }
}

/**
 * Inside: passes a response's body through to the page, keeping a copy of what goes by. The promise gives
 * the whole body once the page has read it to the end, or null if it stopped early or the download failed.
 */
function collectWhileStreaming(response: Response): [Response, Promise<Blob | null>] {
    if (!response.body) return [response, Promise.resolve(null)];
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let settle: (body: Blob | null) => void = () => {};
    const collected = new Promise<Blob | null>((resolve) => (settle = resolve));
    const body = new ReadableStream<Uint8Array>({
        async pull(controller): Promise<void> {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    controller.close();
                    settle(new Blob(chunks as BlobPart[]));
                    return;
                }
                chunks.push(value);
                controller.enqueue(value);
            } catch (e) {
                settle(null);
                controller.error(e);
            }
        },
        cancel(reason): Promise<void> {
            settle(null);
            return reader.cancel(reason);
        },
    });
    return [
        new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }),
        collected,
    ];
}

/** Inside: downloads of cacheable media under way, by cache key; settle once the file is cached (or not). */
const downloadsInFlight = new Map<string, Promise<void>>();

/** Inside: the cached response for a media request, if the cache has the file. */
async function fromCache(info: MediaRequestInfo, range: ByteRange | null): Promise<Response | undefined> {
    const cached = await mediaCache.match(info.key);
    if (!cached) return undefined;
    if (range) return rangeFromCached(cached, range);
    if (info.kind === "thumbnail") return cached;
    // Let a media element know that it may seek in the cached file.
    const headers = new Headers(cached.headers);
    headers.set("Accept-Ranges", "bytes");
    return new Response(cached.body, { status: cached.status, headers });
}

/**
 * Inside: sends a media request to the server and, unless told not to wait, keeps asking while the file
 * is still being uploaded.
 */
async function fetchFromServer(
    event: MediaFetchEvent,
    url: URL,
    info: MediaRequestInfo | null,
    rangeHeader: string | null,
    noWait: boolean,
): Promise<Response> {
    // Add jitter to reduce request spam, particularly to `/versions` on initial page load
    await new Promise<void>((resolve) => setTimeout(() => resolve(), Math.random() * 10));

    // Pass `Range` on, in case the server honours it one day (then its 206 goes back untouched).
    const extraHeaders: Record<string, string> = rangeHeader ? { Range: rangeHeader } : {};
    const requestUrl = stripRetryParam(url);
    let started = Date.now();
    let response = await fetchMediaWithAuth(requestUrl, event.clientId, extraHeaders);
    if (noWait) return response;

    // Asynchronous uploads (MSC2246): the event can arrive before the file. Synapse holds the request
    // for `timeout_ms` (20 s by default) and then answers 504 M_NOT_YET_UPLOADED; ask again, so that
    // the image or video shows up by itself once the upload is done instead of failing.
    const deadline = Date.now() + UPLOAD_WAIT_MS;
    const pollUrl = new URL(requestUrl.href);
    pollUrl.searchParams.set("timeout_ms", String(UPLOAD_POLL_TIMEOUT_MS));
    let delayMs = 500;
    let waited = false;
    let thumbnailRetries = 0;
    while (Date.now() < deadline) {
        const pending = await isNotYetUploaded(response);
        const thumbnailNotReady =
            !pending &&
            info?.kind === "thumbnail" &&
            response.status === 404 &&
            thumbnailRetries < 3 &&
            (waited || Date.now() - started > SLOW_THUMBNAIL_404_MS);
        if (!pending && !thumbnailNotReady) break;
        if (thumbnailNotReady) thumbnailRetries++;
        waited = true;
        await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
        delayMs = Math.min(delayMs * 2, 5000);
        started = Date.now();
        response = await fetchMediaWithAuth(pollUrl, event.clientId, extraHeaders);
    }
    return response;
}

/** Inside: whether a response to a request with this range carries the whole file, so may be cached. */
function coversWholeBody(range: ByteRange | null, response: Response): boolean {
    if (!range) return true;
    // A Safari probe ("bytes=0-1") must not pull the whole file into the cache.
    const total = Number(response.headers.get("Content-Length") ?? NaN);
    return range.start === 0 && (range.end === undefined || range.end >= total - 1);
}

/**
 * Sends a media request with the access token, rewritten to the authenticated (MSC3916) endpoints where
 * the server supports them, and retries once with a refreshed token after a 401.
 */
async function fetchMediaWithAuth(url: URL, clientId: string, extraHeaders: Record<string, string>): Promise<Response> {
    let { url: requestUrl, auth } = await prepareRequest(url, clientId);

    // Add authentication and send the request. We add authentication even if MSC3916 endpoints aren't
    // being used to ensure patches like this work:
    // https://github.com/matrix-org/synapse/commit/2390b66bf0ec3ff5ffb0c7333f3c9b239eeb92bb
    const response = await fetch(requestUrl, fetchConfigForToken(auth?.accessToken, extraHeaders));
    if (response.status !== 401) return response;

    // Inside: with OAuth (MAS) access tokens expire and the app refreshes them lazily, so the stored
    // token we just used may be stale — typically right after reopening a tab. And at startup the tab
    // may be too busy to answer "userinfo" in time, so the request went out without any token at all.
    // Either way, ask the tab to refresh the token, read it again and retry once with it, instead of
    // leaving the image broken.
    try {
        const staleToken = auth?.accessToken;
        await refreshTokenInTab(clientId);
        if (staleToken) {
            // @ts-expect-error - service worker types are not available. See 'fetch' event handler.
            const client = await global.clients.get(clientId);
            auth = await waitForNewAuthData(client, staleToken);
            if (auth.accessToken !== staleToken) {
                return await fetch(requestUrl, fetchConfigForToken(auth.accessToken, extraHeaders));
            }
        } else {
            ({ url: requestUrl, auth } = await prepareRequest(url, clientId));
            if (auth?.accessToken) {
                return await fetch(requestUrl, fetchConfigForToken(auth.accessToken, extraHeaders));
            }
        }
    } catch (err) {
        console.error("SW: Error retrying the media request with a fresh access token.", err);
    }
    return response;
}

/**
 * Works out the access token for a media request and, where the server supports it, the authenticated
 * (MSC3916) URL to send it to. On any failure, returns the original URL with no auth: we stay safe by not
 * adding the access token to the request.
 */
async function prepareRequest(
    originalUrl: URL,
    clientId: string,
): Promise<{ url: URL; auth?: { accessToken?: string; homeserver: string } }> {
    const url = new URL(originalUrl.href);
    try {
        // Figure out which homeserver we're communicating with
        const csApi = url.origin;

        // Locate the access token and homeserver url
        // @ts-expect-error - service worker types are not available. See 'fetch' event handler.
        const client = await global.clients.get(clientId);
        const auth = await getAuthData(client);

        // Is this request actually going to the homeserver?
        const isRequestToHomeServer = url.origin === new URL(auth.homeserver).origin;
        if (!isRequestToHomeServer) {
            throw new Error("Request appears to be for media endpoint but wrong homeserver!");
        }

        // Update or populate the server support map using a (usually) authenticated `/versions` call.
        await tryUpdateServerSupportMap(csApi, auth.accessToken);

        // If we have server support (and a means of authentication), rewrite the URL to use MSC3916 endpoints.
        if (serverSupportMap[csApi].supportsAuthedMedia && auth.accessToken) {
            url.href = url.href.replace(/\/media\/v3\/(.*)\//, "/client/v1/media/$1/");
        } // else by default we make no changes
        return { url, auth };
    } catch (err) {
        console.error("SW: Error in request rewrite.", err);
        return { url: new URL(originalUrl.href) };
    }
}

async function tryUpdateServerSupportMap(clientApiUrl: string, accessToken?: string): Promise<void> {
    // only update if we don't know about it, or if the data is stale
    if (serverSupportMap[clientApiUrl]?.cacheExpiryTimeMs > new Date().getTime()) {
        return; // up to date
    }

    const config = fetchConfigForToken(accessToken);
    const versions = await (await fetch(`${clientApiUrl}/_matrix/client/versions`, config)).json();
    console.log(`[ServiceWorker] /versions response for '${clientApiUrl}': ${JSON.stringify(versions)}`);

    serverSupportMap[clientApiUrl] = {
        supportsAuthedMedia: Boolean(versions?.versions?.includes("v1.11")),
        cacheExpiryTimeMs: new Date().getTime() + 2 * 60 * 60 * 1000, // 2 hours from now
    };
    console.log(
        `[ServiceWorker] serverSupportMap update for '${clientApiUrl}': ${JSON.stringify(serverSupportMap[clientApiUrl])}`,
    );
}

// Ideally we'd use the `Client` interface for `client`, but since it's not available (see 'fetch' listener), we use
// unknown for now and force-cast it to something close enough later.
async function getAuthData(client: unknown): Promise<{ accessToken: string; homeserver: string }> {
    // Access tokens are encrypted at rest, so while we can grab the "access token", we'll need to do work to get the
    // real thing.
    // idbLoad is untyped; a token persisted with a pickle key is an encrypted payload, and one
    // persisted without (or written by the localStorage fallback) is a plain string.
    const storedAccessToken: string | AESEncryptedSecretStoragePayload | undefined = await idbLoad(
        "account",
        "mx_access_token",
    );

    // We need to extract a user ID and device ID from localstorage, which means calling WebPlatform for the
    // read operation. Service workers can't access localstorage.
    const { userId, deviceId, homeserver } = await askClientForUserIdParams(client);

    // ... and this is why we need the user ID and device ID: they're index keys for the pickle key table.
    const pickleKeyData = await idbLoad("pickleKey", [userId, deviceId]);
    if (pickleKeyData && (!pickleKeyData.encrypted || !pickleKeyData.iv || !pickleKeyData.cryptoKey)) {
        throw new Error("SW: Invalid pickle key loaded - ignoring");
    }

    // Finally, try decrypting the thing and return that. This may fail, but that's okay.
    try {
        if (typeof storedAccessToken === "string") {
            // Stored unencrypted, because there was no pickle key when it was persisted, so there is
            // nothing to decrypt. `tryDecryptToken` only handles encrypted payloads.
            return { accessToken: storedAccessToken, homeserver };
        }

        if (!storedAccessToken) {
            throw new Error("no access token in storage");
        }

        const pickleKey = pickleKeyData ? await buildAndEncodePickleKey(pickleKeyData, userId, deviceId) : undefined;
        if (!pickleKey) {
            // The token is encrypted and we have no key for it.
            throw new Error("no pickle key found");
        }

        const accessToken = await tryDecryptToken(pickleKey, storedAccessToken, ACCESS_TOKEN_NAME);
        return { accessToken, homeserver };
    } catch (e) {
        throw new Error("SW: Error decrypting access token.", { cause: e });
    }
}

/**
 * Inside: refresh requests in flight, per tab. A burst of media requests failing with 401 at once (e.g. the
 * avatars of a whole room list) should make the tab refresh its token once, not once per image.
 */
const refreshesInFlight = new Map<string, Promise<void>>();

/**
 * Inside: asks the tab to refresh its access token and waits until it says it is done (or gives up).
 * Never rejects: if the tab can't help, the caller just finds the same token (or none) in storage.
 */
function refreshTokenInTab(clientId: string): Promise<void> {
    let refresh = refreshesInFlight.get(clientId);
    if (!refresh) {
        refresh = (async (): Promise<void> => {
            try {
                // @ts-expect-error - service worker types are not available. See 'fetch' event handler.
                const client = await global.clients.get(clientId);
                if (client) await askClient(client, "refresh_token", 10000);
            } catch (err) {
                console.error("SW: Error asking the tab to refresh the access token.", err);
            } finally {
                refreshesInFlight.delete(clientId);
            }
        })();
        refreshesInFlight.set(clientId, refresh);
    }
    return refresh;
}

/**
 * Inside: reads the stored access token again after a refresh. The tab persists a refreshed token
 * asynchronously, so give it a moment if the first read still returns the stale one.
 */
async function waitForNewAuthData(
    client: unknown,
    staleToken: string,
): Promise<{ accessToken: string; homeserver: string }> {
    let auth = await getAuthData(client);
    for (let i = 0; i < 5 && auth.accessToken === staleToken; i++) {
        await new Promise<void>((resolve) => setTimeout(() => resolve(), 200));
        auth = await getAuthData(client);
    }
    return auth;
}

/** Inside: how long to wait for the tab to answer a "userinfo" request. */
const USERINFO_TIMEOUT_MS = 5000;

// Ideally we'd use the `Client` interface for `client`, but since it's not available (see 'fetch' listener), we use
// unknown for now and force-cast it to something close enough inside the function.
async function askClientForUserIdParams(
    client: unknown,
): Promise<{ userId: string; deviceId: string; homeserver: string }> {
    // Inside: 5 s rather than upstream's 1 s. At startup the tab is busy (initial sync, rendering) and may take
    // longer than a second to answer; timing out then sends media requests without auth, and they fail with 401.
    return askClient(client, "userinfo", USERINFO_TIMEOUT_MS);
}

async function askClient<T>(client: unknown, type: string, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
        // Dev note: this uses postMessage, which is a highly insecure channel. postMessage is typically visible to other
        // tabs, windows, browser extensions, etc, making it far from ideal for sharing sensitive information. This is
        // why our service worker calculates/decrypts the access token manually: we don't want the user's access token
        // to be available to (potentially) malicious listeners. We do require some information for that decryption to
        // work though, and request that in the least sensitive way possible.
        //
        // We could also potentially use some version of TLS to encrypt postMessage, though that feels way more involved
        // than just reading IndexedDB ourselves.

        // Avoid stalling the tab in case something goes wrong.
        const timeoutId = setTimeout(() => reject(new Error("timeout in postMessage")), timeoutMs);

        // We don't need particularly good randomness here - we just use this to generate a request ID, so we know
        // which postMessage reply is for our active request.
        const responseKey = Math.random().toString(36);

        // Add the listener first, just in case the tab is *really* fast.
        const listener = (event: MessageEvent): void => {
            if (event.data?.responseKey !== responseKey) return; // not for us
            clearTimeout(timeoutId); // do this as soon as possible, avoiding a race between resolve and reject.
            resolve(event.data); // "unblock" the remainder of the thread, if that were such a thing in JavaScript.
            global.removeEventListener("message", listener); // cleanup, since we're not going to do anything else.
        };
        global.addEventListener("message", listener);

        // Ask the tab for the information we need. This is handled by WebPlatform.
        (client as Window).postMessage({ responseKey, type });
    });
}

function fetchConfigForToken(accessToken?: string, extraHeaders: Record<string, string> = {}): RequestInit | undefined {
    if (!accessToken) {
        // no auth; Inside: but still pass e.g. `Range` on
        return Object.keys(extraHeaders).length ? { headers: extraHeaders } : undefined;
    }

    return {
        headers: {
            ...extraHeaders,
            Authorization: `Bearer ${accessToken}`,
        },
    };
}
