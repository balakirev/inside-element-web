/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";

import BaseAvatar from "../../avatars/BaseAvatar";
import AccessibleButton from "../../elements/AccessibleButton";
import { useMatrixClientContext } from "../../../../contexts/MatrixClientContext";
import { useEventEmitterState } from "../../../../hooks/useEventEmitter";
import { OwnProfileStore } from "../../../../stores/OwnProfileStore";
import { UPDATE_EVENT } from "../../../../stores/AsyncStore";

interface Props {
    /** Avatar size, CSS length */
    size: string;
    className?: string;
    title?: string;
    onClick?: () => void;
}

/**
 * Inside: the user's own avatar, kept up to date with their profile.
 */
export function OwnAvatar({
    size,
    className,
    userId,
}: Pick<Props, "size" | "className"> & { userId: string }): JSX.Element {
    const { displayName, avatarUrl } = useEventEmitterState(OwnProfileStore.instance, UPDATE_EVENT, () => ({
        displayName: OwnProfileStore.instance.displayName,
        avatarUrl: OwnProfileStore.instance.getHttpAvatarUrl(parseInt(size, 10) * 2),
    }));
    return (
        <BaseAvatar className={className} idName={userId} name={displayName ?? userId} url={avatarUrl} size={size} />
    );
}

/**
 * Inside: the own avatar as a button, as the last tab of other messengers' tab bars.
 */
export function OwnAvatarButton({ size, className, title, onClick }: Props): JSX.Element {
    const client = useMatrixClientContext();
    return (
        <AccessibleButton className={className} title={title} onClick={onClick ?? null}>
            <OwnAvatar size={size} userId={client.getSafeUserId()} />
        </AccessibleButton>
    );
}
