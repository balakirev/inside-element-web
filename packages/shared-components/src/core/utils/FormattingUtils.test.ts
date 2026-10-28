/*
 * Copyright 2026 Inside Estate.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "../i18n/i18n";
import { formatBytes } from "./FormattingUtils";

describe("formatBytes", () => {
    afterEach(() => {
        setLocale("en");
    });

    it.each([
        [0, "0 bytes"],
        [1, "1 byte"],
        [861, "861 bytes"],
        [1024, "1 kB"],
        [3645, "3.6 kB"],
        [9049210, "8.6 MB"],
        [1048570, "1 MB"],
        [1288490189, "1.2 GB"],
    ])("formats %d bytes in English as %s", (bytes, expected) => {
        setLocale("en");
        expect(formatBytes(bytes)).toBe(expected);
    });

    it.each([
        [861, "861 Б"],
        [3645, "3,6 кБ"],
        [9049210, "8,6 МБ"],
        [1288490189, "1,2 ГБ"],
    ])("formats %d bytes in Russian as %s", (bytes, expected) => {
        setLocale("ru");
        expect(formatBytes(bytes)).toBe(expected);
    });

    it("takes the number of decimal places", () => {
        setLocale("en");
        expect(formatBytes(9049210, 2)).toBe("8.63 MB");
        expect(formatBytes(9049210, 0)).toBe("9 MB");
    });
});
