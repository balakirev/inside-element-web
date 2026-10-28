/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MatrixClient, Method, MediaPrefix } from "matrix-js-sdk/src/matrix";

import { createMediaUri, serverSupportsAsyncUploads, uploadToMediaUri } from "./asyncMediaUpload";

class FakeXhr {
    public static instances: FakeXhr[] = [];
    public method?: string;
    public url?: string;
    public headers: Record<string, string> = {};
    public body?: unknown;
    public status = 0;
    public responseText = "";
    public aborted = false;
    public upload: { onprogress?: (ev: ProgressEvent) => void } = {};
    public onload?: () => void;
    public onerror?: () => void;
    public onabort?: () => void;

    public constructor() {
        FakeXhr.instances.push(this);
    }
    public open(method: string, url: string): void {
        this.method = method;
        this.url = url;
    }
    public setRequestHeader(name: string, value: string): void {
        this.headers[name] = value;
    }
    public send(body: unknown): void {
        this.body = body;
    }
    public abort(): void {
        this.aborted = true;
        this.onabort?.();
    }
    public respond(status: number, body: object = {}): void {
        this.status = status;
        this.responseText = JSON.stringify(body);
        this.onload?.();
    }
}

function makeClient(): MatrixClient {
    return {
        getHomeserverUrl: () => "https://lobby.example/",
        getAccessToken: vi.fn(() => "token-1"),
        isVersionSupported: vi.fn(async (version: string) => version === "v1.7"),
        http: { authedRequest: vi.fn() },
    } as unknown as MatrixClient;
}

describe("asyncMediaUpload", () => {
    beforeEach(() => {
        FakeXhr.instances = [];
        vi.stubGlobal("XMLHttpRequest", FakeXhr);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("asks the server once whether it takes asynchronous uploads (Matrix 1.7)", async () => {
        const client = makeClient();
        expect(await serverSupportsAsyncUploads(client)).toBe(true);
        expect(await serverSupportsAsyncUploads(client)).toBe(true);
        expect(client.isVersionSupported).toHaveBeenCalledTimes(1);
        expect(client.isVersionSupported).toHaveBeenCalledWith("v1.7");

        const old = makeClient();
        vi.mocked(old.isVersionSupported).mockRejectedValue(new Error("offline"));
        expect(await serverSupportsAsyncUploads(old)).toBe(false);
    });

    it("reserves an mxc URI", async () => {
        const client = makeClient();
        vi.mocked(client.http.authedRequest).mockResolvedValue({
            content_uri: "mxc://lobby.example/abc",
            unused_expires_at: 123,
        });

        expect(await createMediaUri(client)).toEqual({ contentUri: "mxc://lobby.example/abc", unusedExpiresAt: 123 });
        expect(client.http.authedRequest).toHaveBeenCalledWith(Method.Post, "/create", undefined, undefined, {
            prefix: MediaPrefix.V1,
        });
    });

    it("rejects a response without a URI", async () => {
        const client = makeClient();
        vi.mocked(client.http.authedRequest).mockResolvedValue({});
        await expect(createMediaUri(client)).rejects.toThrow();
    });

    it("puts the file to the reserved URI with progress", async () => {
        const client = makeClient();
        const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });
        const progress = vi.fn();

        const done = uploadToMediaUri(client, "mxc://lobby.example/abc", file, {
            name: "photo.jpg",
            progressHandler: progress,
        });
        const [xhr] = FakeXhr.instances;
        expect(xhr.method).toBe("PUT");
        expect(xhr.url).toBe("https://lobby.example/_matrix/media/v3/upload/lobby.example/abc?filename=photo.jpg");
        expect(xhr.headers).toEqual({ "Authorization": "Bearer token-1", "Content-Type": "image/jpeg" });
        expect(xhr.body).toBe(file);
        xhr.upload.onprogress!({ loaded: 3, total: 5 } as ProgressEvent);
        expect(progress).toHaveBeenCalledWith({ loaded: 3, total: 5 });

        xhr.respond(200);
        await expect(done).resolves.toBeUndefined();
    });

    it("stops on abort", async () => {
        const client = makeClient();
        const abortController = new AbortController();
        const done = uploadToMediaUri(client, "mxc://lobby.example/abc", new Blob(["x"]), { abortController });

        abortController.abort();

        await expect(done).rejects.toMatchObject({ name: "AbortError" });
        expect(FakeXhr.instances[0].aborted).toBe(true);
    });

    it("does not start when already aborted", async () => {
        const abortController = new AbortController();
        abortController.abort();
        await expect(
            uploadToMediaUri(makeClient(), "mxc://lobby.example/abc", new Blob(["x"]), { abortController }),
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(FakeXhr.instances).toHaveLength(0);
    });

    it("reports a server error as a MatrixError", async () => {
        const done = uploadToMediaUri(makeClient(), "mxc://lobby.example/abc", new Blob(["x"]));
        FakeXhr.instances[0].respond(409, {
            errcode: "M_CANNOT_OVERWRITE_MEDIA",
            error: "Media ID already has content",
        });
        await expect(done).rejects.toMatchObject({ errcode: "M_CANNOT_OVERWRITE_MEDIA", httpStatus: 409 });
    });

    it("refreshes an expired token once and tries again", async () => {
        const client = makeClient();
        vi.mocked(client.http.authedRequest).mockImplementation(async () => {
            vi.mocked(client.getAccessToken).mockReturnValue("token-2");
            return {};
        });

        const done = uploadToMediaUri(client, "mxc://lobby.example/abc", new Blob(["x"]));
        FakeXhr.instances[0].respond(401, { errcode: "M_UNKNOWN_TOKEN", error: "expired" });
        await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(2));

        expect(client.http.authedRequest).toHaveBeenCalledWith(Method.Get, "/account/whoami");
        expect(FakeXhr.instances[1].headers.Authorization).toBe("Bearer token-2");
        FakeXhr.instances[1].respond(200);
        await expect(done).resolves.toBeUndefined();
    });

    it("throws on a malformed URI", async () => {
        await expect(uploadToMediaUri(makeClient(), "https://nope", new Blob(["x"]))).rejects.toThrow("Not an mxc URI");
    });
});
