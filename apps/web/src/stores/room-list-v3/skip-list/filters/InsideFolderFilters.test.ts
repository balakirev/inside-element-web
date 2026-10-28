/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Room } from "matrix-js-sdk/src/matrix";

import DMRoomMap from "../../../../utils/DMRoomMap";
import { ClientsFilter, ColleaguesFilter, VIP_TAG, VipFilter } from "./InsideFolderFilters";

describe("Inside folder filters", () => {
    let dmUserByRoom: Record<string, string>;

    beforeEach(() => {
        dmUserByRoom = {};
        vi.spyOn(DMRoomMap, "shared").mockReturnValue({
            getUserIdForRoomId: (roomId: string) => dmUserByRoom[roomId],
        } as unknown as DMRoomMap);
    });

    const room = (roomId: string, dmUserId?: string, tags: Record<string, object> = {}): Room => {
        if (dmUserId) dmUserByRoom[roomId] = dmUserId;
        return { roomId, tags, client: { getDomain: () => "lobby.example" } } as unknown as Room;
    };

    it.each([
        ["a person of our server", "@anna:lobby.example", true, false],
        ["a person of another server", "@bob:other.example", false, true],
        ["a WhatsApp contact bridged to our server", "@whatsapp_971500000000:lobby.example", false, true],
        ["a Telegram contact bridged to our server", "@telegram_12345:lobby.example", false, true],
        ["our INSIS bot", "@insis:lobby.example", false, false],
    ])("sorts a direct chat with %s", (_, userId, colleague, client) => {
        const r = room("!dm:lobby.example", userId);
        expect(new ColleaguesFilter().matches(r)).toBe(colleague);
        expect(new ClientsFilter().matches(r)).toBe(client);
    });

    it("leaves group chats out of colleagues and clients", () => {
        const r = room("!group:lobby.example");
        expect(new ColleaguesFilter().matches(r)).toBe(false);
        expect(new ClientsFilter().matches(r)).toBe(false);
    });

    it("matches the chats marked VIP", () => {
        expect(new VipFilter().matches(room("!a:lobby.example", undefined, { [VIP_TAG]: {} }))).toBe(true);
        expect(new VipFilter().matches(room("!b:lobby.example"))).toBe(false);
    });
});
