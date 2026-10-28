/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Inside: a cache of media responses (thumbnails and small originals) in Cache Storage, used by the
 * service worker to answer media requests cache-first, plus helpers for Range requests.
 *
 * Content behind an mxc URI never changes, so an entry never needs revalidation: it is only evicted,
 * least recently used first, once the cache grows over {@link MAX_CACHE_BYTES}. Entries are keyed by
 * the unauthenticated (v3) media URL with its query normalised, so the same thumbnail requested with
 * its parameters in another order, with `allow_redirect` or after a retry is still one entry.
 *
 * Cache Storage keeps no metadata of its own, so the sizes and last-use times live in an index stored
 * in the same cache as one JSON entry, written a moment after it changes. If the worker is stopped
 * before that, the index is rebuilt from the entries themselves the next time: the LRU order is
 * approximate, the size cap is not.
 */

import { MEDIA_CACHE_NAME, RETRY_PARAM } from "../utils/media/mediaCacheShared";

/** The cache stops growing at this size, evicting least recently used entries. */
export const MAX_CACHE_BYTES = 300 * 1024 * 1024;
/** Eviction brings the cache down to this share of the cap, so that it does not run for every new entry. */
const EVICT_TO_SHARE = 0.9;
/** Originals (downloads) up to this size are cached; thumbnails are cached whatever their size. */
export const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;
/** A sanity cap for thumbnails: a server-side "thumbnail" larger than this is not worth keeping. */
const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024;

/** Where the index lives in the cache. Never requested over the network. */
const INDEX_URL = "https://inside-media-cache.invalid/index.json";
/** Header on cached entries with the body size, used when the index has to be rebuilt. */
const SIZE_HEADER = "X-Inside-Cached-Size";
const INDEX_SAVE_DELAY_MS = 1000;

/** Query parameters that do not change the bytes returned. */
const IGNORED_PARAMS = new Set(["allow_redirect", "timeout_ms", RETRY_PARAM]);

const MEDIA_PATH = /^\/_matrix\/(?:media\/v3|client\/v1\/media)\/(download|thumbnail)\/([^/]+)\/([^/]+)(\/.*)?$/;

export interface MediaRequestInfo {
    kind: "download" | "thumbnail";
    /** The cache key: the v3 URL with ignored parameters dropped and the rest sorted. */
    key: string;
}

/** Parse a media download or thumbnail URL; null for anything else. */
export function parseMediaUrl(url: URL): MediaRequestInfo | null {
    const match = MEDIA_PATH.exec(url.pathname);
    if (!match) return null;
    const [, kind, server, mediaId, rest] = match;
    const params = [...url.searchParams.entries()]
        .filter(([name]) => !IGNORED_PARAMS.has(name))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const query = new URLSearchParams(params).toString();
    const path = `/_matrix/media/v3/${kind}/${server}/${mediaId}${kind === "download" ? (rest ?? "") : ""}`;
    return { kind: kind as MediaRequestInfo["kind"], key: `${url.origin}${path}${query ? `?${query}` : ""}` };
}

/** The URL to send to the server: without the app's retry marker. */
export function stripRetryParam(url: URL): URL {
    if (!url.searchParams.has(RETRY_PARAM)) return url;
    const stripped = new URL(url.href);
    stripped.searchParams.delete(RETRY_PARAM);
    return stripped;
}

interface IndexEntry {
    /** Body size in bytes. */
    s: number;
    /** Last use, ms since the epoch. */
    t: number;
}

/**
 * The media cache. All methods swallow storage errors (quota, private mode): the cache is an
 * optimisation, a failure must never break a media request.
 */
export class MediaCache {
    private index: Map<string, IndexEntry> | null = null;
    private loading: Promise<Map<string, IndexEntry>> | null = null;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private totalBytes = 0;

    public constructor(
        /** Read on every use, so that tests can swap it in. */
        private readonly storage: () => CacheStorage | undefined,
        private readonly now: () => number = Date.now,
        private readonly maxBytes: number = MAX_CACHE_BYTES,
    ) {}

    private async open(): Promise<Cache | null> {
        const storage = this.storage();
        if (!storage) return null;
        try {
            return await storage.open(MEDIA_CACHE_NAME);
        } catch {
            return null;
        }
    }

    private loadIndex(cache: Cache): Promise<Map<string, IndexEntry>> {
        if (this.index) return Promise.resolve(this.index);
        if (!this.loading) {
            this.loading = (async (): Promise<Map<string, IndexEntry>> => {
                const index = new Map<string, IndexEntry>();
                try {
                    const stored = await cache.match(INDEX_URL);
                    const entries: Record<string, IndexEntry> = stored ? await stored.json() : {};
                    const keys = (await cache.keys()).map((r) => r.url).filter((u) => u !== INDEX_URL);
                    for (const key of keys) {
                        let entry = entries[key];
                        if (!entry) {
                            // Cached but not in the saved index: the worker stopped before saving it.
                            const response = await cache.match(key);
                            const size = Number(response?.headers.get(SIZE_HEADER) ?? 0);
                            entry = { s: Number.isFinite(size) ? size : 0, t: 0 };
                        }
                        index.set(key, entry);
                    }
                } catch {
                    // A broken index is rebuilt from scratch on the next put.
                }
                this.totalBytes = [...index.values()].reduce((sum, e) => sum + e.s, 0);
                this.index = index;
                return index;
            })();
        }
        return this.loading;
    }

    private scheduleSave(cache: Cache): void {
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            void this.saveIndex(cache);
        }, INDEX_SAVE_DELAY_MS);
    }

    private async saveIndex(cache: Cache): Promise<void> {
        if (!this.index) return;
        try {
            await cache.put(
                INDEX_URL,
                new Response(JSON.stringify(Object.fromEntries(this.index)), {
                    headers: { "Content-Type": "application/json" },
                }),
            );
        } catch {
            // Rebuilt from the entries next time.
        }
    }

    /** The cached response for a key, if any. Counts as a use for the LRU order. */
    public async match(key: string): Promise<Response | undefined> {
        const cache = await this.open();
        if (!cache) return undefined;
        try {
            const response = await cache.match(key);
            if (!response) return undefined;
            const index = await this.loadIndex(cache);
            const entry = index.get(key);
            if (entry) {
                entry.t = this.now();
            } else {
                const size = Number(response.headers.get(SIZE_HEADER) ?? 0);
                index.set(key, { s: size, t: this.now() });
                this.totalBytes += size;
            }
            this.scheduleSave(cache);
            return response;
        } catch {
            return undefined;
        }
    }

    /**
     * Whether a response to a request of this kind should be cached. Only complete, successful
     * responses: a 504 "not yet uploaded" or a 404 can turn into the file later.
     */
    public static isCacheable(kind: MediaRequestInfo["kind"], response: Response): boolean {
        if (response.status !== 200) return false;
        const length = Number(response.headers.get("Content-Length") ?? NaN);
        if (kind === "thumbnail") return !(length > MAX_THUMBNAIL_BYTES);
        return Number.isFinite(length) && length <= MAX_ORIGINAL_BYTES;
    }

    /** Store a response body (already read) under a key, then evict down to the size cap. */
    public async put(key: string, body: Blob, headers: Headers): Promise<void> {
        const cache = await this.open();
        if (!cache) return;
        try {
            const index = await this.loadIndex(cache);
            const stored = new Headers();
            for (const name of ["Content-Type", "Content-Disposition", "Content-Security-Policy"]) {
                const value = headers.get(name);
                if (value) stored.set(name, value);
            }
            stored.set("Content-Length", String(body.size));
            stored.set(SIZE_HEADER, String(body.size));
            await cache.put(key, new Response(body, { status: 200, headers: stored }));

            const previous = index.get(key);
            if (previous) this.totalBytes -= previous.s;
            index.set(key, { s: body.size, t: this.now() });
            this.totalBytes += body.size;
            if (this.totalBytes > this.maxBytes) await this.evict(cache, index);
            this.scheduleSave(cache);
        } catch {
            // Quota exceeded or storage unavailable: just don't cache.
        }
    }

    private async evict(cache: Cache, index: Map<string, IndexEntry>): Promise<void> {
        const oldestFirst = [...index.entries()].sort(([, a], [, b]) => a.t - b.t);
        for (const [key, entry] of oldestFirst) {
            if (this.totalBytes <= this.maxBytes * EVICT_TO_SHARE) break;
            index.delete(key);
            this.totalBytes -= entry.s;
            try {
                await cache.delete(key);
            } catch {
                // Gone already, or storage unavailable.
            }
        }
    }

    /** Total bytes the index knows about. For tests. */
    public get size(): number {
        return this.totalBytes;
    }
}

/** A single byte range from a `Range` header, or null when there is none or it can't be served. */
export interface ByteRange {
    start: number;
    /** Inclusive; undefined for "to the end". */
    end?: number;
}

/**
 * Parse a `Range` header with a single byte range (all a media element sends). Suffix ranges
 * ("bytes=-500") and multiple ranges are not supported and return null: the full response is fine then.
 */
export function parseRange(header: string | null | undefined): ByteRange | null {
    if (!header) return null;
    const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
    if (!match) return null;
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : undefined;
    if (end !== undefined && end < start) return null;
    return { start, end };
}

function partialHeaders(source: Headers, start: number, end: number, total: number): Headers {
    const headers = new Headers();
    for (const name of ["Content-Type", "Content-Disposition"]) {
        const value = source.get(name);
        if (value) headers.set(name, value);
    }
    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
    headers.set("Content-Length", String(end - start + 1));
    return headers;
}

function unsatisfiable(total: number): Response {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
}

/** Answer a Range request from a complete cached body. */
export async function rangeFromCached(cached: Response, range: ByteRange): Promise<Response> {
    const blob = await cached.blob();
    const total = blob.size;
    if (range.start >= total) return unsatisfiable(total);
    const end = Math.min(range.end ?? total - 1, total - 1);
    return new Response(blob.slice(range.start, end + 1), {
        status: 206,
        headers: partialHeaders(cached.headers, range.start, end, total),
    });
}

/**
 * Turn a complete (200) network response into the 206 a Range request expects. Synapse ignores
 * `Range`, and Safari will not play a video without 206 answers. The bytes before the range still
 * come over the network (they are skipped here), and reading stops, cancelling the download, once
 * the range is complete. Returns the response unchanged when its length is unknown.
 */
export function rangeFromFullResponse(response: Response, range: ByteRange): Response {
    const total = Number(response.headers.get("Content-Length") ?? NaN);
    if (!Number.isFinite(total) || !response.body) return response;
    if (range.start >= total) {
        void response.body.cancel();
        return unsatisfiable(total);
    }
    const end = Math.min(range.end ?? total - 1, total - 1);
    const reader = response.body.getReader();
    let position = 0; // offset in the full body of the next byte read
    const body = new ReadableStream<Uint8Array>({
        async pull(controller): Promise<void> {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    controller.close();
                    return;
                }
                const chunkStart = position;
                position += value.byteLength;
                if (position <= range.start) continue; // still before the range
                const from = Math.max(range.start - chunkStart, 0);
                const to = Math.min(end + 1 - chunkStart, value.byteLength);
                if (to <= from) continue; // past the range (the body is longer than it said)
                controller.enqueue(value.subarray(from, to));
                if (position > end && end < total - 1) {
                    // Done with the range before the end of the file: stop the download.
                    controller.close();
                    void reader.cancel();
                }
                // A range to the end is closed by the next read (done), so the body is read to the end.
                return;
            }
        },
        cancel(reason): Promise<void> {
            return reader.cancel(reason);
        },
    });
    return new Response(body, { status: 206, headers: partialHeaders(response.headers, range.start, end, total) });
}

/** Whether a response is Synapse's "media not yet uploaded" (MSC2246) error. */
export async function isNotYetUploaded(response: Response): Promise<boolean> {
    if (response.status !== 504) return false;
    try {
        const body = await response.clone().json();
        return body?.errcode === "M_NOT_YET_UPLOADED";
    } catch {
        return false;
    }
}
