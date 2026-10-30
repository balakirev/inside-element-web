/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useId, useState } from "react";
import classNames from "classnames";
import ChevronRightIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-right";
import CheckIcon from "@vector-im/compound-design-tokens/assets/web/icons/check";

import { _t } from "../../../languageHandler";
import SettingsStore from "../../../settings/SettingsStore";
import { SettingLevel } from "../../../settings/SettingLevel";
import { useSettingValue } from "../../../hooks/useSettings";
import { useTheme } from "../../../hooks/useTheme";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type RecheckThemePayload } from "../../../dispatcher/payloads/RecheckThemePayload";
import { Layout } from "../../../settings/enums/Layout";
import { FontWatcher } from "../../../settings/watchers/FontWatcher";
import {
    INSIDE_CHAT_WALLPAPERS,
    insideChatWallpaper,
    type InsideChatWallpaper,
} from "../../../settings/watchers/InsideWallpaperWatcher";
import ToggleSwitch from "../elements/ToggleSwitch";
import AccessibleButton from "../elements/AccessibleButton";

/**
 * Inside: the Appearance screen of other messengers — theme cards, chat wallpaper and one card of text
 * and message options — instead of Element's theme, layout, font and image size panels.
 */
export function InsideAppearancePanel(): JSX.Element {
    return (
        <div className="mx_InsideAppearance" data-testid="mx_InsideAppearance">
            <InsideThemeChoice />
            <InsideWallpaperChoice />
            <InsideTextAndMessages />
        </div>
    );
}

function Group({
    heading,
    children,
    footnote,
}: {
    heading: string;
    children: React.ReactNode;
    footnote?: string;
}): JSX.Element {
    const id = useId();
    return (
        <section className="mx_InsideAppearance_group" aria-labelledby={id}>
            <h3 className="mx_InsideAppearance_heading" id={id}>
                {heading}
            </h3>
            <div className="mx_InsideAppearance_card">{children}</div>
            {footnote && <p className="mx_InsideAppearance_footnote">{footnote}</p>}
        </section>
    );
}

interface TileProps {
    name: string;
    value: string;
    checked: boolean;
    label: string;
    preview: React.ReactNode;
    onSelect: (value: string) => void;
}

/** A preview tile with a hidden native radio button: click, arrows and screen readers as a radio group. */
function Tile({ name, value, checked, label, preview, onSelect }: TileProps): JSX.Element {
    return (
        <label className={classNames("mx_InsideAppearance_tile", { mx_InsideAppearance_tile_on: checked })}>
            <input
                className="mx_InsideAppearance_radio"
                type="radio"
                name={name}
                value={value}
                checked={checked}
                onChange={() => onSelect(value)}
            />
            {preview}
            <span className="mx_InsideAppearance_tileLabel">{label}</span>
        </label>
    );
}

type ThemeChoice = "light" | "dark" | "system";

function ThemePreview({ kind }: { kind: "light" | "dark" }): JSX.Element {
    return (
        <span className={classNames("mx_InsideAppearance_themePreview", `cpd-theme-${kind}`)} aria-hidden={true}>
            <i className="mx_InsideAppearance_themePreview_rail" />
            <i className="mx_InsideAppearance_themePreview_in" />
            <i className="mx_InsideAppearance_themePreview_out" />
        </span>
    );
}

function InsideThemeChoice(): JSX.Element {
    const { theme, systemThemeActivated } = useTheme();
    const name = useId();
    // High contrast and custom themes are not offered here; a light high contrast theme shows as "Light".
    const current: ThemeChoice = systemThemeActivated ? "system" : String(theme).includes("dark") ? "dark" : "light";

    const onSelect = async (value: string): Promise<void> => {
        const choice = value as ThemeChoice;
        if (choice === current) return;
        if (choice === "system") {
            await SettingsStore.setValue("use_system_theme", null, SettingLevel.DEVICE, true);
            dis.dispatch<RecheckThemePayload>({ action: Action.RecheckTheme });
            return;
        }
        await SettingsStore.setValue("use_system_theme", null, SettingLevel.DEVICE, false);
        // As ThemeChoicePanel: the setting echoes late, so force the theme for the immediate recheck.
        SettingsStore.setValue("theme", null, SettingLevel.DEVICE, choice).catch(() => {
            dis.dispatch<RecheckThemePayload>({ action: Action.RecheckTheme });
        });
        dis.dispatch<RecheckThemePayload>({ action: Action.RecheckTheme, forceTheme: choice });
    };

    const choices: Array<{ value: ThemeChoice; label: string; preview: React.ReactNode }> = [
        {
            value: "light",
            label: _t("settings|appearance|inside_theme_light"),
            preview: <ThemePreview kind="light" />,
        },
        {
            value: "dark",
            label: _t("settings|appearance|inside_theme_dark"),
            preview: <ThemePreview kind="dark" />,
        },
        {
            value: "system",
            label: _t("settings|appearance|inside_theme_system"),
            preview: (
                <span className="mx_InsideAppearance_themePreview_split" aria-hidden={true}>
                    <ThemePreview kind="light" />
                    <ThemePreview kind="dark" />
                </span>
            ),
        },
    ];

    return (
        <Group heading={_t("common|theme")}>
            <div className="mx_InsideAppearance_tiles" role="radiogroup" aria-label={_t("common|theme")}>
                {choices.map((c) => (
                    <Tile
                        key={c.value}
                        name={name}
                        value={c.value}
                        checked={current === c.value}
                        label={c.label}
                        preview={c.preview}
                        onSelect={onSelect}
                    />
                ))}
            </div>
        </Group>
    );
}

function InsideWallpaperChoice(): JSX.Element {
    const current = insideChatWallpaper(useSettingValue("inside_chat_wallpaper"));
    const name = useId();
    const labels: Record<InsideChatWallpaper, string> = {
        pattern: _t("settings|appearance|inside_wallpaper_pattern"),
        plain: _t("settings|appearance|inside_wallpaper_plain"),
        white: _t("settings|appearance|inside_wallpaper_white"),
    };
    const onSelect = (value: string): void => {
        void SettingsStore.setValue("inside_chat_wallpaper", null, SettingLevel.DEVICE, insideChatWallpaper(value));
    };
    const heading = _t("settings|appearance|inside_wallpaper");

    return (
        <Group heading={heading}>
            <div className="mx_InsideAppearance_tiles" role="radiogroup" aria-label={heading}>
                {INSIDE_CHAT_WALLPAPERS.map((w) => (
                    <Tile
                        key={w}
                        name={name}
                        value={w}
                        checked={current === w}
                        label={labels[w]}
                        preview={
                            <span className="mx_InsideAppearance_wallPreview" data-wallpaper={w} aria-hidden={true} />
                        }
                        onSelect={onSelect}
                    />
                ))}
            </div>
        </Group>
    );
}

/** Message text sizes offered by the slider, as deltas from the browser's default font size. */
const FONT_DELTA_MIN = -3;
const FONT_DELTA_MAX = 6;

function layoutLabel(layout: Layout): string {
    switch (layout) {
        case Layout.Bubble:
            return _t("settings|appearance|inside_layout_bubbles");
        case Layout.IRC:
            return _t("settings|appearance|layout_irc");
        case Layout.Group:
        default:
            return _t("common|modern");
    }
}

function InsideTextAndMessages(): JSX.Element {
    const fontSizeDelta = useSettingValue("fontSizeDelta");
    const [browserFontSize] = useState(() => FontWatcher.getBrowserDefaultFontSize());
    const layout = useSettingValue("layout");
    const compactLayout = useSettingValue("useCompactLayout");
    const twelveHour = useSettingValue("showTwelveHourTimestamps");
    const showPreviews = useSettingValue("RoomList.showMessagePreview");
    const [layoutOpen, setLayoutOpen] = useState(false);
    const layoutName = useId();
    const layoutListId = useId();
    const sizeLabelId = useId();

    const delta = Math.min(FONT_DELTA_MAX, Math.max(FONT_DELTA_MIN, fontSizeDelta));
    const onFontSize = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const value = parseInt(e.target.value, 10) || 0;
        void SettingsStore.setValue("fontSizeDelta", null, SettingLevel.DEVICE, value);
    };
    const onLayout = (value: Layout): void => {
        void SettingsStore.setValue("layout", null, SettingLevel.DEVICE, value);
    };
    const percent = ((delta - FONT_DELTA_MIN) / (FONT_DELTA_MAX - FONT_DELTA_MIN)) * 100;

    return (
        <Group
            heading={_t("settings|appearance|inside_text_and_messages")}
            footnote={_t("settings|appearance|inside_text_note")}
        >
            <div className="mx_InsideAppearance_row mx_InsideAppearance_fontSize">
                <span id={sizeLabelId}>{_t("settings|appearance|inside_text_size")}</span>
                <span className="mx_InsideAppearance_slider">
                    <span className="mx_InsideAppearance_slider_small" aria-hidden={true}>
                        A
                    </span>
                    <input
                        type="range"
                        min={FONT_DELTA_MIN}
                        max={FONT_DELTA_MAX}
                        step={1}
                        value={delta}
                        onChange={onFontSize}
                        aria-labelledby={sizeLabelId}
                        aria-valuetext={String(browserFontSize + delta)}
                        style={{ "--mx-inside-slider-fill": `${percent}%` } as React.CSSProperties}
                    />
                    <span className="mx_InsideAppearance_slider_big" aria-hidden={true}>
                        A
                    </span>
                </span>
                <span className="mx_InsideAppearance_value">{browserFontSize + delta}</span>
            </div>
            <AccessibleButton
                className="mx_InsideAppearance_row mx_InsideAppearance_rowButton"
                onClick={() => setLayoutOpen(!layoutOpen)}
                aria-expanded={layoutOpen}
                aria-controls={layoutListId}
            >
                <span>{_t("settings|appearance|inside_message_view")}</span>
                <span className="mx_InsideAppearance_value">{layoutLabel(layout)}</span>
                <ChevronRightIcon
                    className={classNames("mx_InsideAppearance_chevron", {
                        mx_InsideAppearance_chevron_open: layoutOpen,
                    })}
                    aria-hidden={true}
                />
            </AccessibleButton>
            {layoutOpen && (
                <div
                    className="mx_InsideAppearance_options"
                    id={layoutListId}
                    role="radiogroup"
                    aria-label={_t("settings|appearance|inside_message_view")}
                >
                    {[Layout.Bubble, Layout.Group, Layout.IRC].map((l) => (
                        <label key={l} className="mx_InsideAppearance_option">
                            <input
                                className="mx_InsideAppearance_radio"
                                type="radio"
                                name={layoutName}
                                value={l}
                                checked={layout === l}
                                onChange={() => onLayout(l)}
                            />
                            <span>{layoutLabel(l)}</span>
                            {layout === l && <CheckIcon className="mx_InsideAppearance_check" aria-hidden={true} />}
                        </label>
                    ))}
                    {layout === Layout.Group && (
                        <div className="mx_InsideAppearance_option">
                            <span>{_t("settings|appearance|compact_layout")}</span>
                            <ToggleSwitch
                                checked={compactLayout}
                                title={_t("settings|appearance|compact_layout")}
                                onChange={(checked) =>
                                    void SettingsStore.setValue("useCompactLayout", null, SettingLevel.DEVICE, checked)
                                }
                            />
                        </div>
                    )}
                </div>
            )}
            <div className="mx_InsideAppearance_row">
                <span>{_t("settings|appearance|inside_24_hour")}</span>
                <ToggleSwitch
                    checked={!twelveHour}
                    title={_t("settings|appearance|inside_24_hour")}
                    onChange={(checked) =>
                        void SettingsStore.setValue("showTwelveHourTimestamps", null, SettingLevel.ACCOUNT, !checked)
                    }
                />
            </div>
            <div className="mx_InsideAppearance_row">
                <span>{_t("settings|appearance|inside_compact_room_list")}</span>
                <ToggleSwitch
                    checked={!showPreviews}
                    title={_t("settings|appearance|inside_compact_room_list")}
                    onChange={(checked) =>
                        void SettingsStore.setValue("RoomList.showMessagePreview", null, SettingLevel.DEVICE, !checked)
                    }
                />
            </div>
        </Group>
    );
}
