/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/** A Cache Storage stand-in keeping responses in memory. */
export class MemoryCacheStorage {
    public readonly caches = new Map<string, MemoryCache>();

    public async open(name: string): Promise<MemoryCache> {
        if (!this.caches.has(name)) this.caches.set(name, new MemoryCache());
        return this.caches.get(name)!;
    }

    public async delete(name: string): Promise<boolean> {
        return this.caches.delete(name);
    }
}

export class MemoryCache {
    public readonly entries = new Map<string, { body: Blob; init: ResponseInit }>();

    public async match(request: string | Request): Promise<Response | undefined> {
        const entry = this.entries.get(typeof request === "string" ? request : request.url);
        return entry ? new Response(entry.body, entry.init) : undefined;
    }

    public async put(request: string | Request, response: Response): Promise<void> {
        const body = await response.blob();
        this.entries.set(typeof request === "string" ? request : request.url, {
            body,
            init: { status: response.status, headers: new Headers(response.headers) },
        });
    }

    public async delete(request: string | Request): Promise<boolean> {
        return this.entries.delete(typeof request === "string" ? request : request.url);
    }

    public async keys(): Promise<Request[]> {
        return [...this.entries.keys()].map((url) => new Request(url));
    }
}
