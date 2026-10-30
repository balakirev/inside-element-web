/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";

/** Inside: an assistant session on the whole main area (placeholder). */
export function AssistantSessionView({ sessionId }: { sessionId: string }): JSX.Element {
    return <div className="mx_InsisAssistantSession">{sessionId}</div>;
}
