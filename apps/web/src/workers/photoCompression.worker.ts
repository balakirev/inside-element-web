/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// Inside: compresses photos before they are sent (see utils/photoCompression.ts).

import { compressPhotoBlob, type PhotoWorkerRequest, type PhotoWorkerResponse } from "../utils/photoCompression";

const ctx: Worker = self as any;

ctx.addEventListener("message", (event: MessageEvent<PhotoWorkerRequest>): void => {
    const { seq, blob, options } = event.data;
    compressPhotoBlob(blob, options).then(
        (result) => ctx.postMessage({ seq, result } satisfies PhotoWorkerResponse),
        (error) => ctx.postMessage({ seq, error: String(error) } satisfies PhotoWorkerResponse),
    );
});
