/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";
import {
    AudioIcon,
    CloseIcon,
    DocumentIcon,
    EditIcon,
    ImageIcon,
    VideoCallIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import { stripPlainReply } from "../../../utils/Reply";
import { mediaFromContent } from "../../../customisations/Media";
import { getMediaCaption, getMediaFileName, isCaptionEditableEvent } from "../../../utils/mediaCaption";
import { type MediaEventContent } from "matrix-js-sdk/src/types";

/** Side of the picture of an edited media message in the bar, in CSS pixels. */
const THUMBNAIL_SIDE = 36;

/**
 * Inside: the picture of the media whose caption is edited, as Telegram shows it: a thumbnail of a
 * photo (or of a video or file that has one), an icon of the type otherwise and for encrypted media.
 */
function MediaPicture({ mxEvent }: { mxEvent: MatrixEvent }): JSX.Element {
    const content = mxEvent.getContent<MediaEventContent>();
    let src: string | null = null;
    try {
        const media = mediaFromContent(content);
        if (!media.isEncrypted && (content.msgtype === MsgType.Image || media.hasThumbnail)) {
            src = media.getSquareThumbnailHttp(THUMBNAIL_SIDE);
        }
    } catch {
        src = null;
    }
    if (src) {
        return <img className="mx_EditPreview_thumbnail" src={src} alt="" aria-hidden />;
    }
    const Icon =
        content.msgtype === MsgType.Image
            ? ImageIcon
            : content.msgtype === MsgType.Video
              ? VideoCallIcon
              : content.msgtype === MsgType.Audio
                ? AudioIcon
                : DocumentIcon;
    return (
        <div className="mx_EditPreview_thumbnail mx_EditPreview_thumbnail_icon" aria-hidden>
            <Icon />
        </div>
    );
}

interface IProps {
    /** The message being edited. */
    mxEvent: MatrixEvent;
    onCancel: () => void;
}

/**
 * Inside: the bar above the composer while a message is edited in it, as in other messengers:
 * "Editing", the current text of the message and a button to stop editing. For a photo, video, file
 * or audio its picture and caption (the file name while it has none).
 */
export default function EditPreview({ mxEvent, onCancel }: IProps): JSX.Element {
    const isMedia = isCaptionEditableEvent(mxEvent);
    const body = isMedia
        ? getMediaCaption(mxEvent.getContent()) || getMediaFileName(mxEvent.getContent())
        : mxEvent.getContent().body;
    const text = typeof body === "string" ? stripPlainReply(body) : "";

    return (
        <div className="mx_EditPreview">
            <EditIcon className="mx_EditPreview_icon" aria-hidden />
            {isMedia && <MediaPicture mxEvent={mxEvent} />}
            <div className="mx_EditPreview_content">
                <div className="mx_EditPreview_title">{_t("composer|editing_title")}</div>
                <div className="mx_EditPreview_text">{text}</div>
            </div>
            <AccessibleButton className="mx_EditPreview_cancel" onClick={onCancel} title={_t("action|cancel")}>
                <CloseIcon />
            </AccessibleButton>
        </div>
    );
}
