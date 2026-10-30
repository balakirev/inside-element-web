/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockIntlDateTimeFormat, unmockIntlDateTimeFormat } from "test-utils/date";

import { fillTemplate, formatClientLocalTime, formatWindowLeft, getServiceWindow } from "./clientTime";

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 30, 14, 40);

describe("service window", () => {
    it("is open with the time left, closed after it ends, absent when the channel has none", () => {
        expect(getServiceWindow({ serviceWindowUntil: NOW + 21.5 * HOUR }, NOW)).toEqual({
            kind: "open",
            leftMs: 21.5 * HOUR,
        });
        expect(getServiceWindow({ serviceWindowUntil: NOW - 1 }, NOW)).toEqual({ kind: "closed" });
        expect(getServiceWindow({ serviceWindowUntil: NOW }, NOW)).toEqual({ kind: "closed" });
        expect(getServiceWindow({}, NOW)).toEqual({ kind: "none" });
    });

    it("formats what is left in whole hours, then minutes", () => {
        expect(formatWindowLeft(21.9 * HOUR)).toBe("21 h");
        expect(formatWindowLeft(HOUR)).toBe("1 h");
        expect(formatWindowLeft(35 * 60 * 1000 + 59 * 1000)).toBe("35 min");
        expect(formatWindowLeft(10 * 1000)).toBe("1 min");
    });
});

describe("client's local time", () => {
    // The tests pin Intl to UTC; the client's zone is the point here.
    beforeEach(() => unmockIntlDateTimeFormat());
    afterEach(() => mockIntlDateTimeFormat());

    it("is now in the client's time zone", () => {
        expect(formatClientLocalTime("Asia/Dubai", NOW, "en")).toBe("18:40");
        expect(formatClientLocalTime("Europe/London", NOW, "en")).toBe("14:40");
    });

    it("is absent without a valid zone", () => {
        expect(formatClientLocalTime(undefined, NOW)).toBeUndefined();
        expect(formatClientLocalTime("Mars/Olympus", NOW)).toBeUndefined();
    });
});

describe("templates", () => {
    it("fill in the client's first name", () => {
        expect(fillTemplate("{{name}}, добрый день! {{ name }}", { displayName: "Алина Касымова" })).toBe(
            "Алина, добрый день! Алина",
        );
    });
});
