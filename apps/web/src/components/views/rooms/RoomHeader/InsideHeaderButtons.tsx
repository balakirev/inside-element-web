/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// Inside: the "Search" and "More" buttons of the room header (Lobby redesign, header capsule of
// round buttons: search, threads, room info, more).

import React, { type JSX, useState } from "react";
import { IconButton, Menu, Tooltip } from "@vector-im/compound-web";
import SearchIcon from "@vector-im/compound-design-tokens/assets/web/icons/search";
import OverflowHorizontalIcon from "@vector-im/compound-design-tokens/assets/web/icons/overflow-horizontal";
import { MoreOptionContent, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import { _t } from "../../../../languageHandler";
import defaultDispatcher from "../../../../dispatcher/dispatcher";
import { Action } from "../../../../dispatcher/actions";
import { RoomListItemViewModel } from "../../../../viewmodels/room-list/RoomListItemViewModel";
import { hasAccessToOptionsMenu } from "../../../../viewmodels/room-list/utils";

/**
 * Opens the message search of the room, as Ctrl+F does: the room summary card in the right panel
 * with its search field focused.
 */
export function InsideSearchButton(): JSX.Element {
    return (
        <Tooltip label={_t("action|search")}>
            <IconButton
                className="mx_RoomHeader_inside_search"
                onClick={(evt) => {
                    evt.stopPropagation();
                    defaultDispatcher.fire(Action.FocusMessageSearch);
                }}
                aria-label={_t("action|search")}
            >
                <SearchIcon />
            </IconButton>
        </Tooltip>
    );
}

/** The menu of the room list item's "…", built for the room only while the menu is open. */
function MoreMenuContent({ room, client }: { room: Room; client: MatrixClient }): JSX.Element {
    const vm = useCreateAutoDisposedViewModel(() => new RoomListItemViewModel({ room, client }));
    return <MoreOptionContent vm={vm} />;
}

/**
 * Opens, below the button, the same room options menu as the "…" of the room list item.
 */
export function InsideMoreButton({ room, client }: { room: Room; client: MatrixClient }): JSX.Element | null {
    const [open, setOpen] = useState(false);
    if (!hasAccessToOptionsMenu(room)) return null;

    return (
        <Menu
            open={open}
            onOpenChange={setOpen}
            title={_t("room|header|more")}
            showTitle={false}
            side="bottom"
            align="end"
            trigger={
                <IconButton
                    className="mx_RoomHeader_inside_more"
                    tooltip={_t("room|header|more")}
                    aria-label={_t("room|header|more")}
                >
                    <OverflowHorizontalIcon />
                </IconButton>
            }
        >
            <MoreMenuContent key={room.roomId} room={room} client={client} />
        </Menu>
    );
}
