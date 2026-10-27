/*
 * Copyright 2026 Inside Estate
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import classNames from "classnames";

import styles from "./RoomListItemView.module.css";

/**
 * Props for {@link MessageStatusIcon}.
 */
export interface MessageStatusIconProps {
    /** "sent" draws one tick, "read" draws two ticks in the accent colour */
    status: "sent" | "read";
}

/**
 * The delivery ticks shown next to the time of the user's own latest message in the room list.
 * Decorative: the state is announced through the row's accessible label.
 */
export function MessageStatusIcon({ status }: MessageStatusIconProps): JSX.Element {
    return (
        <svg
            className={classNames(styles.statusIcon, { [styles.statusRead]: status === "read" })}
            viewBox="0 0 16 11"
            width="16"
            height="11"
            aria-hidden={true}
            data-testid={`message-status-${status}`}
        >
            {status === "read" ? (
                <path d="M0.9 5.9l3 3L10.7 2.1M7.6 8.1l0.8 0.8L15.2 2.1" />
            ) : (
                <path d="M2.6 5.9l3 3L12.4 2.1" />
            )}
        </svg>
    );
}
