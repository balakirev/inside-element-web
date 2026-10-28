/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type IEventRelation, type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";

import ContentMessages from "../ContentMessages";
import { ROUND_VIDEO_FLAG } from "./roundVideo";
import { type RoundVideoResult } from "./RoundVideoRecorder";

/** The file name (and body) of a recorded round video, as the Lobby contract has it: "video_note.mp4". */
export function roundVideoFileName(mimeType: string): string {
    return mimeType.includes("mp4") ? "video_note.mp4" : "video_note.webm";
}

/**
 * Inside: send a recorded round video as an `m.video` event with the round video flag, through the
 * usual upload path (pending bubble, asynchronous upload for larger files), without compressing it
 * again. The info (`w`, `h`, `duration`, `size`, `mimetype`, the first frame as the thumbnail with
 * its blurhash) is read from the file as for any video; the duration comes from the recorder,
 * since a recorded WebM has none in its header.
 */
export function sendRoundVideo(
    result: RoundVideoResult,
    roomId: string,
    relation: IEventRelation | undefined,
    client: MatrixClient,
    replyToEvent: MatrixEvent | undefined,
    contentMessages: ContentMessages = ContentMessages.sharedInstance(),
): Promise<void> {
    const file = new File([result.blob], roundVideoFileName(result.mimeType), { type: result.mimeType });
    return contentMessages.sendContentToRoom(file, roomId, relation, client, replyToEvent, undefined, undefined, {
        compress: false,
        extraContent: { [ROUND_VIDEO_FLAG]: true },
        info: { duration: result.durationMs, w: result.width, h: result.height },
    });
}
