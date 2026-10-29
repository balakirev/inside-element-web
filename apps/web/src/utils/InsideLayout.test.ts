/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "test-utils-rtl";

import { getInsideLayout, useInsideLayout } from "./InsideLayout";

/** Pretend the window is `width` px wide for `max-width` media queries. */
function mockWindowWidth(width: number): Set<() => void> {
    const listeners = new Set<() => void>();
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
        const max = /max-width:\s*(\d+)px/.exec(query);
        return {
            matches: max ? width <= Number(max[1]) : false,
            media: query,
            addEventListener: (_: string, l: () => void) => listeners.add(l),
            removeEventListener: (_: string, l: () => void) => listeners.delete(l),
        } as unknown as MediaQueryList;
    });
    return listeners;
}

describe("InsideLayout", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([
        [320, "mobile"],
        [600, "mobile"],
        [601, "compact"],
        [925, "compact"],
        [926, "desktop"],
        [1440, "desktop"],
    ])("at %i px is %s", (width, layout) => {
        mockWindowWidth(width);
        expect(getInsideLayout()).toBe(layout);
    });

    it("follows the window across a breakpoint", () => {
        const listeners = mockWindowWidth(1440);
        const { result } = renderHook(() => useInsideLayout());
        expect(result.current).toBe("desktop");

        mockWindowWidth(375);
        act(() => listeners.forEach((l) => l()));
        expect(result.current).toBe("mobile");
    });
});
