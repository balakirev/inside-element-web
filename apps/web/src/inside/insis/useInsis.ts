/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useSyncExternalStore } from "react";

import { InsisPreviewStore, InsisStoreEvent } from "./InsisPreviewStore";

const subscribe = (cb: () => void): (() => void) => {
    const store = InsisPreviewStore.instance;
    store.on(InsisStoreEvent.Changed, cb);
    return () => {
        store.off(InsisStoreEvent.Changed, cb);
    };
};

/**
 * Inside: re-render on every change of the INSIS store and return it. Read what you need from the store in render;
 * the revision makes React notice changes of the store's immutable arrays.
 */
export function useInsisStore(): InsisPreviewStore {
    useSyncExternalStore(subscribe, () => InsisPreviewStore.instance.version);
    return InsisPreviewStore.instance;
}
