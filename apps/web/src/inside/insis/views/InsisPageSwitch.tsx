/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type PropsWithChildren } from "react";

import { useInsisStore } from "../useInsis";
import { isInsisPreviewUser } from "../preview";
import { useInsideLayout } from "../../../utils/InsideLayout";
import { AssistantEmptyView, AssistantSessionView } from "./assistant/AssistantSessionView";
import { ClientChatView } from "./clients/ClientChatView";

/**
 * Inside: the main area shows an open client conversation or assistant session instead of the Matrix page (room,
 * home) when one is open; otherwise the page as usual. With the "Помощник" folder active and no session open, wide
 * windows show the assistant's empty state rather than the last room (on a phone the list is shown instead).
 */
export function InsisPageSwitch({ children }: PropsWithChildren): JSX.Element {
    const store = useInsisStore();
    const layout = useInsideLayout();
    const target = store.openTarget;
    if (!isInsisPreviewUser()) return <>{children}</>;
    if (!target) {
        if (store.isAssistantFolderActive && layout !== "mobile") return <AssistantEmptyView />;
        return <>{children}</>;
    }
    if (target.kind === "client") return <ClientChatView key={target.id} conversationId={target.id} />;
    return <AssistantSessionView key={target.id} sessionId={target.id} />;
}
