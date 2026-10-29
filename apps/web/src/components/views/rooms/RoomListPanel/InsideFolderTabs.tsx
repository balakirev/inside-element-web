/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useContext, useEffect, useRef, type JSX } from "react";
import classNames from "classnames";

import { _t } from "../../../../languageHandler";
import { SDKContext } from "../../../../contexts/SDKContext.ts";
import { useEventEmitterState } from "../../../../hooks/useEventEmitter";
import { MetaSpace, UPDATE_SELECTED_SPACE } from "../../../../stores/spaces";
import {
    INSIDE_FOLDERS,
    InsideFolderStore,
    InsideFolderStoreEvent,
} from "../../../../stores/room-list-v3/InsideFolderStore";
import { useInsideFolderUnread } from "../../../../stores/room-list-v3/InsideFolderUnread";
import { FilterEnum } from "../../../../stores/room-list-v3/skip-list/filters";
import { type NotificationState } from "../../../../stores/notifications/NotificationState";
import { NotificationLevel } from "../../../../stores/notifications/NotificationLevel";
import { formatCount } from "../../../../utils/FormattingUtils";
import { prefersReducedMotion } from "../../../../utils/InsideLayout";

const folderLabels: Record<string, TranslationKey> = {
    [FilterEnum.RoomsFilter]: "space_panel|inside_folder_groups",
    [FilterEnum.ColleaguesFilter]: "space_panel|inside_folder_colleagues",
    [FilterEnum.ClientsFilter]: "space_panel|inside_folder_clients",
    [FilterEnum.VipFilter]: "space_panel|inside_folder_vip",
    [FilterEnum.FavouriteFilter]: "space_panel|inside_folder_favourites",
};

function Count({ state }: { state?: NotificationState }): JSX.Element | null {
    if (!state?.count) return null;
    return (
        <span
            className={classNames("mx_InsideFolderTabs_count", {
                mx_InsideFolderTabs_count_highlight: state.level >= NotificationLevel.Highlight,
                mx_InsideFolderTabs_count_muted: state.level < NotificationLevel.Notification,
            })}
        >
            {formatCount(state.count)}
        </span>
    );
}

/**
 * Inside: the folders of the space panel as a row of tabs over the room list, for windows too narrow for the
 * space panel — as the folder tabs of Telegram: "All", then each folder, with its number of unread chats.
 */
export function InsideFolderTabs(): JSX.Element {
    const sdkContext = useContext(SDKContext);
    const activeSpace = useEventEmitterState(
        sdkContext.spaceStore,
        UPDATE_SELECTED_SPACE,
        () => sdkContext.spaceStore.activeSpace,
    );
    const activeFilter = useEventEmitterState(
        InsideFolderStore.instance,
        InsideFolderStoreEvent.Changed,
        () => InsideFolderStore.instance.activeFilter,
    );
    const unread = useInsideFolderUnread();

    const folder = activeFilter !== undefined && INSIDE_FOLDERS.includes(activeFilter) ? activeFilter : undefined;
    const selected = activeSpace === MetaSpace.Home ? (folder ?? "all") : undefined;

    const select = (filter: FilterEnum | undefined): void => {
        sdkContext.spaceStore.setActiveSpace(MetaSpace.Home);
        InsideFolderStore.instance.setActiveFilter(filter);
    };

    // Keep the selected tab in view, as Telegram scrolls it to the middle.
    const listRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const tab = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
        tab?.scrollIntoView?.({
            behavior: prefersReducedMotion() ? "auto" : "smooth",
            block: "nearest",
            inline: "center",
        });
    }, [selected]);

    const tab = (
        key: string,
        label: string,
        state: NotificationState | undefined,
        onClick: () => void,
    ): JSX.Element => (
        <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected === key}
            className={classNames("mx_InsideFolderTabs_tab", {
                mx_InsideFolderTabs_tab_selected: selected === key,
            })}
            onClick={onClick}
        >
            <span className="mx_InsideFolderTabs_label">{label}</span>
            <Count state={state} />
        </button>
    );

    return (
        <div className="mx_InsideFolderTabs" role="tablist" aria-label={_t("room_list|inside_folders")} ref={listRef}>
            {tab("all", _t("room_list|inside_folder_all"), unread.all, () => select(undefined))}
            {INSIDE_FOLDERS.map((filter) =>
                tab(filter, _t(folderLabels[filter]), unread.folders.get(filter), () => select(filter)),
            )}
        </div>
    );
}
