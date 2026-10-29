/*
 * Copyright 2025 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import counterpart from "counterpart";
import { vi, describe, it, beforeEach, expect } from "vitest";

import { registerTranslations, setMissingEntryGenerator, getLocale, setLocale } from "./i18n";

describe("i18n utils", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should wrap registerTranslations", () => {
        vi.spyOn(counterpart, "registerTranslations");

        registerTranslations("en", { test: "This is a test" });
        expect(counterpart.registerTranslations).toHaveBeenCalledWith("en", { test: "This is a test" });
    });

    it("picks Russian plural forms by the language's rules (Inside)", () => {
        registerTranslations("ru", {
            replies: { one: "%(count)s ответ", few: "%(count)s ответа", many: "%(count)s ответов", other: "%(count)s ответов" },
        });
        const t = (count: number): string =>
            counterpart.translate("replies", { locale: "ru", count, interpolate: false }) as unknown as string;
        expect([1, 2, 3, 4, 5, 11, 21, 22, 25].map(t)).toEqual([
            "%(count)s ответ",
            "%(count)s ответа",
            "%(count)s ответа",
            "%(count)s ответа",
            "%(count)s ответов",
            "%(count)s ответов",
            "%(count)s ответ",
            "%(count)s ответа",
            "%(count)s ответов",
        ]);
    });

    it("keeps English plurals as one/other (Inside)", () => {
        registerTranslations("en", { members: { one: "%(count)s member", other: "%(count)s members" } });
        const t = (count: number): string =>
            counterpart.translate("members", { locale: "en", count, interpolate: false }) as unknown as string;
        expect([1, 2, 5].map(t)).toEqual(["%(count)s member", "%(count)s members", "%(count)s members"]);
    });

    it("should wrap setMissingEntryGenerator", () => {
        vi.spyOn(counterpart, "setMissingEntryGenerator");

        const dummyFn = vi.fn();

        setMissingEntryGenerator(dummyFn);
        expect(counterpart.setMissingEntryGenerator).toHaveBeenCalledWith(dummyFn);
    });

    it("should wrap getLocale", () => {
        vi.spyOn(counterpart, "getLocale");

        getLocale();
        expect(counterpart.getLocale).toHaveBeenCalled();
    });

    it("should wrap setLocale", () => {
        vi.spyOn(counterpart, "setLocale");

        setLocale("en");
        expect(counterpart.setLocale).toHaveBeenCalledWith("en");
    });
});
