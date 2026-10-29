/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useContext, type JSX } from "react";
import { CloseIcon, ComposeIcon, GroupIcon, UserAddIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t } from "../../../../languageHandler";
import defaultDispatcher from "../../../../dispatcher/dispatcher";
import { Action } from "../../../../dispatcher/actions";
import { SDKContext } from "../../../../contexts/SDKContext.ts";
import { shouldShowComponent } from "../../../../customisations/helpers/UIComponents";
import { UIComponent } from "../../../../settings/UIFeature";
import { createRoom } from "../../../../viewmodels/room-list/utils";
import { ChevronFace, ContextMenuButton, alwaysMenuProps, useContextMenu } from "../../../structures/ContextMenu";
import IconizedContextMenu, {
    IconizedContextMenuOption,
    IconizedContextMenuOptionList,
} from "../../context_menus/IconizedContextMenu";
import { type ButtonEvent } from "../../elements/AccessibleButton";

/**
 * Inside: the round "new message" button at the bottom right of the room list in narrow windows, as the pencil
 * of Telegram Web: it turns into a cross and opens a menu above it — new group, new private chat.
 */
export function InsideComposeFab(): JSX.Element {
    const sdkContext = useContext(SDKContext);
    const [menuDisplayed, handle, openMenu, closeMenu] = useContextMenu<HTMLButtonElement>();
    const canCreateRoom = shouldShowComponent(UIComponent.CreateRooms);

    const run = (action: () => void) => (ev: ButtonEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        closeMenu();
        action();
    };

    let contextMenu: JSX.Element | null = null;
    if (menuDisplayed && handle.current) {
        contextMenu = (
            <IconizedContextMenu
                {...alwaysMenuProps(handle.current.getBoundingClientRect(), ChevronFace.None, 10)}
                onFinished={closeMenu}
                className="mx_InsideComposeFab_menu"
                compact
            >
                <IconizedContextMenuOptionList first>
                    {canCreateRoom && (
                        <IconizedContextMenuOption
                            label={_t("room_list|inside_new_group")}
                            icon={<GroupIcon />}
                            onClick={run(() => void createRoom(sdkContext.spaceStore.activeSpaceRoom))}
                        />
                    )}
                    <IconizedContextMenuOption
                        label={_t("room_list|inside_new_chat")}
                        icon={<UserAddIcon />}
                        onClick={run(() => defaultDispatcher.fire(Action.CreateChat))}
                    />
                </IconizedContextMenuOptionList>
            </IconizedContextMenu>
        );
    }

    return (
        <>
            <ContextMenuButton
                ref={handle}
                className="mx_InsideComposeFab"
                onClick={menuDisplayed ? closeMenu : openMenu}
                isExpanded={menuDisplayed}
                label={_t("room_list|inside_new_message")}
            >
                <ComposeIcon className="mx_InsideComposeFab_pencil" aria-hidden />
                <CloseIcon className="mx_InsideComposeFab_close" aria-hidden />
            </ContextMenuButton>
            {contextMenu}
        </>
    );
}
