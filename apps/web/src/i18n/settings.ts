/*
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { logger } from "matrix-js-sdk/src/logger";
import {
    normalizeLanguageKey,
    getLangsJson,
    getLocale,
    registerTranslations,
    setLocale,
} from "@element-hq/web-shared-components";

import SettingsStore from "../settings/SettingsStore";
import PlatformPeg from "../PlatformPeg";
import { SettingLevel } from "../settings/SettingLevel";
import { getLanguageRetry } from "./languages";
import { getLanguageFromBrowser } from "./browser";
import { registerCustomTranslations } from "./custom";

export function getUserLanguage(): string {
    const language = SettingsStore.getValue("language", null, /*excludeDefault:*/ true);
    if (typeof language === "string" && language !== "") {
        return language;
    } else {
        // INSIDE: the automatic language is not stored (see setLanguage), so formats follow the
        // language the UI actually uses. The browser's regional variant (en-gb, ru-ru) is kept when
        // it is the same language; a browser language we do not ship (de) must not mix German
        // dates into the English UI.
        const browser = normalizeLanguageKey(getLanguageFromBrowser());
        const current = getLocale();
        return browser.split("-")[0] === current.split("-")[0] ? browser : current;
    }
}

export async function setLanguage(...preferredLangs: string[]): Promise<void> {
    PlatformPeg.get()?.setLanguage(preferredLangs);

    const availableLanguages = await getLangsJson();
    let chosenLanguage = preferredLangs.find((lang) => availableLanguages.hasOwnProperty(lang));
    if (!chosenLanguage) {
        // Fallback to en_EN if none is found
        chosenLanguage = "en";
        logger.error("Unable to find an appropriate language, preferred: ", preferredLangs);
    }

    const languageData = await getLanguageRetry(availableLanguages[chosenLanguage]);

    registerTranslations(chosenLanguage, languageData);
    setLocale(chosenLanguage);

    // INSIDE: upstream stores the chosen language on the device every time, which freezes the
    // browser language of the first visit. We store only an explicit choice (Settings → Language,
    // the language selector on auth pages write the setting themselves), so without one the app
    // follows the system language on every start.
    // Adds a lot of noise to test runs, so disable logging there.
    // oxlint-disable-next-line node/no-process-env
    if (process.env.NODE_ENV !== "test") {
        logger.log("set language to " + chosenLanguage);
    }

    // Set 'en' as fallback language:
    if (chosenLanguage !== "en") {
        const fallbackLanguageData = await getLanguageRetry(availableLanguages["en"]);
        registerTranslations("en", fallbackLanguageData);
    }

    await registerCustomTranslations();
}

/**
 * INSIDE: localStorage flag of the one-time language reset below. Lifecycle.clearStorage keeps it
 * across logout, like the language itself, so a language chosen after the reset survives a re-login.
 */
export const INSIDE_LANGUAGE_AUTO_KEY = "inside_language_auto_v1";

/**
 * INSIDE: one-time reset of the language stored on this device.
 *
 * Until build -30 our config forced `language: "ru"` and upstream stored it on the device at every
 * start, so every device has "ru" saved whether the person chose it or not. Russian is dropped once,
 * and the app then follows the system language. Any other stored value can only be an explicit
 * choice (the forced value was always "ru"), so it is kept.
 */
export async function insideResetForcedLanguage(): Promise<void> {
    try {
        if (window.localStorage.getItem(INSIDE_LANGUAGE_AUTO_KEY)) return;
        if (SettingsStore.getValueAt(SettingLevel.DEVICE, "language", null, true, true) === "ru") {
            await SettingsStore.setValue("language", null, SettingLevel.DEVICE, null);
        }
        window.localStorage.setItem(INSIDE_LANGUAGE_AUTO_KEY, "1");
    } catch (e) {
        logger.warn("Unable to reset the stored language", e);
    }
}
