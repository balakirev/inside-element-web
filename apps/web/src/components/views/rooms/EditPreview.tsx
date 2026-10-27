/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { CloseIcon, EditIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import { stripPlainReply } from "../../../utils/Reply";

interface IProps {
    /** The message being edited. */
    mxEvent: MatrixEvent;
    onCancel: () => void;
}

/**
 * Inside: the bar above the composer while a message is edited in it, as in other messengers:
 * "Editing", the current text of the message and a button to stop editing.
 */
export default function EditPreview({ mxEvent, onCancel }: IProps): JSX.Element {
    const body = mxEvent.getContent().body;
    const text = typeof body === "string" ? stripPlainReply(body) : "";

    return (
        <div className="mx_EditPreview">
            <EditIcon className="mx_EditPreview_icon" aria-hidden />
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
