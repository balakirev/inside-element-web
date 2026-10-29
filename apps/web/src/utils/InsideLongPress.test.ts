/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isIOS, LONG_PRESS_MS, startInsideLongPress, stopInsideLongPress } from "./InsideLongPress";

function touch(type: string, target: Element, x = 10, y = 20): void {
    const ev = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
    Object.defineProperty(ev, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: y }] });
    target.dispatchEvent(ev);
}

describe("InsideLongPress", () => {
    let tile: HTMLElement;
    let body: HTMLElement;
    let onMenu: ReturnType<typeof vi.fn<(ev: MouseEvent) => void>>;

    beforeEach(() => {
        vi.useFakeTimers();
        tile = document.createElement("div");
        tile.className = "mx_EventTile";
        body = document.createElement("span");
        tile.append(body);
        document.body.append(tile);
        onMenu = vi.fn<(ev: MouseEvent) => void>();
        tile.addEventListener("contextmenu", onMenu);
        startInsideLongPress(true);
    });

    afterEach(() => {
        stopInsideLongPress();
        tile.remove();
        vi.useRealTimers();
    });

    it("opens the menu after a still long press, at the finger", () => {
        touch("touchstart", body);
        vi.advanceTimersByTime(LONG_PRESS_MS - 1);
        expect(onMenu).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onMenu).toHaveBeenCalledTimes(1);
        expect(onMenu.mock.calls[0][0]).toMatchObject({ clientX: 10, clientY: 20 });
    });

    it("swallows the click that ends the long press", () => {
        const onClick = vi.fn();
        tile.addEventListener("click", onClick);
        touch("touchstart", body);
        vi.advanceTimersByTime(LONG_PRESS_MS);
        touch("touchend", body);
        body.click();
        expect(onClick).not.toHaveBeenCalled();
        body.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("does nothing for a tap, a scroll, or outside messages and rooms", () => {
        touch("touchstart", body);
        touch("touchend", body);
        touch("touchstart", body);
        touch("touchmove", body, 10, 60);
        const outside = document.createElement("div");
        document.body.append(outside);
        outside.addEventListener("contextmenu", onMenu);
        touch("touchstart", outside);
        vi.advanceTimersByTime(LONG_PRESS_MS * 2);
        expect(onMenu).not.toHaveBeenCalled();
        outside.remove();
    });

    it("listens only on iOS, where the browser has no long-press menu", () => {
        stopInsideLongPress();
        expect(isIOS()).toBe(false);
        startInsideLongPress();
        touch("touchstart", body);
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(onMenu).not.toHaveBeenCalled();

        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        );
        expect(isIOS()).toBe(true);
    });
});
