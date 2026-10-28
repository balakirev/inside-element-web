/*
Copyright 2024 New Vector Ltd.
Copyright 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";

import SplashPage from "../SplashPage";
import { _t } from "../../../languageHandler";
import SdkConfig from "../../../SdkConfig";
import AccessibleButton from "../../views/elements/AccessibleButton";

/** Session storage key: set by "Open here", read once by {@link MatrixChat} after the reload. */
const TAKE_OVER_KEY = "mx_inside_take_over_session";

/**
 * Component shown by {@link MatrixChat} when another session is started in the same browser.
 */
export function SessionLockStolenView(): JSX.Element {
    const brand = SdkConfig.get().brand;

    return (
        <SplashPage className="mx_SessionLockStolenView">
            <h1>{_t("error_app_open_in_another_tab_title", { brand })}</h1>
            <h2>{_t("error_app_open_in_another_tab", { brand })}</h2>
            {/* Inside: as in other messengers, the user can bring the session back to this tab in one click. */}
            <AccessibleButton
                kind="primary"
                className="mx_SessionLockStolenView_openHere"
                onClick={() => {
                    window.sessionStorage.setItem(TAKE_OVER_KEY, "1");
                    window.location.reload();
                }}
            >
                {_t("error_app_open_in_another_tab_open_here")}
            </AccessibleButton>
        </SplashPage>
    );
}

/**
 * Inside: whether this page load comes from "Open here" on {@link SessionLockStolenView}. Clears the request, so a
 * later reload asks again as usual.
 */
SessionLockStolenView.consumeTakeOverRequest = (): boolean => {
    const requested = window.sessionStorage.getItem(TAKE_OVER_KEY) === "1";
    window.sessionStorage.removeItem(TAKE_OVER_KEY);
    return requested;
};
