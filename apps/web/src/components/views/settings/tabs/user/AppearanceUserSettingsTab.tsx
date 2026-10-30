/*
Copyright 2024 New Vector Ltd.
Copyright 2019-2021 The Matrix.org Foundation C.I.C.
Copyright 2019 New Vector Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { type EmptyObject } from "matrix-js-sdk/src/matrix";

import SettingsTab from "../SettingsTab";
import { InsideAppearancePanel } from "../../InsideAppearancePanel";

/**
 * Inside: the appearance tab is the Lobby screen (theme cards, chat wallpaper, text and messages).
 * Element's theme, layout and font size panels are replaced by it; the timeline image size, the
 * bundled emoji font and the system font (advanced) are not offered: the Lobby skin sets the
 * font (Onest) and the size of images itself.
 */
export default class AppearanceUserSettingsTab extends React.Component<EmptyObject> {
    public render(): React.ReactNode {
        return (
            <SettingsTab data-testid="mx_AppearanceUserSettingsTab">
                <InsideAppearancePanel />
            </SettingsTab>
        );
    }
}
