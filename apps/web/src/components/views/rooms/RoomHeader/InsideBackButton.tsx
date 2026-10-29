/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { ArrowLeftIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import classNames from "classnames";

import { _t } from "../../../../languageHandler";
import AccessibleButton from "../../elements/AccessibleButton";
import { useInsideFolderUnread } from "../../../../stores/room-list-v3/InsideFolderUnread";
import { NotificationLevel } from "../../../../stores/notifications/NotificationLevel";
import { formatCount } from "../../../../utils/FormattingUtils";
import { goBackToRoomList } from "../../../../utils/InsideMobileNavigation";

/**
 * Inside: the back arrow at the start of the room header in the one-column (mobile) layout, as in Telegram Web:
 * it returns to the room list, and carries the number of unread chats.
 */
export function InsideBackButton(): JSX.Element {
    const unread = useInsideFolderUnread().all;
    const count = unread?.count ?? 0;
    const label = count ? _t("room|header|inside_back_unread", { count }) : _t("action|back");
    return (
        <AccessibleButton
            className="mx_RoomHeader_inside_back"
            aria-label={label}
            title={label}
            onClick={(ev) => goBackToRoomList(ev.currentTarget)}
        >
            <ArrowLeftIcon aria-hidden />
            {count > 0 && (
                <span
                    className={classNames("mx_RoomHeader_inside_backBadge", {
                        mx_RoomHeader_inside_backBadge_highlight: (unread?.level ?? 0) >= NotificationLevel.Highlight,
                    })}
                    aria-hidden
                >
                    {formatCount(count)}
                </span>
            )}
        </AccessibleButton>
    );
}
