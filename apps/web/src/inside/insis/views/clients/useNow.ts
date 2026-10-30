/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useEffect, useState } from "react";

/**
 * Inside: the current time, updated every `ms` — for the window counter, the client's clock and how long a lead
 * waits. `fixed` pins it (tests).
 */
export function useNow(ms: number, fixed?: number): number {
    const [now, setNow] = useState(() => fixed ?? Date.now());
    useEffect(() => {
        if (fixed !== undefined) return;
        const timer = setInterval(() => setNow(Date.now()), ms);
        return () => clearInterval(timer);
    }, [ms, fixed]);
    return fixed ?? now;
}
