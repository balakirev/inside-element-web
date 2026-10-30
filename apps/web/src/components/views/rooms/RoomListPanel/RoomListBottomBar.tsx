/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useContext, type JSX } from "react";
import { ChatSolidIcon, UserProfileIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import AccessibleButton from "../../elements/AccessibleButton";
import { _t } from "../../../../languageHandler";
import defaultDispatcher from "../../../../dispatcher/dispatcher";
import { Action } from "../../../../dispatcher/actions";
import { useDispatcher } from "../../../../hooks/useDispatcher";
import { SDKContext } from "../../../../contexts/SDKContext.ts";
import { MetaSpace } from "../../../../stores/spaces";
import { OwnAvatarButton } from "./OwnAvatarButton";
import { leaveAssistantFolder } from "../../../../inside/insis/assistant";

/**
 * Inside: the bar at the bottom of the room list, as in other messengers — contacts, chats and the
 * user's own avatar, which opens the settings with the profile on top (the user menu's shortcut too).
 */
export function RoomListBottomBar(): JSX.Element {
    const sdkContext = useContext(SDKContext);
    const openSettings = (): void => defaultDispatcher.dispatch({ action: Action.ViewUserSettings });

    useDispatcher(defaultDispatcher, (payload) => {
        if (payload.action === Action.ToggleUserMenu) openSettings();
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
                onClick={() => {
                    sdkContext.spaceStore.setActiveSpace(MetaSpace.Home);
                    // Inside: "Chats" also leaves the "Помощник" folder.
                    leaveAssistantFolder();
                }}
            >
                <ChatSolidIcon />
            </AccessibleButton>
            <OwnAvatarButton
                className="mx_RoomListBottomBar_button mx_RoomListBottomBar_profile"
                title={_t("common|settings")}
                size="30px"
                onClick={openSettings}
            />
        </div>
    );
}
