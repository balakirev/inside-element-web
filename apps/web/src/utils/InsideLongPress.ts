/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Inside: a long press opens the context menu of a message or of a room in the room list, as in Telegram on a
 * phone. Chrome on Android sends `contextmenu` for a long press by itself; Safari on iOS does not, so after
 * {@link LONG_PRESS_MS} of a still finger we send it to the pressed element, where React's `onContextMenu`
 * handlers (the message menu, the room options) take it. The click that ends the press is swallowed.
 */

/** How long the finger has to stay, as the long press of iOS. */
export const LONG_PRESS_MS = 500;
/** How far the finger may move and still be a press, px. */
const MOVE_TOLERANCE = 10;
/** Where a long press opens a menu. */
const TARGETS = ".mx_EventTile, .mx_RoomListItemView";

let timer: number | undefined;
let start: { x: number; y: number; target: Element } | undefined;
let swallowClick = false;
let started = false;

function cancel(): void {
    window.clearTimeout(timer);
    timer = undefined;
    start = undefined;
}

function onTouchStart(ev: TouchEvent): void {
    cancel();
    if (ev.touches.length !== 1) return;
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target?.closest(TARGETS)) return;
    const touch = ev.touches[0];
    start = { x: touch.clientX, y: touch.clientY, target };
    timer = window.setTimeout(() => {
        if (!start) return;
        const { x, y, target } = start;
        cancel();
        swallowClick = true;
        target.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }),
        );
    }, LONG_PRESS_MS);
}

function onTouchMove(ev: TouchEvent): void {
    if (!start) return;
    const touch = ev.touches[0];
    if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > MOVE_TOLERANCE) cancel();
}

function onTouchEnd(): void {
    cancel();
}

/** The browser sent its own `contextmenu` (Android): ours is not needed. */
function onNativeContextMenu(ev: MouseEvent): void {
    if (ev.isTrusted) cancel();
}

/** A new press: a click left over from an earlier long press (none came) is not swallowed. */
function onPointerDown(): void {
    swallowClick = false;
}

function onClick(ev: MouseEvent): void {
    if (!swallowClick) return;
    swallowClick = false;
    ev.preventDefault();
    ev.stopPropagation();
}

/** Safari on an iPhone or iPad (which says it is a Mac), the browser without a long-press `contextmenu`. */
export function isIOS(): boolean {
    if (typeof navigator === "undefined") return false;
    return (
        /iP(hone|ad|od)/.test(navigator.userAgent) ||
        (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
    );
}

/**
 * Start listening for long presses on iOS; safe to call more than once.
 * @param always - also elsewhere (tests).
 */
export function startInsideLongPress(always = false): void {
    if (started || typeof window === "undefined" || !(always || isIOS())) return;
    started = true;
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", onTouchEnd);
    document.addEventListener("contextmenu", onNativeContextMenu, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerdown", onPointerDown, true);
}

/** Stop listening (tests). */
export function stopInsideLongPress(): void {
    if (!started) return;
    started = false;
    cancel();
    swallowClick = false;
    document.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("touchend", onTouchEnd);
    document.removeEventListener("touchcancel", onTouchEnd);
    document.removeEventListener("contextmenu", onNativeContextMenu, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
}
