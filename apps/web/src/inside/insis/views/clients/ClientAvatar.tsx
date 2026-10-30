/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import classNames from "classnames";

import { InsisIcon } from "./icons";

interface Props {
    kind?: "client" | "assistant";
    initials?: string;
    /** Background, a CSS colour. */
    color?: string;
    online?: boolean;
    className?: string;
}

/**
 * Inside: the avatar of a client (two letters on the colour INSIS gives, a green dot when online) or of the
 * assistant (a spark). Sized by the place it is in; `mx_BaseAvatar` lets the skin size it as room avatars.
 */
export function ClientAvatar({ kind = "client", initials, color, online, className }: Props): JSX.Element {
    return (
        <span
            className={classNames("mx_BaseAvatar", "mx_InsisAvatar", `mx_InsisAvatar_${kind}`, className)}
            style={kind === "client" && color ? { background: color } : undefined}
            aria-hidden="true"
        >
            {kind === "assistant" ? <InsisIcon name="spark" /> : initials}
            {online && <span className="mx_InsisAvatar_online" />}
        </span>
    );
}
