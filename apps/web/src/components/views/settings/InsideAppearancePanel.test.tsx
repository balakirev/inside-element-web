/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi, type Mocked } from "vitest";
import { fireEvent, render, screen, waitFor } from "test-utils-rtl";
import React from "react";

import { InsideAppearancePanel } from "./InsideAppearancePanel";
import SettingsStore from "../../../settings/SettingsStore";
import ThemeWatcher from "../../../settings/watchers/ThemeWatcher";
import { InsideWallpaperWatcher } from "../../../settings/watchers/InsideWallpaperWatcher";
import { SettingLevel } from "../../../settings/SettingLevel";
import { Layout } from "../../../settings/enums/Layout";

vi.mock("../../../settings/watchers/ThemeWatcher");

describe("<InsideAppearancePanel />", () => {
    beforeEach(async () => {
        vi.mocked(ThemeWatcher).mockImplementation(function () {
            return {
                isSystemThemeSupported: vi.fn().mockReturnValue(true),
                getEffectiveTheme: vi.fn().mockReturnValue("light"),
                start: vi.fn(),
                stop: vi.fn(),
                on: vi.fn(),
                off: vi.fn(),
            } as unknown as Mocked<ThemeWatcher>;
        });
        await SettingsStore.setValue("use_system_theme", null, SettingLevel.DEVICE, false);
        await SettingsStore.setValue("theme", null, SettingLevel.DEVICE, "light");
        await SettingsStore.setValue("inside_chat_wallpaper", null, SettingLevel.DEVICE, "pattern");
        await SettingsStore.setValue("layout", null, SettingLevel.DEVICE, Layout.Bubble);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("offers light, dark and system themes", async () => {
        render(<InsideAppearancePanel />);
        const theme = screen.getByRole("radiogroup", { name: "Theme" });
        expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
        expect(theme.querySelectorAll("input[type=radio]")).toHaveLength(3);

        fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
        await waitFor(() => expect(SettingsStore.getValue("theme")).toBe("dark"));
        expect(SettingsStore.getValue("use_system_theme")).toBe(false);

        fireEvent.click(screen.getByRole("radio", { name: "Match system" }));
        await waitFor(() => expect(SettingsStore.getValue("use_system_theme")).toBe(true));
    });

    it("stores the chat wallpaper and reflects it on <html>", async () => {
        const watcher = new InsideWallpaperWatcher();
        watcher.start();
        try {
            expect(document.documentElement).toHaveAttribute("data-lobby-wallpaper", "pattern");
            render(<InsideAppearancePanel />);

            fireEvent.click(screen.getByRole("radio", { name: "White" }));
            await waitFor(() => expect(SettingsStore.getValue("inside_chat_wallpaper")).toBe("white"));
            await waitFor(() => expect(document.documentElement).toHaveAttribute("data-lobby-wallpaper", "white"));
        } finally {
            watcher.stop();
        }
    });

    it("shows the message layout and lets the user pick another", async () => {
        render(<InsideAppearancePanel />);
        const row = screen.getByRole("button", { name: /Message view/ });
        expect(row).toHaveTextContent("Bubbles");
        expect(row).toHaveAttribute("aria-expanded", "false");

        fireEvent.click(row);
        fireEvent.click(screen.getByRole("radio", { name: "IRC (experimental)" }));
        await waitFor(() => expect(SettingsStore.getValue("layout")).toBe(Layout.IRC));
    });

    it("maps the toggles to 24-hour time and the room list previews", async () => {
        const setValue = vi.spyOn(SettingsStore, "setValue").mockResolvedValue();
        const twelveHour = SettingsStore.getValue("showTwelveHourTimestamps");
        const previews = SettingsStore.getValue("RoomList.showMessagePreview");
        render(<InsideAppearancePanel />);

        fireEvent.click(screen.getByRole("switch", { name: "24-hour time" }));
        expect(setValue).toHaveBeenCalledWith("showTwelveHourTimestamps", null, SettingLevel.ACCOUNT, !twelveHour);

        fireEvent.click(screen.getByRole("switch", { name: "Compact chat list" }));
        expect(setValue).toHaveBeenCalledWith("RoomList.showMessagePreview", null, SettingLevel.DEVICE, !previews);
    });

    it("changes the message text size with the slider", async () => {
        render(<InsideAppearancePanel />);
        fireEvent.change(screen.getByRole("slider", { name: "Text size" }), { target: { value: "2" } });
        await waitFor(() => expect(SettingsStore.getValue("fontSizeDelta")).toBe(2));
    });
});
