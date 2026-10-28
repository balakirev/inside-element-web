/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useEffect, useState } from "react";

import { isPdfFile, pdfThumbnailForFile } from "../utils/pdfThumbnail";

/**
 * Inside: an object URL of the first page of a PDF being sent, once drawn; `undefined` for other files,
 * meanwhile, and when the page cannot be drawn.
 */
export function usePdfFileThumbnailUrl(file?: File): string | undefined {
    const [url, setUrl] = useState<string>();

    useEffect(() => {
        setUrl(undefined);
        if (!file || !isPdfFile(file)) return;

        let objectUrl: string | undefined;
        let cancelled = false;
        void pdfThumbnailForFile(file).then((thumbnail) => {
            if (cancelled || !thumbnail) return;
            objectUrl = URL.createObjectURL(thumbnail.blob);
            setUrl(objectUrl);
        });
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [file]);

    return url;
}
