/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { RoomMember } from "matrix-js-sdk/src/matrix";
import { mkEvent } from "test-utils";

import { getMemberNameWithoutMxid, getSenderName, needsMxidForSafety } from "./getSenderName";

function mkMember(userId: string, rawDisplayName: string, disambiguate: boolean): RoomMember {
    const member = new RoomMember("!room:server", userId);
    member.rawDisplayName = rawDisplayName;
    member.disambiguate = disambiguate;
    member.name = disambiguate ? `${rawDisplayName} (${userId})` : rawDisplayName;
    return member;
}

describe("getMemberNameWithoutMxid", () => {
    it("drops the Matrix ID added for members sharing a display name", () => {
        expect(getMemberNameWithoutMxid(mkMember("@testuser:server", "Дмитрий Балакирев", true))).toBe(
            "Дмитрий Балакирев",
        );
    });

    it("keeps a name that is not disambiguated", () => {
        expect(getMemberNameWithoutMxid(mkMember("@dmitry:server", "Дмитрий", false))).toBe("Дмитрий");
    });

    it.each(["@dmitry:server", "Dmitry ‮yrtimd"])("keeps the Matrix ID for %s", (rawDisplayName) => {
        const member = mkMember("@evil:server", rawDisplayName, true);
        expect(getMemberNameWithoutMxid(member)).toBe(member.name);
    });

    it("is used for the sender name", () => {
        const event = mkEvent({
            event: true,
            type: "m.room.message",
            room: "!room:server",
            user: "@a:server",
            content: {},
        });
        event.sender = mkMember("@a:server", "Alice", true);
        expect(getSenderName(event)).toBe("Alice");
    });
});

describe("needsMxidForSafety", () => {
    it("needs it without a display name", () => {
        expect(needsMxidForSafety(undefined)).toBe(true);
    });
});
