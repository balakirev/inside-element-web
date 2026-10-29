/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import defaultDispatcher from "../dispatcher/dispatcher";
import { Action } from "../dispatcher/actions";
import { type ActionPayload } from "../dispatcher/payloads";
import RightPanelStore from "../stores/right-panel/RightPanelStore";
import { getInsideLayout, prefersReducedMotion } from "./InsideLayout";

/**
 * Inside: going back from a room to the room list in the one-column (mobile) layout, as in Telegram Web K.
 *
 * Element puts every screen into the URL hash with `location.assign`, so the browser's own Back already
 * returns from a room to the list it was opened from. The back button of the room header does the same
 * (`history.back()`) when the room was opened from the list, so that Back afterwards does not reopen the
 * room; otherwise (a room opened by a link or after a reload) it opens the list.
 */

/** How long the room slides out, as `--tabs-transition` of Telegram Web K (`.2s ease-in-out`). */
export const INSIDE_COLUMN_TRANSITION_MS = 200;

/** Added to the room column while it slides out, before the list is shown. */
export const LEAVING_CLASS = "mx_RoomView_wrapper--inside-leaving";

const isListHash = (hash: string): boolean => hash === "" || hash === "#" || hash === "#/" || hash === "#/home";
const isRoomHash = (hash: string): boolean => hash.startsWith("#/room/");

let lastHash: string | undefined;
let roomOpenedFromList = false;
let dispatcherRef: string | undefined;

/**
 * A room opened from the room list on a phone shows its timeline, as in Telegram, not the thread or info panel
 * it had open last time: that panel would cover the whole room.
 */
function onAction(payload: ActionPayload): void {
    if (payload.action !== Action.ViewRoom || payload.metricsTrigger !== "RoomList" || !payload.room_id) return;
    if (getInsideLayout() !== "mobile") return;
    if (RightPanelStore.instance.isOpenForRoom(payload.room_id)) RightPanelStore.instance.hide(payload.room_id);
}

function onHashChange(): void {
    const previous = lastHash ?? "";
    lastHash = window.location.hash;
    roomOpenedFromList = isListHash(previous) && isRoomHash(lastHash);
}

/** Start following the URL hash; safe to call more than once. */
export function startInsideMobileNavigation(): void {
    if (lastHash !== undefined || typeof window === "undefined") return;
    lastHash = window.location.hash;
    window.addEventListener("hashchange", onHashChange);
    dispatcherRef = defaultDispatcher.register(onAction);
}

/** Stop following the URL hash (tests). */
export function stopInsideMobileNavigation(): void {
    if (typeof window !== "undefined") window.removeEventListener("hashchange", onHashChange);
    if (dispatcherRef) defaultDispatcher.unregister(dispatcherRef);
    dispatcherRef = undefined;
    lastHash = undefined;
    roomOpenedFromList = false;
}

/** Whether the open room was opened from the room list, so that Back returns to it. */
export function wasRoomOpenedFromList(): boolean {
    return roomOpenedFromList;
}

function showList(): void {
    if (roomOpenedFromList) {
        roomOpenedFromList = false;
        window.history.back();
    } else {
        defaultDispatcher.dispatch({ action: Action.ViewHomePage });
    }
}

/**
 * Go back from the room to the room list: the room slides out to the right, then the list is shown.
 * @param from - an element inside the room column (the back button), to find the column to animate.
 */
export function goBackToRoomList(from?: Element | null): void {
    const column = from?.closest(".mx_RoomView_wrapper");
    if (!column || prefersReducedMotion()) {
        showList();
        return;
    }
    column.classList.add(LEAVING_CLASS);
    window.setTimeout(() => {
        showList();
        // Keep the column out of sight until the list has replaced the room.
        const done = (): void => {
            window.removeEventListener("hashchange", done);
            window.setTimeout(() => column.classList.remove(LEAVING_CLASS), 150);
        };
        window.addEventListener("hashchange", done);
        window.setTimeout(done, 1000);
    }, INSIDE_COLUMN_TRANSITION_MS);
}
