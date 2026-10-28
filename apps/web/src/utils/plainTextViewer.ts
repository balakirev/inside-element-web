/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { type FileContent, type MediaEventContent } from "matrix-js-sdk/src/types";

import { MediaEventHelper } from "./MediaEventHelper";
import { isMarkdownEvent } from "./markdownViewer";

export const PLAIN_TEXT_MIMETYPE = "text/plain";

/** Names that are plain text when the sender gave no useful mimetype. */
const PLAIN_TEXT_EXTENSIONS = [".txt", ".text", ".log"];

/**
 * Inside: whether this event carries a plain text file the Quick Look window can show. `text/plain`
 * is enough (a Markdown file sent as `text/plain` is left to the Markdown viewer); without a mimetype,
 * or with `application/octet-stream`, a `.txt`, `.text` or `.log` name counts.
 */
export function isPlainTextEvent(mxEvent: MatrixEvent): boolean {
    if (!MediaEventHelper.isEligible(mxEvent) || isMarkdownEvent(mxEvent)) return false;

    const content = mxEvent.getContent<MediaEventContent & FileContent>();
    const mimetype = content.info?.mimetype?.split(";")[0].trim().toLowerCase();
    if (mimetype === PLAIN_TEXT_MIMETYPE) return true;
    if (mimetype && mimetype !== "application/octet-stream") return false;

    const name = (content.filename || content.body || "").toLowerCase();
    return PLAIN_TEXT_EXTENSIONS.some((extension) => name.endsWith(extension));
}
