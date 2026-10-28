/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useId, useRef, useState } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { type MediaEventContent } from "matrix-js-sdk/src/types";
import { DocumentIcon, DownloadIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t } from "../../../languageHandler";
import { useSettingValue } from "../../../hooks/useSettings";
import { type MediaEventHelper } from "../../../utils/MediaEventHelper";
import { FileDownloader } from "../../../utils/FileDownloader";
import { fileSize } from "../../../utils/FileUtils";
import { documentViewerForEvent, openDocumentViewer } from "../../../utils/documentViewer";
import { isPdfEvent } from "../../../utils/pdfViewer";
import { lazyPdfThumbnailUrl } from "../../../utils/pdfThumbnail";
import AccessibleButton from "../elements/AccessibleButton";

/** Names longer than this keep their end (and so the extension) in sight when cut. */
const NAME_TAIL = 8;

/** "PDF", "DOCX", "ZIP": from the file name's extension, or else from the type. */
export function documentTypeLabel(name: string, mimetype?: string): string | undefined {
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 ? name.slice(dot + 1) : "";
    if (extension && extension.length <= 5 && /^[a-z0-9]+$/i.test(extension)) return extension.toUpperCase();
    const subtype = mimetype?.split(";")[0].split("/")[1];
    if (subtype && subtype.length <= 5 && /^[a-z0-9]+$/i.test(subtype)) return subtype.toUpperCase();
    return undefined;
}

/**
 * The picture of the tile: the thumbnail sent with the file, or, for an older PDF without one, its first
 * page drawn here once the tile is on screen (small files only, cached for the session).
 */
function useDocumentThumbnail(
    mxEvent: MatrixEvent,
    mediaEventHelper: MediaEventHelper,
    tileRef: React.RefObject<HTMLElement | null>,
): string | undefined {
    const [url, setUrl] = useState<string>();
    const hasThumbnail = !!mediaEventHelper.media?.hasThumbnail;
    const size = mxEvent.getContent<MediaEventContent>().info?.size;
    const lazyKey = !hasThumbnail && isPdfEvent(mxEvent) ? mediaEventHelper.media?.srcMxc : undefined;

    useEffect(() => {
        if (!hasThumbnail) return;
        let cancelled = false;
        mediaEventHelper.thumbnailUrl.value.then(
            (thumbnailUrl) => !cancelled && setUrl(thumbnailUrl ?? undefined),
            () => {},
        );
        return () => {
            cancelled = true;
        };
    }, [hasThumbnail, mediaEventHelper]);

    useEffect(() => {
        const tile = tileRef.current;
        if (!lazyKey || typeof size !== "number" || !tile || typeof IntersectionObserver === "undefined") return;
        let cancelled = false;
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            void lazyPdfThumbnailUrl(lazyKey, size, () => mediaEventHelper.sourceBlob.value).then(
                (pageUrl) => !cancelled && setUrl(pageUrl),
            );
        });
        observer.observe(tile);
        return () => {
            cancelled = true;
            observer.disconnect();
        };
    }, [lazyKey, size, mediaEventHelper, tileRef]);

    return url;
}

/** The name in one line; a long one is cut in the middle, so its end stays readable. */
function DocumentName({ name }: { name: string }): JSX.Element {
    if (name.length <= NAME_TAIL * 2) {
        return (
            <span className="mx_MFileBody_inside_name" title={name}>
                <span className="mx_MFileBody_inside_nameStart">{name}</span>
            </span>
        );
    }
    return (
        <span className="mx_MFileBody_inside_name" title={name}>
            <span className="mx_MFileBody_inside_nameStart">{name.slice(0, -NAME_TAIL)}</span>
            <span className="mx_MFileBody_inside_nameEnd">{name.slice(-NAME_TAIL)}</span>
        </span>
    );
}

interface IProps {
    mxEvent: MatrixEvent;
    mediaEventHelper: MediaEventHelper;
}

/**
 * Inside: a file in the chat as Telegram shows documents: a rounded picture on the left (the first page
 * of a PDF, or a document icon with the type), the name and "8.6 MB · PDF" on the right. The whole tile
 * opens the file in the document viewer if there is one for it, or downloads it; the button on the
 * right always downloads.
 */
export default function InsideDocumentTile({ mxEvent, mediaEventHelper }: IProps): JSX.Element {
    const content = mxEvent.getContent<MediaEventContent>();
    const name = mediaEventHelper.fileName || _t("common|attachment");
    const size = content.info?.size;
    const typeLabel = documentTypeLabel(name, content.info?.mimetype);
    const meta = [typeof size === "number" ? fileSize(size) : undefined, typeLabel].filter(Boolean).join(" · ");

    const documentPreviewsEnabled = useSettingValue("feature_pdf_viewer");
    const viewer = documentPreviewsEnabled ? documentViewerForEvent(mxEvent) : undefined;

    const tileRef = useRef<HTMLDivElement>(null);
    const infoId = useId();
    const thumbnailUrl = useDocumentThumbnail(mxEvent, mediaEventHelper, tileRef);
    const [thumbnailFailed, setThumbnailFailed] = useState(false);
    const onThumbnailError = useCallback((): void => setThumbnailFailed(true), []);

    const download = useCallback(async (): Promise<void> => {
        await new FileDownloader().download({
            blob: await mediaEventHelper.sourceBlob.value, // decrypts transparently if E2EE
            name,
        });
    }, [mediaEventHelper, name]);

    const onOpen = useCallback((): void => {
        if (viewer) {
            openDocumentViewer(mxEvent);
        } else {
            void download();
        }
    }, [viewer, mxEvent, download]);

    const onDownload = useCallback((): void => {
        void download();
    }, [download]);

    const picture =
        thumbnailUrl && !thumbnailFailed ? (
            <img src={thumbnailUrl} alt="" onError={onThumbnailError} />
        ) : (
            <span className="mx_MFileBody_inside_icon">
                <DocumentIcon />
                {typeLabel && <span className="mx_MFileBody_inside_iconLabel">{typeLabel}</span>}
            </span>
        );

    return (
        <div className="mx_EventTile_content">
            <div className="mx_MFileBody_inside_doc" ref={tileRef}>
                <AccessibleButton
                    element="div"
                    className="mx_MFileBody_inside_open"
                    onClick={onOpen}
                    title={viewer ? viewer.openLabel() : _t("action|download")}
                    aria-describedby={infoId}
                >
                    <span
                        className={
                            thumbnailUrl && !thumbnailFailed
                                ? "mx_MFileBody_inside_thumb mx_MFileBody_inside_thumb_picture"
                                : "mx_MFileBody_inside_thumb"
                        }
                    >
                        {picture}
                    </span>
                    <span className="mx_MFileBody_inside_info" id={infoId}>
                        <DocumentName name={name} />
                        <span className="mx_MFileBody_inside_meta">{meta || _t("timeline|m.file|size_unknown")}</span>
                    </span>
                </AccessibleButton>
                <AccessibleButton
                    className="mx_MFileBody_inside_download"
                    onClick={onDownload}
                    aria-label={_t("action|download")}
                >
                    <DownloadIcon />
                </AccessibleButton>
            </div>
        </div>
    );
}
