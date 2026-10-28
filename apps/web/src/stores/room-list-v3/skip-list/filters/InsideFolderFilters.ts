/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { Room } from "matrix-js-sdk/src/matrix";
import { type Filter, FilterEnum } from ".";
import DMRoomMap from "../../../../utils/DMRoomMap";

/**
 * Inside: the room tag of the user's VIP chats, set from the room context menu. Private to the user, like
 * Favourites, but independent of the room list sections.
 */
export const VIP_TAG = "u.inside.vip";

/**
 * Local parts of the users that bridges create for people of other networks (WhatsApp, Telegram, …).
 * Such people are clients even though their Matrix account lives on our server.
 */
const BRIDGED_LOCALPART = /^(whatsapp|telegram|signal|instagram|facebook|messenger|meta|wa|tg)_/;

/** Service accounts of our server: neither colleagues nor clients. */
const SERVICE_LOCALPARTS = new Set(["insis"]);

type Counterpart = "colleague" | "client" | "service";

/**
 * Who the other side of a direct chat is: a colleague (a person with an account on our server), a client (a
 * person from another server or a bridged network), or one of our service accounts.
 */
export function getDmCounterpart(room: Room): Counterpart | undefined {
    const userId = DMRoomMap.shared().getUserIdForRoomId(room.roomId);
    if (!userId) return undefined;

    const separator = userId.indexOf(":");
    const localpart = userId.slice(1, separator);
    const server = userId.slice(separator + 1);
    const ownServer = room.client.getDomain();

    if (server !== ownServer || BRIDGED_LOCALPART.test(localpart)) return "client";
    if (SERVICE_LOCALPARTS.has(localpart)) return "service";
    return "colleague";
}

/** Direct chats with colleagues. */
export class ColleaguesFilter implements Filter {
    public matches(room: Room): boolean {
        return getDmCounterpart(room) === "colleague";
    }

    public get key(): FilterEnum.ColleaguesFilter {
        return FilterEnum.ColleaguesFilter;
    }
}

/** Direct chats with clients. */
export class ClientsFilter implements Filter {
    public matches(room: Room): boolean {
        return getDmCounterpart(room) === "client";
    }

    public get key(): FilterEnum.ClientsFilter {
        return FilterEnum.ClientsFilter;
    }
}

/** Chats the user marked as VIP. */
export class VipFilter implements Filter {
    public matches(room: Room): boolean {
        return Boolean(room.tags[VIP_TAG]);
    }

    public get key(): FilterEnum.VipFilter {
        return FilterEnum.VipFilter;
    }
}
