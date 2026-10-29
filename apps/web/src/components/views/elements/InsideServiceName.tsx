/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode, useContext } from "react";
import { type RoomMember, User } from "matrix-js-sdk/src/matrix";

import AccessibleButton, { type ButtonEvent } from "./AccessibleButton";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewUserPayload } from "../../../dispatcher/payloads/ViewUserPayload";
import { CardContext } from "../right_panel/context";

interface Props {
    /** The Matrix ID of the person named. */
    userId: string;
    /** Their room member, if known; the user card falls back to the bare user ID otherwise. */
    member?: RoomMember | null;
    /** The name as the event text shows it. */
    children: ReactNode;
}

/**
 * Inside: a person's name in a service message ("Павел Сидоров приглашает Дмитрий Балакирев"), as in
 * Telegram: medium weight, underlined on hover, and a click (Enter, Space) opens their card in the
 * right panel the way a click on a sender avatar does. Only used where `textForEvent` renders JSX;
 * plain text paths (room list previews, notifications, exports) keep the bare name.
 */
export default function InsideServiceName({ userId, member, children }: Props): JSX.Element {
    const card = useContext(CardContext);

    const onClick = (e: ButtonEvent): void => {
        // The tile itself must not take the click (selection, highlight, collapsing a summary).
        e.preventDefault();
        e.stopPropagation();
        dis.dispatch<ViewUserPayload>({
            action: Action.ViewUser,
            member: member ?? new User(userId),
            push: card.isCard,
        });
    };

    return (
        <AccessibleButton element="span" className="mx_InsideServiceName" onClick={onClick} data-user-id={userId}>
            {children}
        </AccessibleButton>
    );
}
