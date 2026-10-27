/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useContext, type JSX } from "react";
import { useCreateAutoDisposedViewModel, UserMenu } from "@element-hq/web-shared-components";
import { ChatSolidIcon, UserProfileIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import AccessibleButton from "../../elements/AccessibleButton";
import { _t } from "../../../../languageHandler";
import defaultDispatcher from "../../../../dispatcher/dispatcher";
import { Action } from "../../../../dispatcher/actions";
import { useDispatcher } from "../../../../hooks/useDispatcher";
import { useMatrixClientContext } from "../../../../contexts/MatrixClientContext";
import { SDKContext } from "../../../../contexts/SDKContext.ts";
import { MetaSpace } from "../../../../stores/spaces";
import { OwnProfileStore } from "../../../../stores/OwnProfileStore.ts";
import { UserMenuViewModel } from "../../../../viewmodels/menus/UserMenuViewModel.ts";

/**
 * Inside: the bar at the bottom of the room list, as in other messengers — contacts, chats and the
 * user's own avatar. The avatar is Element's user menu, moved here from the top of the space panel.
 */
export function RoomListBottomBar(): JSX.Element {
    const client = useMatrixClientContext();
    const sdkContext = useContext(SDKContext);

    const userMenuVm = useCreateAutoDisposedViewModel(
        () => new UserMenuViewModel({ ownProfileStore: OwnProfileStore.instance }, defaultDispatcher, client, true),
    );
    useDispatcher(defaultDispatcher, (payload) => {
        if (payload.action === Action.ToggleUserMenu) {
            userMenuVm.setOpen(!userMenuVm.getSnapshot().open);
        }
    });

    return (
        <div className="mx_RoomListBottomBar" role="toolbar" aria-label={_t("room_list|bottom_bar_label")}>
            <AccessibleButton
                className="mx_RoomListBottomBar_button"
                title={_t("room_list|contacts")}
                onClick={() => defaultDispatcher.fire(Action.CreateChat)}
            >
                <UserProfileIcon />
            </AccessibleButton>
            <AccessibleButton
                className="mx_RoomListBottomBar_button mx_RoomListBottomBar_button_active"
                title={_t("room_list|chats")}
                aria-current="page"
                onClick={() => sdkContext.spaceStore.setActiveSpace(MetaSpace.Home)}
            >
                <ChatSolidIcon />
            </AccessibleButton>
            <UserMenu vm={userMenuVm} className="mx_UserMenu mx_RoomListBottomBar_userMenu" />
        </div>
    );
}
