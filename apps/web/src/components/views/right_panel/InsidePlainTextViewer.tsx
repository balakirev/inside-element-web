/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useEffect, useState } from "react";
import { logger } from "matrix-js-sdk/src/logger";
import { DocumentViewerView, type DocumentViewerStatus } from "@element-hq/web-shared-components";

import { type DocumentMedia } from "../../../@types/document-viewer";

const loggerPlainText = logger.getChild("InsidePlainTextViewer");

/** Cap on the attachment, as the Markdown viewer's: all of it sits in the DOM while it is open. */
export const MAX_PLAIN_TEXT_BYTES = 2 * 1024 * 1024;

/**
 * Inside: a plain text attachment, as it is, on the shared document viewer frame (loading and error
 * states). The text goes in as a text node, so nothing in it is ever markup.
 */
export function InsidePlainTextViewer({ media }: { media: DocumentMedia }): JSX.Element {
    const [status, setStatus] = useState<DocumentViewerStatus>("loading");
    const [text, setText] = useState("");

    useEffect(() => {
        setStatus("loading");
        setText("");
        let disposed = false;

        const loadDocument = async (): Promise<void> => {
            if (media.size !== undefined && media.size > MAX_PLAIN_TEXT_BYTES) {
                throw new Error("Text attachment is too large");
            }
            const blob = await media.blob();
            if (blob.size > MAX_PLAIN_TEXT_BYTES) throw new Error("Text attachment is too large");
            const decoded = new TextDecoder().decode(await blob.arrayBuffer());
            // Text never contains NUL, so a file that does was never text, whatever it was labelled.
            if (decoded.includes("\0")) throw new Error("Attachment is not a text file");
            if (disposed) return;
            setText(decoded);
            setStatus("ready");
        };

        void loadDocument().catch((error: unknown) => {
            if (disposed) return;
            loggerPlainText.error("Unable to load text file", error);
            setStatus("error");
        });

        return () => {
            disposed = true;
        };
    }, [media]);

    return (
        <DocumentViewerView status={status}>
            {status === "ready" ? (
                <pre className="mx_InsidePlainTextViewer" data-testid="plain-text-content" dir="auto">
                    {text}
                </pre>
            ) : null}
        </DocumentViewerView>
    );
}
