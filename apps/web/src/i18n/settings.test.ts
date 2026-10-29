/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import SettingsStore from "../settings/SettingsStore";
import { SettingLevel } from "../settings/SettingLevel";
import { getUserLanguage, insideResetForcedLanguage, INSIDE_LANGUAGE_AUTO_KEY, setLanguage } from "./settings";

const deviceLanguage = (): string | null =>
    SettingsStore.getValueAt(SettingLevel.DEVICE, "language", null, true, true) ?? null;

describe("Inside: automatic language", () => {
    beforeEach(async () => {
        // The device handler caches its settings: clear through it, not only localStorage.
        await SettingsStore.setValue("language", null, SettingLevel.DEVICE, null);
        window.localStorage.removeItem(INSIDE_LANGUAGE_AUTO_KEY);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await SettingsStore.setValue("language", null, SettingLevel.DEVICE, null);
        window.localStorage.removeItem(INSIDE_LANGUAGE_AUTO_KEY);
        await setLanguage("en");
    });

    it("does not store the automatically chosen language", async () => {
        await setLanguage("ru", "en");
        expect(deviceLanguage()).toBeNull();
    });

    it("resets the forced 'ru' once and remembers that", async () => {
        await SettingsStore.setValue("language", null, SettingLevel.DEVICE, "ru");
        await insideResetForcedLanguage();
        expect(deviceLanguage()).toBeNull();
        expect(window.localStorage.getItem(INSIDE_LANGUAGE_AUTO_KEY)).toBe("1");

        // A choice made after the reset is kept.
        await SettingsStore.setValue("language", null, SettingLevel.DEVICE, "ru");
        await insideResetForcedLanguage();
        expect(deviceLanguage()).toBe("ru");
    });

    it("keeps a language other than the forced 'ru'", async () => {
        await SettingsStore.setValue("language", null, SettingLevel.DEVICE, "en");
        await insideResetForcedLanguage();
        expect(deviceLanguage()).toBe("en");
    });

    it("formats in the UI language when the browser language is not shipped", async () => {
        vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["de-DE"]);
        await setLanguage("en");
        expect(getUserLanguage()).toBe("en");
    });

    it("keeps the browser's regional variant of the UI language", async () => {
        vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["en-GB"]);
        await setLanguage("en");
        expect(getUserLanguage()).toBe("en-gb");
    });
});
