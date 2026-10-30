/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";

import { _t } from "../../../../languageHandler";
import { useEventEmitterState } from "../../../../hooks/useEventEmitter";
import { InsideFolderStore, InsideFolderStoreEvent } from "../../../../stores/room-list-v3/InsideFolderStore";
import { FilterEnum } from "../../../../stores/room-list-v3/skip-list/filters";
import { useInsisStore } from "../../useInsis";
import { isInsisPreviewUser } from "../../preview";
import { formatWindowLeft } from "../../clientTime";
import { useNow } from "./useNow";

/**
 * Inside: "Ждут приёма · N" over the room list in the "Clients" folder (ADR-069 К-4): only the number of leads
 * assigned to the user and not accepted yet and how long the oldest waits — a conversation is not visible before it
 * is accepted. "Принять следующий" accepts the next one and opens its chat.
 */
export function InsisWaitingBar({ now }: { now?: number }): JSX.Element | null {
    const store = useInsisStore();
    const folder = useEventEmitterState(
        InsideFolderStore.instance,
        InsideFolderStoreEvent.Changed,
        () => InsideFolderStore.instance.activeFilter,
    );
    const current = useNow(60 * 1000, now);
    const queue = store.waitingQueue;
    if (!isInsisPreviewUser() || store.isAssistantFolderActive) return null;
    if (folder !== FilterEnum.ClientsFilter || queue.count <= 0) return null;

    const waited = queue.oldestSince !== undefined ? current - queue.oldestSince : undefined;
    return (
        <div className="mx_InsisWaitingBar" role="status">
            <div className="mx_InsisWaitingBar_text">
                <b>{_t("inside_clients|waiting_title", { n: queue.count })}</b>
                {waited !== undefined && waited > 0 && (
                    <span>{_t("inside_clients|waiting_oldest", { time: formatWindowLeft(waited) })}</span>
                )}
            </div>
            <button type="button" className="mx_InsisWaitingBar_accept" onClick={() => store.acceptNext()}>
                {_t("inside_clients|accept_next")}
            </button>
        </div>
    );
}
