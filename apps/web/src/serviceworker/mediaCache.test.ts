/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, vi, afterEach } from "vitest";

import {
    isNotYetUploaded,
    MAX_ORIGINAL_BYTES,
    MediaCache,
    parseMediaUrl,
    parseRange,
    rangeFromCached,
    rangeFromFullResponse,
    stripRetryParam,
} from "./mediaCache";
import { MemoryCacheStorage } from "../test/test-utils/MemoryCacheStorage";

const ORIGIN = "https://hs.example.com";

describe("parseMediaUrl", () => {
    it("keys thumbnails by the v3 URL with sorted parameters, without the ones that don't change the bytes", () => {
        const a = parseMediaUrl(
            new URL(
                `${ORIGIN}/_matrix/media/v3/thumbnail/example.com/abc?width=640&height=480&method=scale&allow_redirect=true`,
            ),
        );
        const b = parseMediaUrl(
            new URL(
                `${ORIGIN}/_matrix/client/v1/media/thumbnail/example.com/abc?method=scale&height=480&width=640&inside_retry=2&timeout_ms=60000`,
            ),
        );
        expect(a).toEqual({
            kind: "thumbnail",
            key: `${ORIGIN}/_matrix/media/v3/thumbnail/example.com/abc?height=480&method=scale&width=640`,
        });
        expect(b).toEqual(a);
    });

    it("keeps the file name of downloads", () => {
        expect(parseMediaUrl(new URL(`${ORIGIN}/_matrix/media/v3/download/example.com/abc/plan.pdf`))).toEqual({
            kind: "download",
            key: `${ORIGIN}/_matrix/media/v3/download/example.com/abc/plan.pdf`,
        });
    });

    it("ignores other URLs", () => {
        expect(parseMediaUrl(new URL(`${ORIGIN}/_matrix/media/v3/preview_url?url=x`))).toBeNull();
        expect(parseMediaUrl(new URL(`${ORIGIN}/_matrix/client/v3/sync`))).toBeNull();
    });
});

describe("stripRetryParam", () => {
    it("drops the app's retry marker only", () => {
        expect(stripRetryParam(new URL(`${ORIGIN}/x?width=1&inside_retry=3`)).href).toBe(`${ORIGIN}/x?width=1`);
    });
});

describe("MediaCache", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    const ok = (length?: number): Response =>
        new Response("x", { status: 200, headers: length === undefined ? {} : { "Content-Length": String(length) } });

    it("caches successful thumbnails and small originals only", () => {
        expect(MediaCache.isCacheable("thumbnail", ok())).toBe(true);
        expect(MediaCache.isCacheable("thumbnail", new Response("{}", { status: 504 }))).toBe(false);
        expect(MediaCache.isCacheable("thumbnail", new Response("{}", { status: 404 }))).toBe(false);
        expect(MediaCache.isCacheable("download", ok(1024))).toBe(true);
        expect(MediaCache.isCacheable("download", ok(MAX_ORIGINAL_BYTES + 1))).toBe(false);
        expect(MediaCache.isCacheable("download", ok())).toBe(false);
        expect(MediaCache.isCacheable("download", new Response("x", { status: 206 }))).toBe(false);
    });

    it("stores and returns entries with their type", async () => {
        const storage = new MemoryCacheStorage();
        const cache = new MediaCache(() => storage as unknown as CacheStorage);
        await cache.put("k1", new Blob(["hello"]), new Headers({ "Content-Type": "image/jpeg", "X-Other": "1" }));

        const hit = await cache.match("k1");
        expect(hit?.status).toBe(200);
        expect(hit?.headers.get("Content-Type")).toBe("image/jpeg");
        expect(hit?.headers.get("X-Other")).toBeNull();
        expect(await hit?.text()).toBe("hello");
        expect(await cache.match("k2")).toBeUndefined();
    });

    it("evicts the least recently used entries over the size cap", async () => {
        let now = 1000;
        const storage = new MemoryCacheStorage();
        const cache = new MediaCache(
            () => storage as unknown as CacheStorage,
            () => now,
            10,
        );
        await cache.put("a", new Blob(["aaaa"]), new Headers());
        now++;
        await cache.put("b", new Blob(["bbbb"]), new Headers());
        now++;
        await cache.match("a"); // a is now newer than b
        now++;
        await cache.put("c", new Blob(["cccc"]), new Headers()); // 12 bytes > 10: evict b

        expect(await cache.match("b")).toBeUndefined();
        expect(await cache.match("a")).toBeDefined();
        expect(await cache.match("c")).toBeDefined();
        expect(cache.size).toBe(8);
    });

    it("rebuilds the index from the entries after the worker restarted", async () => {
        const storage = new MemoryCacheStorage();
        await new MediaCache(() => storage as unknown as CacheStorage).put("a", new Blob(["aaaa"]), new Headers());

        // No index was saved (the save is deferred); a new worker finds the entry and its size anyway.
        const restarted = new MediaCache(() => storage as unknown as CacheStorage);
        expect(await restarted.match("a")).toBeDefined();
        expect(restarted.size).toBe(4);
    });

    it("saves the index a moment after a change", async () => {
        vi.useFakeTimers();
        const storage = new MemoryCacheStorage();
        const cache = new MediaCache(() => storage as unknown as CacheStorage);
        await cache.put("a", new Blob(["aaaa"]), new Headers());
        await vi.advanceTimersByTimeAsync(1000);

        const cacheEntries = [...storage.caches.values()][0].entries;
        const index = [...cacheEntries.entries()].find(([url]) => url.includes("index.json"));
        expect(index).toBeDefined();
        expect(JSON.parse(await index![1].body.text())).toEqual({ a: { s: 4, t: expect.any(Number) } });
    });

    it("does nothing without Cache Storage", async () => {
        const cache = new MediaCache(() => undefined);
        await cache.put("a", new Blob(["a"]), new Headers());
        expect(await cache.match("a")).toBeUndefined();
    });
});

describe("ranges", () => {
    it("parses single byte ranges", () => {
        expect(parseRange("bytes=0-")).toEqual({ start: 0, end: undefined });
        expect(parseRange("bytes=10-19")).toEqual({ start: 10, end: 19 });
        expect(parseRange("bytes=-500")).toBeNull();
        expect(parseRange("bytes=0-1,5-6")).toBeNull();
        expect(parseRange("bytes=9-3")).toBeNull();
        expect(parseRange(null)).toBeNull();
    });

    it("answers a range from a cached file", async () => {
        const cached = new Response("0123456789", { headers: { "Content-Type": "video/mp4" } });
        const response = await rangeFromCached(cached, { start: 2, end: 4 });

        expect(response.status).toBe(206);
        expect(response.headers.get("Content-Range")).toBe("bytes 2-4/10");
        expect(response.headers.get("Content-Length")).toBe("3");
        expect(response.headers.get("Content-Type")).toBe("video/mp4");
        expect(await response.text()).toBe("234");
    });

    it("answers 416 for a range past the end", async () => {
        const response = await rangeFromCached(new Response("0123"), { start: 10 });
        expect(response.status).toBe(416);
        expect(response.headers.get("Content-Range")).toBe("bytes */4");
    });

    /** A 200 response arriving in chunks, recording whether it was cancelled. */
    function chunkedResponse(chunks: string[]): { response: Response; cancelled: () => boolean } {
        let cancelled = false;
        let i = 0;
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
            pull(controller): void {
                if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
                else controller.close();
            },
            cancel(): void {
                cancelled = true;
            },
        });
        const length = chunks.join("").length;
        return {
            response: new Response(body, { status: 200, headers: { "Content-Length": String(length) } }),
            cancelled: () => cancelled,
        };
    }

    it("turns a full response into the requested range, stopping the download once it is complete", async () => {
        const { response: full, cancelled } = chunkedResponse(["0123", "4567", "89ab", "cdef"]);
        const response = rangeFromFullResponse(full, { start: 3, end: 9 });

        expect(response.status).toBe(206);
        expect(response.headers.get("Content-Range")).toBe("bytes 3-9/16");
        expect(response.headers.get("Accept-Ranges")).toBe("bytes");
        expect(await response.text()).toBe("3456789");
        expect(cancelled()).toBe(true);
    });

    it("streams an open range to the end", async () => {
        const { response: full } = chunkedResponse(["0123", "4567"]);
        const response = rangeFromFullResponse(full, { start: 5 });
        expect(response.headers.get("Content-Range")).toBe("bytes 5-7/8");
        expect(await response.text()).toBe("567");
    });

    it("leaves a response of unknown length alone", () => {
        const full = new Response(new ReadableStream(), { status: 200 });
        expect(rangeFromFullResponse(full, { start: 1 })).toBe(full);
    });
});

describe("isNotYetUploaded", () => {
    it("recognises Synapse's 504 M_NOT_YET_UPLOADED", async () => {
        const pending = new Response(JSON.stringify({ errcode: "M_NOT_YET_UPLOADED" }), { status: 504 });
        expect(await isNotYetUploaded(pending)).toBe(true);
        // The body is still readable afterwards.
        expect((await pending.json()).errcode).toBe("M_NOT_YET_UPLOADED");
        expect(await isNotYetUploaded(new Response("gateway timeout", { status: 504 }))).toBe(false);
        expect(await isNotYetUploaded(new Response("{}", { status: 404 }))).toBe(false);
    });
});
