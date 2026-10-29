/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import defaultDispatcher from "../dispatcher/dispatcher";
import { Action } from "../dispatcher/actions";
import {
    goBackToRoomList,
    INSIDE_COLUMN_TRANSITION_MS,
    LEAVING_CLASS,
    startInsideMobileNavigation,
    stopInsideMobileNavigation,
    wasRoomOpenedFromList,
} from "./InsideMobileNavigation";

function goTo(hash: string): void {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
}

describe("InsideMobileNavigation", () => {
    beforeEach(() => {
        window.location.hash = "#/home";
        startInsideMobileNavigation();
        vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    });

    afterEach(() => {
        stopInsideMobileNavigation();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("knows a room opened from the list", () => {
        goTo("#/room/!a:server");
        expect(wasRoomOpenedFromList()).toBe(true);
        goTo("#/room/!b:server");
        expect(wasRoomOpenedFromList()).toBe(false);
    });

    it("goes back in the history to the list the room was opened from", () => {
        const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
        const dispatch = vi.spyOn(defaultDispatcher, "dispatch");
        goTo("#/room/!a:server");

        goBackToRoomList();

        expect(back).toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it("opens the list for a room opened otherwise", () => {
        const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
        const dispatch = vi.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        goTo("#/room/!a:server");
        goTo("#/room/!b:server");

        goBackToRoomList();

        expect(back).not.toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledWith({ action: Action.ViewHomePage });
    });

    it("slides the room out before showing the list", () => {
        vi.useFakeTimers();
        const dispatch = vi.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        const column = document.createElement("div");
        column.className = "mx_RoomView_wrapper";
        const button = document.createElement("button");
        column.append(button);

        goBackToRoomList(button);
        expect(column.classList.contains(LEAVING_CLASS)).toBe(true);
        expect(dispatch).not.toHaveBeenCalled();

        vi.advanceTimersByTime(INSIDE_COLUMN_TRANSITION_MS);
        expect(dispatch).toHaveBeenCalledWith({ action: Action.ViewHomePage });

        vi.advanceTimersByTime(1200);
        expect(column.classList.contains(LEAVING_CLASS)).toBe(false);
    });

    it("does not animate when the system asks for less motion", () => {
        vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
        const dispatch = vi.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        const column = document.createElement("div");
        column.className = "mx_RoomView_wrapper";
        const button = document.createElement("button");
        column.append(button);

        goBackToRoomList(button);

        expect(column.classList.contains(LEAVING_CLASS)).toBe(false);
        expect(dispatch).toHaveBeenCalledWith({ action: Action.ViewHomePage });
    });
});
