/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { TypedEventEmitter } from "matrix-js-sdk/src/matrix";

import { FilterEnum } from "./skip-list/filters";

export enum InsideFolderStoreEvent {
    Changed = "inside_folder_changed",
}

type HandlerMap = {
    [InsideFolderStoreEvent.Changed]: (filter: FilterEnum | undefined) => void;
};

/**
 * Inside: the folders of the space panel, in their order there. Each one is a room list filter, as the
 * folders of other messengers are.
 */
export const INSIDE_FOLDERS: readonly FilterEnum[] = [
    FilterEnum.RoomsFilter,
    FilterEnum.ColleaguesFilter,
    FilterEnum.ClientsFilter,
    FilterEnum.VipFilter,
    FilterEnum.FavouriteFilter,
];

/**
 * Inside: which filter the room list shows, shared by the room list (its filter chips) and the folders of the
 * space panel, so each reflects what the other chose.
 */
export class InsideFolderStore extends TypedEventEmitter<InsideFolderStoreEvent, HandlerMap> {
    private static internalInstance?: InsideFolderStore;

    public static get instance(): InsideFolderStore {
        InsideFolderStore.internalInstance ??= new InsideFolderStore();
        return InsideFolderStore.internalInstance;
    }

    private filter?: FilterEnum;

    /** The active filter of the room list, if any. */
    public get activeFilter(): FilterEnum | undefined {
        return this.filter;
    }

    public setActiveFilter(filter: FilterEnum | undefined): void {
        if (this.filter === filter) return;
        this.filter = filter;
        this.emit(InsideFolderStoreEvent.Changed, filter);
    }
}
