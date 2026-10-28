/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DUST_OVERLAY_CLASS, DUST_TOTAL_MS, playDustEffect } from "./DustEffect";

function mockMatchMedia(reduce: boolean): void {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: reduce && query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
}

function addTile(eventId: string): HTMLElement {
    const tile = document.createElement("li");
    tile.className = "mx_EventTile";
    tile.setAttribute("data-event-id", eventId);
    const line = document.createElement("div");
    line.className = "mx_EventTile_line";
    line.style.backgroundColor = "rgb(255, 255, 255)";
    line.textContent = "Hello";
    tile.appendChild(line);
    document.body.appendChild(tile);
    const rect = { left: 100, top: 200, right: 300, bottom: 240, width: 200, height: 40, x: 100, y: 200 };
    line.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
    tile.getBoundingClientRect = line.getBoundingClientRect;
    return line;
}

const overlays = (): NodeListOf<Element> => document.querySelectorAll(`.${DUST_OVERLAY_CLASS}`);

describe("playDustEffect", () => {
    const originalMatchMedia = window.matchMedia;

    beforeEach(() => {
        vi.useFakeTimers();
        mockMatchMedia(false);
    });

    afterEach(() => {
        vi.useRealTimers();
        window.matchMedia = originalMatchMedia;
        document.body.innerHTML = "";
    });

    it("puts an overlay over the bubble, hides the tile meanwhile and cleans up", () => {
        const line = addTile("$ev1");

        expect(playDustEffect("$ev1")).toBe(true);

        const [overlay] = Array.from(overlays()) as HTMLElement[];
        expect(overlays()).toHaveLength(1);
        expect(overlay.style.position).toBe("fixed");
        expect(overlay.getAttribute("aria-hidden")).toBe("true");
        expect(overlay.style.pointerEvents).toBe("none");
        // A copy of the bubble with the same text, without the event id.
        expect(overlay.textContent).toContain("Hello");
        expect(overlay.querySelector("[data-event-id]")).toBeNull();
        expect(overlay.querySelector("canvas")).not.toBeNull();
        expect(line.style.visibility).toBe("hidden");

        vi.advanceTimersByTime(DUST_TOTAL_MS + 500);

        expect(overlays()).toHaveLength(0);
        expect(line.style.visibility).toBe("");
    });

    it("does nothing when the user prefers reduced motion", () => {
        mockMatchMedia(true);
        const line = addTile("$ev2");

        expect(playDustEffect("$ev2")).toBe(false);
        expect(overlays()).toHaveLength(0);
        expect(line.style.visibility).toBe("");
    });

    it("does nothing when the tile is not on screen", () => {
        expect(playDustEffect("$missing")).toBe(false);
        expect(playDustEffect(undefined)).toBe(false);

        // A tile with no size (e.g. collapsed or in a hidden panel).
        const tile = document.createElement("li");
        tile.className = "mx_EventTile";
        tile.setAttribute("data-event-id", "$hidden");
        document.body.appendChild(tile);
        expect(playDustEffect("$hidden")).toBe(false);

        expect(overlays()).toHaveLength(0);
    });

    it("copes with event ids that need escaping in a selector", () => {
        addTile('$a"b]c');
        expect(playDustEffect('$a"b]c')).toBe(true);
        vi.advanceTimersByTime(DUST_TOTAL_MS + 500);
        expect(overlays()).toHaveLength(0);
    });
});
