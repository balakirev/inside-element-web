/*
Copyright 2024 New Vector Ltd.
Copyright 2019-2021 The Matrix.org Foundation C.I.C.
Copyright 2019 Michael Telatynski <7t3chguy@gmail.com>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useCallback, useState, type ChangeEvent, type JSX, type KeyboardEvent } from "react";

import { _t } from "../../../languageHandler";
import BaseDialog from "./BaseDialog";
import DialogButtons from "../elements/DialogButtons";
import Modal from "../../../Modal";
import QuestionDialog from "./QuestionDialog";
import { fileSize } from "../../../utils/FileUtils";
import {
    attachmentIcon,
    type MediaPreviewGroupEntry,
    type MediaPreviewGroupEntryContent,
    MediaPreviewGroupPreview,
    useCreateAutoDisposedViewModel,
} from "@element-hq/web-shared-components";
import { MediaPreviewGroupViewModel } from "../../../viewmodels/message-body/MediaPreviewGroupViewModel";

interface IProps {
    file: File;
    /** Defaults to 0. */
    currentIndex?: number;
    /** Defaults to 1. */
    totalFiles?: number;
    /**
     * Called when the dialog closes.
     * @param uploadConfirmed - whether the user chose to send the file
     * @param uploadAll - whether the remaining files should be sent without asking again
     * @param caption - text the user typed to send together with the file, if any
     */
    onFinished: (uploadConfirmed: boolean, uploadAll?: boolean, caption?: string) => void;
}

const previewableFormats = ["video", "audio", "image"];
/**
 * previewable formats needs an object URL to be created for the preview
 */
function formatIsPreviewable(mimetype: string): boolean {
    return previewableFormats.includes(mimetype.split("/")[0]);
}

/**
 * objectUrl should only be undefined if mimetype is text
 */
function computePreviewContent(mimeType: string, fileName: string, objectUrl?: string): MediaPreviewGroupEntryContent {
    if (objectUrl === undefined)
        return {
            type: "text",
        };

    switch (mimeType.split("/")[0]) {
        case "image":
            return {
                type: "image",
                imageSize: "tallbanner",
                image: objectUrl,
                imageAlt: fileName,
            };
        case "video":
            return {
                type: "video",
                videoSize: "tallbanner",
                video: objectUrl,
            };
        case "audio":
            return {
                type: "audio",
                audio: objectUrl,
            };
        default:
            return {
                type: "text",
            };
    }
}

/**
 * Owns the object URL used for the preview so that its lifetime is tied to the lifetime of the
 * view-model: it is revoked when the view-model is disposed, i.e. when the dialog unmounts.
 */
class UploadPreviewViewModel extends MediaPreviewGroupViewModel {
    public constructor(file: File) {
        const mimeType = file.type;
        const objectUrl = formatIsPreviewable(mimeType) ? URL.createObjectURL(file) : undefined;

        const preview: MediaPreviewGroupEntry = {
            id: file.name,
            header: file.name,
            body: fileSize(file.size),
            ...attachmentIcon(mimeType),
            ...computePreviewContent(mimeType, file.name, objectUrl),
        };

        super({ entries: [preview] });

        if (objectUrl !== undefined) this.disposables.track(() => URL.revokeObjectURL(objectUrl));
    }
}

export default function UploadConfirmDialog({
    file,
    currentIndex = 0,
    totalFiles = 1,
    onFinished,
}: IProps): JSX.Element {
    const vm = useCreateAutoDisposedViewModel(() => new UploadPreviewViewModel(file));

    let title: string;
    if (totalFiles > 1 && currentIndex !== undefined) {
        title = _t("upload_file|title_progress", {
            current: currentIndex + 1,
            total: totalFiles,
        });
    } else {
        title = _t("upload_file|title");
    }

    const [caption, setCaption] = useState("");
    const trimmedCaption = caption.trim();

    const onCaptionChange = useCallback((ev: ChangeEvent<HTMLTextAreaElement>): void => {
        setCaption(ev.target.value);
    }, []);

    const onCancelClick = useCallback(async (): Promise<void> => {
        // Closing the dialog throws the typed caption away, so confirm first, like other messengers do.
        if (trimmedCaption) {
            const { finished } = Modal.createDialog(QuestionDialog, {
                title: _t("upload_file|discard_caption_title"),
                description: _t("upload_file|discard_caption_description"),
                button: _t("upload_file|discard_caption_button"),
                // The default "Cancel" reads the same as "discard" in some languages, so name both choices.
                cancelButton: _t("upload_file|keep_caption_button"),
                danger: true,
            });
            const [discard] = await finished;
            if (!discard) return;
        }
        onFinished(false);
    }, [onFinished, trimmedCaption]);

    const onUploadClick = useCallback((): void => {
        onFinished(true, false, trimmedCaption || undefined);
    }, [onFinished, trimmedCaption]);

    const onUploadAllClick = useCallback((): void => {
        onFinished(true, true, trimmedCaption || undefined);
    }, [onFinished, trimmedCaption]);

    const onCaptionKeyDown = useCallback(
        (ev: KeyboardEvent<HTMLTextAreaElement>): void => {
            // Enter sends, Shift+Enter starts a new line; ignore Enter that confirms an IME composition.
            if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) {
                ev.preventDefault();
                onUploadClick();
            }
        },
        [onUploadClick],
    );

    let uploadAllButton: JSX.Element | undefined;
    if (currentIndex + 1 < totalFiles) {
        uploadAllButton = (
            <button onClick={onUploadAllClick} className="mx_LegacyDialogButton" type="button">
                {_t("upload_file|upload_all_button")}
            </button>
        );
    }

    return (
        <BaseDialog
            className="mx_UploadConfirmDialog"
            fixedWidth={false}
            onFinished={onCancelClick}
            title={title}
            contentId="mx_Dialog_content"
        >
            <div id="mx_Dialog_content">
                <div className="mx_UploadConfirmDialog_previewOuter">
                    <div className="mx_UploadConfirmDialog_previewInner">
                        <MediaPreviewGroupPreview vm={vm} />
                    </div>
                </div>
                <textarea
                    className="mx_UploadConfirmDialog_caption"
                    aria-label={_t("upload_file|caption_label")}
                    placeholder={_t("upload_file|caption_placeholder")}
                    value={caption}
                    onChange={onCaptionChange}
                    onKeyDown={onCaptionKeyDown}
                    rows={1}
                    // The caption is the natural next step after picking a file, as in other messengers.
                    autoFocus={true}
                />
            </div>

            <DialogButtons primaryButton={_t("action|upload")} hasCancel={false} onPrimaryButtonClick={onUploadClick}>
                {uploadAllButton}
            </DialogButtons>
        </BaseDialog>
    );
}
