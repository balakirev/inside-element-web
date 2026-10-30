/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import SettingsStore from "../SettingsStore";
import type IWatcher from "./Watcher";

/** Inside: the chat wallpaper — the Inside pattern, its plain colour, or the panel colour ("white"). */
export type InsideChatWallpaper = "pattern" | "plain" | "white";

export const INSIDE_CHAT_WALLPAPERS: readonly InsideChatWallpaper[] = ["pattern", "plain", "white"];

/** The attribute on <html> the Inside skin reads to draw the chat wallpaper. */
const INSIDE_WALLPAPER_ATTRIBUTE = "data-lobby-wallpaper";

export function insideChatWallpaper(value: unknown): InsideChatWallpaper {
    return INSIDE_CHAT_WALLPAPERS.includes(value as InsideChatWallpaper) ? (value as InsideChatWallpaper) : "pattern";
}

/**
 * Inside: reflects the `inside_chat_wallpaper` device setting as `<html data-lobby-wallpaper="…">`,
 * so the skin (inside-skin.css, «Обои») draws the pattern, the plain colour or white behind the timeline.
 */
export class InsideWallpaperWatcher implements IWatcher {
    private watcherRef?: string;

    public start(): void {
        this.apply();
        this.watcherRef = SettingsStore.watchSetting("inside_chat_wallpaper", null, this.apply);
    }

    public stop(): void {
        if (this.watcherRef) SettingsStore.unwatchSetting(this.watcherRef);
        this.watcherRef = undefined;
    }

    private apply = (): void => {
        const value = insideChatWallpaper(SettingsStore.getValue("inside_chat_wallpaper"));
        document.documentElement.setAttribute(INSIDE_WALLPAPER_ATTRIBUTE, value);
    };
}
