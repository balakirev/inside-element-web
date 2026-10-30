/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";

/**
 * Inside: the line icons of the Lobby mockup the "Помощник" screens use (24 × 24, stroke 1.8, round caps), so the
 * spark, the mic and the card icons look exactly as there. Decorative: always `aria-hidden`.
 */
const PATHS = {
    spark: (
        <>
            <path d="M11 4l1.7 5a2 2 0 0 0 1.3 1.3l5 1.7-5 1.7a2 2 0 0 0-1.3 1.3L11 20l-1.7-5A2 2 0 0 0 8 13.7L3 12l5-1.7a2 2 0 0 0 1.3-1.3z" />
            <path d="M19 2.5v4M17 4.5h4" />
        </>
    ),
    more: (
        <>
            <circle cx="5" cy="12" r="1.2" />
            <circle cx="12" cy="12" r="1.2" />
            <circle cx="19" cy="12" r="1.2" />
        </>
    ),
    edit: (
        <>
            <path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" />
        </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    pin: <path d="M12 17v5M9 10.8V4h6v6.8l3 3.2H6z" />,
    trash: <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />,
    search: (
        <>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
        </>
    ),
    mic: (
        <>
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" />
        </>
    ),
    clip: (
        <path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
    ),
    send: <path d="M12 19V5M5 12l7-7 7 7" />,
    stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
    tick: <path d="M4 12.5l4.5 4.5L19 7" />,
    ticks: <path d="M1.5 12.5L6 17 16.5 6.5M11 16l1 1L22.5 6.5" />,
    doc: (
        <>
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5M9 13h6M9 17h4" />
        </>
    ),
    build: <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h3a1 1 0 0 1 1 1v11M2 21h20M8 7h4M8 11h4M8 15h4" />,
    case: (
        <>
            <rect x="3" y="7" width="18" height="13" rx="2" />
            <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
        </>
    ),
    user: (
        <>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5" />
        </>
    ),
    back: <path d="M15 6l-6 6 6 6" />,
    help: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
        </>
    ),
    ext: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
    warn: (
        <path d="M10.3 4.2L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0zM12 9.5v4M12 17h.01" />
    ),
} as const;

export type AssistantIconName = keyof typeof PATHS | "play";

export function AssistantIcon({ name, className }: { name: AssistantIconName; className?: string }): JSX.Element {
    if (name === "play") {
        return (
            <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="none">
                <path d="M8 5.5v13l10.5-6.5z" />
            </svg>
        );
    }
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {PATHS[name]}
        </svg>
    );
}
