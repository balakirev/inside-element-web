/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useLayoutEffect, useReducer, useState } from "react";
import classNames from "classnames";
import { type MatrixEvent, type Room, RoomEvent } from "matrix-js-sdk/src/matrix";
import { CloseIcon, AttachmentIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import ContentMessages from "../../../ContentMessages";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ActionPayload } from "../../../dispatcher/payloads";
import { useDispatcher } from "../../../hooks/useDispatcher";
import { useTypedEventEmitter } from "../../../hooks/useEventEmitter";
import { getCurrentLanguage, _t } from "../../../languageHandler";
import { type RoomUpload } from "../../../models/RoomUpload";
import SettingsStore from "../../../settings/SettingsStore";
import { suggestedSize } from "../../../settings/enums/ImageSize";
import AccessibleButton from "../elements/AccessibleButton";

const UPLOAD_ACTIONS: string[] = [
    Action.UploadStarted,
    Action.UploadProgress,
    Action.UploadFailed,
    Action.UploadFinished,
    Action.UploadCanceled,
];

// How far back in the live timeline to look for the event that an upload turned into.
const RECENT_EVENTS = 30;

const UNITS = ["kilobyte", "megabyte", "gigabyte"] as const;

/**
 * Formats upload progress as "12.3 of 42.5 MB" in the user's language: both numbers in the unit of
 * the total, the unit written once.
 */
export function formatUploadProgress(loaded: number, total: number): string {
    let unit = 0;
    let divisor = 1024;
    while (unit < UNITS.length - 1 && total >= divisor * 1024) {
        unit++;
        divisor *= 1024;
    }
    const language = getCurrentLanguage();
    const options = { maximumFractionDigits: 1, minimumFractionDigits: 1 };
    const loadedText = new Intl.NumberFormat(language, options).format(Math.min(loaded, total) / divisor);
    const totalText = new Intl.NumberFormat(language, { ...options, style: "unit", unit: UNITS[unit] }).format(
        total / divisor,
    );
    return _t("upload_file|pending_progress", { loaded: loadedText, total: totalText });
}

function contentUriOf(event: MatrixEvent): string | undefined {
    const content = event.getContent();
    return content.url ?? content.file?.url;
}

/**
 * Whether the event an upload was sent as is already in the timeline (as a local echo or as the
 * event from the server), so that it takes the place of the pending bubble.
 */
function hasArrived(room: Room, upload: RoomUpload): boolean {
    if (!upload.contentUri) return false;
    let pending: MatrixEvent[] = [];
    try {
        pending = room.getPendingEvents();
    } catch {
        // The room keeps pending events in the timeline itself; they are found below.
    }
    const recent = room.getLiveTimeline().getEvents().slice(-RECENT_EVENTS);
    return [...pending, ...recent].some((event) => contentUriOf(event) === upload.contentUri);
}

function useObjectUrl(file?: File): string | undefined {
    const [url, setUrl] = useState<string>();
    useEffect(() => {
        if (!file) return;
        const objectUrl = URL.createObjectURL(file);
        setUrl(objectUrl);
        return () => URL.revokeObjectURL(objectUrl);
    }, [file]);
    return url;
}

function uploadKind(upload: RoomUpload): "image" | "video" | "file" {
    const type = upload.file?.type ?? "";
    if (type.startsWith("image/")) return "image";
    if (type.startsWith("video/")) return "video";
    return "file";
}

interface RingProps {
    upload: RoomUpload;
}

/** A circular progress ring with a cancel button in its middle. */
function ProgressRing({ upload }: RingProps): JSX.Element {
    const percent = upload.total > 0 ? Math.round((Math.min(upload.loaded, upload.total) / upload.total) * 100) : 0;
    const radius = 20;
    const circumference = 2 * Math.PI * radius;

    const onCancel = useCallback((): void => {
        ContentMessages.sharedInstance().cancelUpload(upload);
    }, [upload]);

    return (
        <div className="mx_InsidePendingUpload_ringWrap">
            <svg
                className="mx_InsidePendingUpload_ring"
                viewBox="0 0 48 48"
                role="progressbar"
                aria-label={upload.fileName}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
            >
                <circle className="mx_InsidePendingUpload_ringTrack" cx="24" cy="24" r={radius} />
                <circle
                    className="mx_InsidePendingUpload_ringValue"
                    cx="24"
                    cy="24"
                    r={radius}
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - percent / 100)}
                    transform="rotate(-90 24 24)"
                />
            </svg>
            <AccessibleButton
                className="mx_InsidePendingUpload_cancel"
                onClick={onCancel}
                aria-label={_t("upload_file|cancel_upload")}
            >
                <CloseIcon />
            </AccessibleButton>
        </div>
    );
}

function FailedActions({ upload }: { upload: RoomUpload }): JSX.Element {
    const onRetry = useCallback((): void => {
        void ContentMessages.sharedInstance().retryUpload(upload);
    }, [upload]);
    const onDelete = useCallback((): void => {
        ContentMessages.sharedInstance().dismissFailedUpload(upload);
    }, [upload]);

    return (
        <div className="mx_InsidePendingUpload_failedActions">
            <span className="mx_InsidePendingUpload_failedText">{_t("upload_file|pending_failed")}</span>
            <AccessibleButton kind="link_inline" className="mx_InsidePendingUpload_retry" onClick={onRetry}>
                {_t("action|retry")}
            </AccessibleButton>
            <AccessibleButton kind="link_inline" className="mx_InsidePendingUpload_delete" onClick={onDelete}>
                {_t("action|delete")}
            </AccessibleButton>
        </div>
    );
}

interface PendingUploadProps {
    upload: RoomUpload;
    onResize?: () => void;
}

function PendingMedia({ upload, kind, onResize }: PendingUploadProps & { kind: "image" | "video" }): JSX.Element {
    const url = useObjectUrl(upload.file);
    const [natural, setNatural] = useState<{ w: number; h: number }>();
    const size = suggestedSize(SettingsStore.getValue("Images.size"), natural ?? {});

    useLayoutEffect(() => {
        if (natural) onResize?.();
    }, [natural, onResize]);

    const onImageLoad = useCallback((ev: React.SyntheticEvent<HTMLImageElement>): void => {
        setNatural({ w: ev.currentTarget.naturalWidth, h: ev.currentTarget.naturalHeight });
    }, []);
    const onVideoMetadata = useCallback((ev: React.SyntheticEvent<HTMLVideoElement>): void => {
        setNatural({ w: ev.currentTarget.videoWidth, h: ev.currentTarget.videoHeight });
    }, []);

    let media: JSX.Element | undefined;
    if (url && kind === "image") {
        media = <img src={url} alt="" onLoad={onImageLoad} />;
    } else if (url) {
        // The fragment makes browsers show the first frame instead of a blank box.
        media = (
            <video src={`${url}#t=0.001`} muted playsInline preload="metadata" onLoadedMetadata={onVideoMetadata} />
        );
    }

    return (
        <div
            className="mx_InsidePendingUpload_media"
            style={{
                width: size.w,
                aspectRatio: natural ? `${natural.w}/${natural.h}` : undefined,
                height: natural ? undefined : size.h,
            }}
        >
            {media}
            <div className="mx_InsidePendingUpload_overlay">{!upload.failed && <ProgressRing upload={upload} />}</div>
            {!upload.failed && (
                <span className="mx_InsidePendingUpload_progressText">
                    {formatUploadProgress(upload.loaded, upload.total)}
                </span>
            )}
        </div>
    );
}

function PendingFile({ upload }: PendingUploadProps): JSX.Element {
    return (
        <div className="mx_InsidePendingUpload_file">
            {upload.failed ? (
                <div className="mx_InsidePendingUpload_fileIcon">
                    <AttachmentIcon />
                </div>
            ) : (
                <ProgressRing upload={upload} />
            )}
            <div className="mx_InsidePendingUpload_fileInfo">
                <span className="mx_InsidePendingUpload_fileName">{upload.fileName}</span>
                {!upload.failed && (
                    <span className="mx_InsidePendingUpload_progressText">
                        {formatUploadProgress(upload.loaded, upload.total)}
                    </span>
                )}
            </div>
        </div>
    );
}

function PendingUpload({ upload, onResize }: PendingUploadProps): JSX.Element {
    const kind = uploadKind(upload);
    return (
        <li
            className={classNames("mx_InsidePendingUpload", {
                mx_InsidePendingUpload_failed: upload.failed,
            })}
            title={upload.failed ? upload.failureReason : undefined}
        >
            <div className="mx_InsidePendingUpload_bubble">
                {kind === "file" ? (
                    <PendingFile upload={upload} />
                ) : (
                    <PendingMedia upload={upload} kind={kind} onResize={onResize} />
                )}
                {upload.caption && <div className="mx_InsidePendingUpload_caption">{upload.caption}</div>}
                {upload.failed && <FailedActions upload={upload} />}
            </div>
        </li>
    );
}

const keys = new WeakMap<RoomUpload, string>();
let nextKey = 0;
function keyOf(upload: RoomUpload): string {
    let key = keys.get(upload);
    if (!key) {
        key = `upload-${nextKey++}`;
        keys.set(upload, key);
    }
    return key;
}

interface IProps {
    room: Room;
    /** Called when the block changes height, so the timeline can stay stuck to the bottom. */
    onResize?: () => void;
}

/**
 * Inside: files being sent to the main timeline of a room, shown at its end as own bubbles with a
 * preview and a circular progress, as other messengers do, in place of Element's upload bar. Once
 * the event of an upload is in the timeline it takes the bubble's place; failed uploads stay with
 * "retry" and "delete".
 */
export default function InsidePendingUploads({ room, onResize }: IProps): JSX.Element | null {
    const [, update] = useReducer((n: number) => n + 1, 0);

    useDispatcher(dis, (payload: ActionPayload) => {
        if (UPLOAD_ACTIONS.includes(payload.action)) update();
    });
    // The local echo replaces the bubble in the same render, so the timeline does not jump.
    useTypedEventEmitter(room, RoomEvent.LocalEchoUpdated, update);
    useTypedEventEmitter(room, RoomEvent.Timeline, update);

    const contentMessages = ContentMessages.sharedInstance();
    const uploads = [
        ...contentMessages
            .getCurrentUploads()
            .filter((upload) => upload.roomId === room.roomId && !hasArrived(room, upload)),
        ...contentMessages.getFailedUploads(room.roomId),
    ];

    const count = uploads.length;
    useLayoutEffect(() => {
        onResize?.();
    }, [count, onResize]);

    if (count === 0) return null;
    return (
        <>
            {uploads.map((upload) => (
                <PendingUpload key={keyOf(upload)} upload={upload} onResize={onResize} />
            ))}
        </>
    );
}
