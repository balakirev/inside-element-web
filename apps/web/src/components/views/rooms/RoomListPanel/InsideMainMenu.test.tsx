/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen } from "test-utils-rtl";
import { clientAndSDKContextRenderOptions, createTestClient, TestSDKContext } from "test-utils";
import userEvent from "@testing-library/user-event";

import { InsideMainMenu } from "./InsideMainMenu";
import defaultDispatcher from "../../../../dispatcher/dispatcher";
import { Action } from "../../../../dispatcher/actions";
import { MetaSpace } from "../../../../stores/spaces";
import type SpaceStore from "../../../../stores/spaces/SpaceStore";
import SettingsStore from "../../../../settings/SettingsStore";
import { SettingLevel } from "../../../../settings/SettingLevel";
import { InsideFolderStore } from "../../../../stores/room-list-v3/InsideFolderStore";
import { FilterEnum } from "../../../../stores/room-list-v3/skip-list/filters";

describe("<InsideMainMenu />", () => {
    const client = createTestClient();
    const sdkContext = new TestSDKContext();
    sdkContext._client = client;
    sdkContext._SpaceStore = { setActiveSpace: vi.fn() } as unknown as SpaceStore;

    const openMenu = async () => {
        render(<InsideMainMenu />, clientAndSDKContextRenderOptions(client, sdkContext));
        await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });
    afterEach(() => {
        InsideFolderStore.instance.setActiveFilter(undefined);
    });

    it("lists the user, contacts, favourites, settings and night mode", async () => {
        await openMenu();
        const items = screen.getAllByRole("menuitem").map((i) => i.textContent);
        expect(items.slice(1)).toEqual(["Contacts", "Favourites", "Settings"]);
        expect(screen.getByRole("menuitemcheckbox", { name: "Night mode" })).toHaveAttribute("aria-checked", "false");
    });

    it("opens the settings from the user", async () => {
        const dispatch = vi.spyOn(defaultDispatcher, "dispatch");
        await openMenu();
        await userEvent.click(screen.getAllByRole("menuitem")[0]);
        expect(dispatch).toHaveBeenCalledWith({ action: Action.ViewUserSettings });
        expect(screen.queryByRole("menu")).toBeNull();
    });

    it("opens the contacts", async () => {
        const fire = vi.spyOn(defaultDispatcher, "fire");
        await openMenu();
        await userEvent.click(screen.getByRole("menuitem", { name: "Contacts" }));
        expect(fire).toHaveBeenCalledWith(Action.CreateChat);
    });

    it("shows the favourites folder", async () => {
        await openMenu();
        await userEvent.click(screen.getByRole("menuitem", { name: "Favourites" }));
        expect(sdkContext.spaceStore.setActiveSpace).toHaveBeenCalledWith(MetaSpace.Home);
        expect(InsideFolderStore.instance.activeFilter).toBe(FilterEnum.FavouriteFilter);
    });

    it("switches to the dark theme", async () => {
        const setValue = vi.spyOn(SettingsStore, "setValue").mockResolvedValue(undefined);
        await openMenu();
        await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Night mode" }));
        expect(setValue).toHaveBeenCalledWith("theme", null, SettingLevel.DEVICE, "dark");
        expect(setValue).toHaveBeenCalledWith("use_system_theme", null, SettingLevel.DEVICE, false);
    });
});
