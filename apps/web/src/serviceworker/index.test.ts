/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { encodeUnpaddedBase64 } from "matrix-js-sdk/src/matrix";

import * as StorageAccess from "../utils/StorageAccess";
import { persistTokens } from "../utils/tokens/tokens";
import { encryptPickleKey } from "../utils/tokens/pickling";
import { MemoryCacheStorage } from "../test/test-utils/MemoryCacheStorage";

const USER_ID = "@alice:example.com";
const DEVICE_ID = "ABCDEFG";

type Listener = (event: any) => void;

/**
 * The listeners the service worker registered on the global scope, keyed by event type.
 *
 * Everything below the `fetch` handler is module-private, so driving that handler is the only way
 * into the token-reading code. We capture the registrations rather than dispatching real events so
 * that the `message` exchange with the "tab" can be answered synchronously.
 */
const listeners = new Map<string, Set<Listener>>();

vi.spyOn(global, "addEventListener").mockImplementation(((type: string, listener: Listener) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(listener);
}) as typeof global.addEventListener);

vi.spyOn(global, "removeEventListener").mockImplementation(((type: string, listener: Listener) => {
    listeners.get(type)?.delete(listener);
}) as typeof global.removeEventListener);

// Importing the service worker registers its listeners, via the spies above.
await import("./index");

function emit(type: string, event: unknown): void {
    for (const listener of listeners.get(type) ?? []) {
        listener(event);
    }
}

describe("serviceworker", () => {
    /** Stand-in for IndexedDB, keyed by table and then by key. */
    let storage: Record<string, Record<string, unknown>>;
    let fetchSpy: ReturnType<typeof vi.fn>;
    /**
     * A different homeserver for each test: the module caches which origins support authenticated
     * media for two hours, and there is no way to reach into that cache to clear it.
     */
    let homeserver: string;
    let mediaUrl: string;
    let homeserverCount = 0;

    /** Stands in for the tab which the service worker asks for the user ID and device ID. */
    const tab = {
        postMessage: vi.fn(({ responseKey }: { responseKey: string; type?: string }) => {
            emit("message", { data: { responseKey, userId: USER_ID, deviceId: DEVICE_ID, homeserver } });
        }),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        storage = {};
        vi.spyOn(StorageAccess, "idbSave").mockImplementation(async (table, key, data) => {
            storage[table] = { ...storage[table], [String(key)]: data };
        });
        vi.spyOn(StorageAccess, "idbLoad").mockImplementation(async (table, key) => storage[table]?.[String(key)]);

        homeserver = `https://hs-${++homeserverCount}.example.com`;
        mediaUrl = `${homeserver}/_matrix/media/v3/download/example.com/abc123`;

        fetchSpy = vi.fn(async (input: URL | string) => {
            if (input.toString().endsWith("/_matrix/client/versions")) {
                return { json: async () => ({ versions: ["v1.11"] }) };
            }
            return new Response("media");
        });
        vi.stubGlobal("fetch", fetchSpy);
        vi.stubGlobal("clients", { get: vi.fn().mockResolvedValue(tab) });

        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    /**
     * Drive the module's `fetch` handler for a media download, and return the request it ultimately
     * made to the network.
     */
    async function interceptMediaRequest(): Promise<{ url: string; init?: RequestInit }> {
        let responded: Promise<Response> | undefined;
        emit("fetch", {
            request: { method: "GET", url: mediaUrl },
            clientId: "client-1",
            respondWith: (response: Promise<Response>) => {
                responded = response;
            },
        });

        expect(responded).toBeDefined();
        await responded;

        const [url, init] = fetchSpy.mock.calls.at(-1)!;
        return { url: String(url), init };
    }

    /** The error which the last failed rewrite attempt reported, unwrapped from its wrapper. */
    function lastRewriteFailureCause(): unknown {
        const [, error] = vi.mocked(console.error).mock.calls.at(-1)!;
        return (error as Error).cause;
    }

    /** Store a pickle key for our user/device, and return it in the form callers use to encrypt. */
    async function storePickleKey(): Promise<string> {
        const rawPickleKey = new Uint8Array(32);
        crypto.getRandomValues(rawPickleKey);
        await StorageAccess.idbSave(
            "pickleKey",
            [USER_ID, DEVICE_ID],
            (await encryptPickleKey(rawPickleKey, USER_ID, DEVICE_ID))!,
        );
        return encodeUnpaddedBase64(rawPickleKey);
    }

    it("passes the request through unauthenticated when there is no access token stored", async () => {
        const { url, init } = await interceptMediaRequest();

        // Unable to authenticate, we must leave the URL alone rather than rewrite it to an endpoint
        // which requires the token we don't have.
        expect(url).toEqual(mediaUrl);
        expect(init).toBeUndefined();
        expect(lastRewriteFailureCause()).toMatchObject({ message: "no access token in storage" });
    });

    it("authenticates the request with an access token which was stored encrypted", async () => {
        await persistTokens(await storePickleKey(), { accessToken: "encrypted_token" });

        const { url, init } = await interceptMediaRequest();

        expect(url).toEqual(`${homeserver}/_matrix/client/v1/media/download/example.com/abc123`);
        expect(init).toEqual({ headers: { Authorization: `Bearer encrypted_token` } });
    });

    it("authenticates the request with an access token which was stored unencrypted", async () => {
        // A session which was set up while no pickle key was available stores the token as a plain
        // string, so there is nothing to decrypt and no pickle key needed to read it.
        await persistTokens(undefined, { accessToken: "plain_text_token" });

        const { url, init } = await interceptMediaRequest();

        expect(url).toEqual(`${homeserver}/_matrix/client/v1/media/download/example.com/abc123`);
        expect(init).toEqual({ headers: { Authorization: `Bearer plain_text_token` } });
    });

    it("passes the request through unauthenticated when the token is encrypted but the pickle key is missing", async () => {
        // Encrypt the token, then remove the pickle key from  storage, as happens when IndexedDB
        // loses the pickle key table but not the account table.
        const pickleKey = await storePickleKey();
        delete storage["pickleKey"];
        await persistTokens(pickleKey, { accessToken: "encrypted_token" });

        const { url, init } = await interceptMediaRequest();

        expect(url).toEqual(mediaUrl);
        expect(init).toBeUndefined();
        expect(lastRewriteFailureCause()).toMatchObject({ message: "no pickle key found" });
    });

    describe("when the stored access token has expired", () => {
        beforeEach(async () => {
            await persistTokens(undefined, { accessToken: "stale_token" });
            fetchSpy.mockImplementation(async (input: URL | string, init?: RequestInit) => {
                if (input.toString().endsWith("/_matrix/client/versions")) {
                    return { json: async () => ({ versions: ["v1.11"] }) };
                }
                const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
                return new Response("media", { status: auth === "Bearer stale_token" ? 401 : 200 });
            });
        });

        it("asks the tab to refresh the token and retries with the new one", async () => {
            tab.postMessage.mockImplementation(({ responseKey, type }: { responseKey: string; type?: string }) => {
                // The tab refreshes and persists the token before it replies.
                const persisted =
                    type === "refresh_token" ? persistTokens(undefined, { accessToken: "fresh_token" }) : null;
                void Promise.resolve(persisted).then(() =>
                    emit("message", { data: { responseKey, userId: USER_ID, deviceId: DEVICE_ID, homeserver } }),
                );
            });

            const { init } = await interceptMediaRequest();

            expect(tab.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "refresh_token" }));
            expect(init).toEqual({ headers: { Authorization: `Bearer fresh_token` } });
        });

        it("returns the 401 when the tab could not refresh the token", async () => {
            tab.postMessage.mockImplementation(({ responseKey }: { responseKey: string }) => {
                emit("message", { data: { responseKey, userId: USER_ID, deviceId: DEVICE_ID, homeserver } });
            });

            let responded: Promise<Response> | undefined;
            emit("fetch", {
                request: { method: "GET", url: mediaUrl },
                clientId: "client-1",
                respondWith: (response: Promise<Response>) => {
                    responded = response;
                },
            });

            expect((await responded!).status).toBe(401);
        });
    });
    it("waits more than a second for a busy tab to answer", async () => {
        await persistTokens(undefined, { accessToken: "plain_text_token" });
        tab.postMessage.mockImplementation(({ responseKey }: { responseKey: string }) => {
            // At startup the tab may be busy and take a while to reply.
            setTimeout(
                () => emit("message", { data: { responseKey, userId: USER_ID, deviceId: DEVICE_ID, homeserver } }),
                1500,
            );
        });

        const { url, init } = await interceptMediaRequest();

        expect(url).toEqual(`${homeserver}/_matrix/client/v1/media/download/example.com/abc123`);
        expect(init).toEqual({ headers: { Authorization: `Bearer plain_text_token` } });
    });

    describe("when the request went out without an access token and was rejected", () => {
        /** Media requests made to the network (not `/versions`), as [url, init]. */
        function mediaFetches(): [string, RequestInit | undefined][] {
            return fetchSpy.mock.calls
                .filter(([input]) => !String(input).endsWith("/_matrix/client/versions"))
                .map(([input, init]) => [String(input), init]);
        }

        beforeEach(() => {
            fetchSpy.mockImplementation(async (input: URL | string, init?: RequestInit) => {
                if (input.toString().endsWith("/_matrix/client/versions")) {
                    return { json: async () => ({ versions: ["v1.11"] }) };
                }
                const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
                return new Response("media", { status: auth === "Bearer good_token" ? 200 : 401 });
            });
        });

        it("asks the tab again, refreshes the token and retries once with auth", async () => {
            await persistTokens(undefined, { accessToken: "good_token" });
            let userinfoRequests = 0;
            tab.postMessage.mockImplementation(({ responseKey, type }: { responseKey: string; type?: string }) => {
                // The first time, the tab isn't ready yet: it has no client, so no homeserver to report.
                const ready = type !== "userinfo" || ++userinfoRequests > 1;
                emit("message", {
                    data: { responseKey, userId: USER_ID, deviceId: DEVICE_ID, homeserver: ready ? homeserver : null },
                });
            });

            const { url, init } = await interceptMediaRequest();

            expect(tab.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "refresh_token" }));
            expect(mediaFetches()).toEqual([
                [mediaUrl, undefined],
                [`${homeserver}/_matrix/client/v1/media/download/example.com/abc123`, expect.anything()],
            ]);
            expect(url).toEqual(`${homeserver}/_matrix/client/v1/media/download/example.com/abc123`);
            expect(init).toEqual({ headers: { Authorization: `Bearer good_token` } });
        });

        it("returns the 401 without another request when there is still no token", async () => {
            let responded: Promise<Response> | undefined;
            emit("fetch", {
                request: { method: "GET", url: mediaUrl },
                clientId: "client-1",
                respondWith: (response: Promise<Response>) => {
                    responded = response;
                },
            });

            expect((await responded!).status).toBe(401);
            expect(tab.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "refresh_token" }));
            expect(mediaFetches()).toEqual([[mediaUrl, undefined]]);
        });

        it("asks the tab to refresh only once for a burst of rejected requests", async () => {
            await persistTokens(undefined, { accessToken: "good_token" });
            let tabReady = false;
            const pendingRefreshes: (() => void)[] = [];
            tab.postMessage.mockImplementation(({ responseKey, type }: { responseKey: string; type?: string }) => {
                const reply = (): void =>
                    emit("message", {
                        data: {
                            responseKey,
                            userId: USER_ID,
                            deviceId: DEVICE_ID,
                            homeserver: tabReady ? homeserver : null,
                        },
                    });
                if (type === "refresh_token") {
                    pendingRefreshes.push(reply);
                } else {
                    reply();
                }
            });

            const responses: Promise<Response>[] = [];
            for (let i = 0; i < 3; i++) {
                emit("fetch", {
                    request: { method: "GET", url: mediaUrl },
                    clientId: "client-1",
                    respondWith: (response: Promise<Response>) => responses.push(response),
                });
            }
            await vi.waitFor(() => expect(pendingRefreshes).toHaveLength(1));
            tabReady = true;
            pendingRefreshes[0]();

            const statuses = (await Promise.all(responses)).map((r) => r.status);
            expect(statuses).toEqual([200, 200, 200]);
            expect(tab.postMessage.mock.calls.filter(([msg]) => msg.type === "refresh_token")).toHaveLength(1);
        });
    });
    describe("media cache, uploads in progress and ranges (Inside)", () => {
        let cacheStorage: MemoryCacheStorage;

        /** Media requests made to the network (not `/versions`), as [url, init]. */
        function mediaFetches(): [string, RequestInit | undefined][] {
            return fetchSpy.mock.calls
                .filter(([input]) => !String(input).endsWith("/_matrix/client/versions"))
                .map(([input, init]) => [String(input), init]);
        }

        /** Drive the fetch handler for a request and return its response. */
        async function request(url: string, headers: Record<string, string> = {}): Promise<Response> {
            let responded: Promise<Response> | undefined;
            const waits: Promise<unknown>[] = [];
            emit("fetch", {
                request: { method: "GET", url, headers: new Headers(headers) },
                clientId: "client-1",
                respondWith: (response: Promise<Response>) => {
                    responded = response;
                },
                waitUntil: (promise: Promise<unknown>) => waits.push(promise),
            });
            const response = await responded!;
            // Let the cache write finish: the page has the response by now, the worker keeps caching.
            await response.clone().arrayBuffer();
            await Promise.all(waits);
            return response;
        }

        beforeEach(async () => {
            cacheStorage = new MemoryCacheStorage();
            vi.stubGlobal("caches", cacheStorage);
            await persistTokens(undefined, { accessToken: "token" });
        });

        it("answers a thumbnail from the cache the second time, without the network", async () => {
            const thumbUrl = `${homeserver}/_matrix/media/v3/thumbnail/example.com/abc123?width=320&height=240&method=scale&allow_redirect=true`;
            fetchSpy.mockImplementation(async (input: URL | string) => {
                if (input.toString().endsWith("/_matrix/client/versions")) {
                    return { json: async () => ({ versions: ["v1.11"] }) };
                }
                return new Response("jpeg", { headers: { "Content-Type": "image/jpeg" } });
            });

            expect(await (await request(thumbUrl)).text()).toBe("jpeg");
            const again = await request(`${thumbUrl}&inside_retry=1`);

            expect(await again.text()).toBe("jpeg");
            expect(again.headers.get("Content-Type")).toBe("image/jpeg");
            expect(mediaFetches()).toHaveLength(1);
        });

        it("does not cache errors", async () => {
            fetchSpy.mockImplementation(async (input: URL | string) => {
                if (input.toString().endsWith("/_matrix/client/versions")) {
                    return { json: async () => ({ versions: ["v1.11"] }) };
                }
                return new Response("{}", { status: 404 });
            });

            await request(mediaUrl);
            await request(mediaUrl);

            expect(mediaFetches()).toHaveLength(2);
        });

        it("keeps asking for a file which is still being uploaded, with timeout_ms", async () => {
            let calls = 0;
            fetchSpy.mockImplementation(async (input: URL | string) => {
                if (input.toString().endsWith("/_matrix/client/versions")) {
                    return { json: async () => ({ versions: ["v1.11"] }) };
                }
                if (++calls === 1) {
                    return new Response(JSON.stringify({ errcode: "M_NOT_YET_UPLOADED" }), { status: 504 });
                }
                return new Response("media", { headers: { "Content-Length": "5" } });
            });

            const response = await request(mediaUrl);

            expect(response.status).toBe(200);
            expect(mediaFetches().map(([url]) => url)).toEqual([
                `${homeserver}/_matrix/client/v1/media/download/example.com/abc123`,
                `${homeserver}/_matrix/client/v1/media/download/example.com/abc123?timeout_ms=60000`,
            ]);
        });

        it("answers at once when asked not to wait", async () => {
            fetchSpy.mockImplementation(async (input: URL | string) => {
                if (input.toString().endsWith("/_matrix/client/versions")) {
                    return { json: async () => ({ versions: ["v1.11"] }) };
                }
                return new Response(JSON.stringify({ errcode: "M_NOT_YET_UPLOADED" }), { status: 504 });
            });

            const response = await request(mediaUrl, { "X-Inside-No-Wait": "1" });

            expect(response.status).toBe(504);
            expect(mediaFetches()).toHaveLength(1);
        });

        it("passes Range on and answers 206 when the server sends the whole file", async () => {
            fetchSpy.mockImplementation(async (input: URL | string) => {
                if (input.toString().endsWith("/_matrix/client/versions")) {
                    return { json: async () => ({ versions: ["v1.11"] }) };
                }
                return new Response("0123456789", {
                    headers: { "Content-Type": "video/mp4", "Content-Length": "10" },
                });
            });

            const response = await request(mediaUrl, { Range: "bytes=2-4" });

            expect(response.status).toBe(206);
            expect(response.headers.get("Content-Range")).toBe("bytes 2-4/10");
            expect(await response.text()).toBe("234");
            expect(mediaFetches()[0][1]).toEqual({ headers: { Range: "bytes=2-4", Authorization: "Bearer token" } });
        });

        it("does not cache a video the page stopped reading (metadata only)", async () => {
            fetchSpy.mockImplementation(async (input: URL | string) => {
                if (input.toString().endsWith("/_matrix/client/versions")) {
                    return { json: async () => ({ versions: ["v1.11"] }) };
                }
                return new Response("0123456789", {
                    headers: { "Content-Type": "video/mp4", "Content-Length": "10" },
                });
            });

            let responded: Promise<Response> | undefined;
            emit("fetch", {
                request: { method: "GET", url: mediaUrl, headers: new Headers({ Range: "bytes=0-" }) },
                clientId: "client-1",
                respondWith: (response: Promise<Response>) => {
                    responded = response;
                },
            });
            await (await responded!).body!.cancel();
            await request(mediaUrl, { Range: "bytes=0-" });

            expect(mediaFetches()).toHaveLength(2);
        });

        it("serves ranges of a cached video from the cache", async () => {
            fetchSpy.mockImplementation(async (input: URL | string) => {
                if (input.toString().endsWith("/_matrix/client/versions")) {
                    return { json: async () => ({ versions: ["v1.11"] }) };
                }
                return new Response("0123456789", {
                    headers: { "Content-Type": "video/mp4", "Content-Length": "10" },
                });
            });

            await request(mediaUrl, { Range: "bytes=0-" });
            const seek = await request(mediaUrl, { Range: "bytes=7-" });

            expect(seek.status).toBe(206);
            expect(await seek.text()).toBe("789");
            expect(mediaFetches()).toHaveLength(1);
        });
    });
});
