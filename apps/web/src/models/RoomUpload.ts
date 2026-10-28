/*
Copyright 2024 New Vector Ltd.
Copyright 2021 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type IEventRelation, type UploadProgress } from "matrix-js-sdk/src/matrix";
import { type EncryptedFile } from "matrix-js-sdk/src/types";

export class RoomUpload {
    public readonly abortController = new AbortController();
    public promise?: Promise<{ url?: string; file?: EncryptedFile }>;
    private uploaded = 0;
    // Inside: the thumbnail that images and videos upload before the file itself.
    private thumbnailUploaded = 0;
    private thumbnailSize = 0;

    /**
     * Inside: the file being sent, so the timeline can show a preview of it while it uploads.
     */
    public file?: File;
    /**
     * Inside: the caption sent together with the file, if any.
     */
    public caption?: string;
    /**
     * Inside: the content URI the server returned, set once the bytes are uploaded. Lets the timeline
     * tell when the real event for this upload has arrived.
     */
    public contentUri?: string;
    /**
     * Inside: set when the upload or the send failed (not when it was cancelled).
     */
    public failed = false;
    /**
     * Inside: why the upload failed, for the user.
     */
    public failureReason?: string;
    /**
     * Inside: set while the photo or video is being compressed, before its upload starts.
     */
    public compressing = false;
    /**
     * Inside: the share of a video's compression done, 0 to 1, while it is compressed.
     */
    public compressionProgress?: number;
    /**
     * Inside: set while the event of the upload is already sent and its file is still going up to
     * the URI reserved for it (asynchronous upload, MSC2246). The timeline keeps the bubble in place
     * of the event meanwhile.
     */
    public awaitingMedia = false;
    /**
     * Inside: with an asynchronous upload, the ID of the event once it is sent (undefined if sending
     * it failed), so that cancelling can take it back.
     */
    public sentEvent?: Promise<string | undefined>;

    public constructor(
        public readonly roomId: string,
        public readonly fileName: string,
        public readonly relation?: IEventRelation,
        public fileSize = 0,
    ) {}

    public onProgress(progress: UploadProgress): void {
        this.uploaded = progress.loaded;
        this.fileSize = progress.total;
    }

    /**
     * Inside: progress of the thumbnail upload, counted into {@link loaded} and {@link total}.
     */
    public onThumbnailProgress(progress: UploadProgress): void {
        this.thumbnailUploaded = progress.loaded;
        this.thumbnailSize = progress.total;
    }

    public abort(): void {
        this.abortController.abort();
    }

    public get cancelled(): boolean {
        return this.abortController.signal.aborted;
    }

    public get total(): number {
        return this.fileSize + this.thumbnailSize;
    }

    public get loaded(): number {
        return this.uploaded + this.thumbnailUploaded;
    }
}
