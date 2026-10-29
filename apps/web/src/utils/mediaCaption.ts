/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Inside: editing the caption of a photo, video, file or audio message, as in Telegram.
 *
 * Matrix media captions: `body` is the caption and `filename` the file name; without `filename`, or
 * with `body` equal to it, there is no caption and `body` is the file name.
 */

import { type MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";

import { ROUND_VIDEO_FLAG } from "./roundVideo";

/** Content of a media event, as far as captions are concerned. */
export interface CaptionMediaContent {
    msgtype?: string;
    body?: string;
    filename?: string;
    format?: string;
    formatted_body?: string;
    url?: string;
    file?: unknown;
    [key: string]: unknown;
}

const CAPTION_MSGTYPES: string[] = [MsgType.Image, MsgType.Video, MsgType.File, MsgType.Audio];

/**
 * Whether this content is a photo, video, file or audio message whose caption can be edited:
 * not a voice message, not a round video message.
 */
export function isCaptionEditableContent(content: CaptionMediaContent | undefined): boolean {
    if (!content || !CAPTION_MSGTYPES.includes(content.msgtype ?? "")) return false;
    if (typeof content.url !== "string" && !content.file) return false;
    if (content["org.matrix.msc3245.voice"] || content["org.matrix.msc2516.voice"]) return false;
    if (content[ROUND_VIDEO_FLAG]) return false;
    return true;
}

/** Whether the message is a media message whose caption can be edited (see {@link isCaptionEditableContent}). */
export function isCaptionEditableEvent(mxEvent: MatrixEvent): boolean {
    return isCaptionEditableContent(mxEvent.getOriginalContent());
}

/** The file name of the media: `filename`, or `body` when there is no caption. */
export function getMediaFileName(content: CaptionMediaContent): string {
    if (typeof content.filename === "string" && content.filename.length) return content.filename;
    return typeof content.body === "string" ? content.body : "";
}

/** Whether the media content has a caption. */
export function hasMediaCaption(content: CaptionMediaContent): boolean {
    return (
        typeof content.filename === "string" &&
        content.filename.length > 0 &&
        typeof content.body === "string" &&
        content.body !== content.filename
    );
}

/** The caption of the media, empty when it has none. */
export function getMediaCaption(content: CaptionMediaContent): string {
    return hasMediaCaption(content) ? content.body! : "";
}

/**
 * The current content of an edited media message to base its next version on: the latest
 * replacement if it still carries the media (one from a client that kept only the text would lose
 * the file), otherwise the original.
 */
export function getMediaBaseContent(mxEvent: MatrixEvent): CaptionMediaContent {
    const current = mxEvent.getContent<CaptionMediaContent>();
    const base = isCaptionEditableContent(current) ? current : mxEvent.getOriginalContent<CaptionMediaContent>();
    const { "m.relates_to": _relation, "m.new_content": _newContent, ...rest } = base;
    return rest;
}

/**
 * The `m.new_content` of a caption edit: the whole media content (msgtype, url/file, info, filename,
 * custom flags) with the new caption. An empty caption removes it (`body` = file name).
 */
export function buildMediaCaptionContent(
    base: CaptionMediaContent,
    caption: string,
    formattedCaption?: string,
): CaptionMediaContent {
    const fileName = getMediaFileName(base);
    const { format: _format, formatted_body: _formattedBody, ...content } = base;
    content.filename = fileName;
    if (caption) {
        content.body = caption;
        if (formattedCaption) {
            content.format = "org.matrix.custom.html";
            content.formatted_body = formattedCaption;
        }
    } else {
        content.body = fileName;
    }
    return content;
}
