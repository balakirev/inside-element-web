/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useContext, type JSX } from "react";
import {
    DarkModeIcon,
    FavouriteIcon,
    MenuIcon,
    SettingsIcon,
    UserProfileIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t } from "../../../../languageHandler";
import defaultDispatcher from "../../../../dispatcher/dispatcher";
import { Action } from "../../../../dispatcher/actions";
import { type RecheckThemePayload } from "../../../../dispatcher/payloads/RecheckThemePayload";
import { SDKContext } from "../../../../contexts/SDKContext.ts";
import { useMatrixClientContext } from "../../../../contexts/MatrixClientContext";
import { useEventEmitterState } from "../../../../hooks/useEventEmitter";
import { useTheme } from "../../../../hooks/useTheme";
import SettingsStore from "../../../../settings/SettingsStore";
import { SettingLevel } from "../../../../settings/SettingLevel";
import { OwnProfileStore } from "../../../../stores/OwnProfileStore";
import { UPDATE_EVENT } from "../../../../stores/AsyncStore";
import { MetaSpace } from "../../../../stores/spaces";
import { InsideFolderStore } from "../../../../stores/room-list-v3/InsideFolderStore";
import { FilterEnum } from "../../../../stores/room-list-v3/skip-list/filters";
import { ChevronFace, ContextMenuButton, useContextMenu } from "../../../structures/ContextMenu";
import IconizedContextMenu, {
    IconizedContextMenuCheckbox,
    IconizedContextMenuOption,
    IconizedContextMenuOptionList,
} from "../../context_menus/IconizedContextMenu";
import { type ButtonEvent } from "../../elements/AccessibleButton";
import { OwnAvatar } from "./OwnAvatarButton";

/** Switch between the light and the dark theme, as the night mode switch of Telegram's menu. */
async function setDarkTheme(dark: boolean): Promise<void> {
    const theme = dark ? "dark" : "light";
    try {
        defaultDispatcher.dispatch<RecheckThemePayload>({ action: Action.RecheckTheme, forceTheme: theme });
        await Promise.all([
            SettingsStore.setValue("theme", null, SettingLevel.DEVICE, theme),
            SettingsStore.setValue("use_system_theme", null, SettingLevel.DEVICE, false),
        ]);
    } catch {
        defaultDispatcher.dispatch<RecheckThemePayload>({ action: Action.RecheckTheme });
    }
}

/**
 * Inside: the menu button left of the search over the room list in narrow windows, as the ☰ of Telegram Web:
 * the user (avatar and name, opens the settings), contacts, favourites, settings and the night mode switch.
 * Wide windows have these in the space panel and the bar under the room list.
 */
export function InsideMainMenu(): JSX.Element {
    const sdkContext = useContext(SDKContext);
    const client = useMatrixClientContext();
    const [menuDisplayed, handle, openMenu, closeMenu] = useContextMenu<HTMLButtonElement>();
    const { theme } = useTheme();
    const isDark = theme.includes("dark");
    const displayName = useEventEmitterState(
        OwnProfileStore.instance,
        UPDATE_EVENT,
        () => OwnProfileStore.instance.displayName ?? client.getSafeUserId(),
    );

    const run = (action: () => void) => (ev: ButtonEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        closeMenu();
        action();
    };
    const openSettings = (): void => defaultDispatcher.dispatch({ action: Action.ViewUserSettings });

    let contextMenu: JSX.Element | null = null;
    if (menuDisplayed && handle.current) {
        const rect = handle.current.getBoundingClientRect();
        contextMenu = (
            <IconizedContextMenu
                left={rect.left + window.scrollX}
                top={rect.bottom + window.scrollY + 8}
                chevronFace={ChevronFace.None}
                onFinished={closeMenu}
                className="mx_InsideMainMenu_menu"
                compact
            >
                <IconizedContextMenuOptionList first>
                    <IconizedContextMenuOption
                        className="mx_InsideMainMenu_profile"
                        label={displayName}
                        icon={<OwnAvatar size="32px" userId={client.getSafeUserId()} />}
                        onClick={run(openSettings)}
                    />
                </IconizedContextMenuOptionList>
                <IconizedContextMenuOptionList>
                    <IconizedContextMenuOption
                        label={_t("room_list|contacts")}
                        icon={<UserProfileIcon />}
                        onClick={run(() => defaultDispatcher.fire(Action.CreateChat))}
                    />
                    <IconizedContextMenuOption
                        label={_t("space_panel|inside_folder_favourites")}
                        icon={<FavouriteIcon />}
                        onClick={run(() => {
                            sdkContext.spaceStore.setActiveSpace(MetaSpace.Home);
                            InsideFolderStore.instance.setActiveFilter(FilterEnum.FavouriteFilter);
                        })}
                    />
                    <IconizedContextMenuOption
                        label={_t("common|settings")}
                        icon={<SettingsIcon />}
                        onClick={run(openSettings)}
                    />
                    <IconizedContextMenuCheckbox
                        label={_t("room_list|inside_night_mode")}
                        icon={<DarkModeIcon />}
                        active={isDark}
                        onClick={run(() => void setDarkTheme(!isDark))}
                    />
                </IconizedContextMenuOptionList>
            </IconizedContextMenu>
        );
    }

    return (
        <>
            <ContextMenuButton
                ref={handle}
                className="mx_InsideMainMenu_button"
                onClick={openMenu}
                isExpanded={menuDisplayed}
                label={_t("room_list|inside_menu")}
            >
                <MenuIcon />
            </ContextMenuButton>
            {contextMenu}
        </>
    );
}
