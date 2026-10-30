/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type PropsWithChildren } from "react";

import { useInsisStore } from "../useInsis";
import { isInsisPreviewUser } from "../preview";
import { AssistantSessionView } from "./assistant/AssistantSessionView";
import { ClientChatView } from "./clients/ClientChatView";

/**
 * Inside: the main area shows an open client conversation or assistant session instead of the Matrix page (room,
 * home) when one is open; otherwise the page as usual.
 */
export function InsisPageSwitch({ children }: PropsWithChildren): JSX.Element {
    const store = useInsisStore();
    const target = store.openTarget;
    if (!target || !isInsisPreviewUser()) return <>{children}</>;
    if (target.kind === "client") return <ClientChatView key={target.id} conversationId={target.id} />;
    return <AssistantSessionView key={target.id} sessionId={target.id} />;
}
