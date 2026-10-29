/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useSyncExternalStore } from "react";

/**
 * Inside: the window widths at which the layout changes, as in Telegram Web K (`$small-screen` and
 * `$floating-left-sidebar` of tweb). The Inside skin uses the same numbers in its media queries.
 *
 * - mobile, up to 600 px: one column, the room list or the room;
 * - compact, 601–925 px: the room list and the room, no space panel (its folders are tabs over the list);
 * - desktop, wider: the space panel, the room list and the room, as before.
 */
export const INSIDE_MOBILE_MAX_WIDTH = 600;
export const INSIDE_COMPACT_MAX_WIDTH = 925;

export type InsideLayout = "mobile" | "compact" | "desktop";

const MOBILE_QUERY = `(max-width: ${INSIDE_MOBILE_MAX_WIDTH}px)`;
const COMPACT_QUERY = `(max-width: ${INSIDE_COMPACT_MAX_WIDTH}px)`;

function matches(query: string): boolean {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/** The layout for the current window width. */
export function getInsideLayout(): InsideLayout {
    if (matches(MOBILE_QUERY)) return "mobile";
    if (matches(COMPACT_QUERY)) return "compact";
    return "desktop";
}

function subscribe(onChange: () => void): () => void {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
    const lists = [window.matchMedia(MOBILE_QUERY), window.matchMedia(COMPACT_QUERY)];
    for (const list of lists) list.addEventListener?.("change", onChange);
    return () => {
        for (const list of lists) list.removeEventListener?.("change", onChange);
    };
}

/** The layout for the current window width, updated when the window crosses a breakpoint. */
export function useInsideLayout(): InsideLayout {
    return useSyncExternalStore(subscribe, getInsideLayout, () => "desktop");
}

/** Whether the user asked the system for less motion. */
export function prefersReducedMotion(): boolean {
    return matches("(prefers-reduced-motion: reduce)");
}
