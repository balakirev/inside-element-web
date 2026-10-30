/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";

/** Inside: a client conversation in the main area (placeholder). */
export function ClientChatView({ conversationId }: { conversationId: string }): JSX.Element {
    return <div className="mx_InsisClientChat">{conversationId}</div>;
}
