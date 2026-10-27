/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type Ref, useCallback } from "react";
import { type MatrixEvent, EventType, RelationType, type Relations } from "matrix-js-sdk/src/matrix";
import { getEmojiFromUnicode } from "@matrix-org/emojibase-bindings";
import ChevronDownIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-down";
import classNames from "classnames";

import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { _t } from "../../../languageHandler";

/** The reactions offered first, in the order messengers usually show them. */
export const QUICK_REACTIONS = ["❤️", "👍", "😁", "🔥", "👌", "💯", "😢"];

interface Props {
    /** The event to react to */
    mxEvent: MatrixEvent;
    /** Existing reactions on the event, to show and toggle the user's own */
    reactions?: Relations | null;
    /** Whether the user may remove their own reactions */
    canSelfRedact: boolean;
    /** Called after a reaction was chosen, to close the menu */
    onFinished: () => void;
    /** Called to open the full emoji picker */
    onShowAll: () => void;
    /** Ref to the "show all" button, which the full picker is placed next to */
    showAllRef?: Ref<HTMLButtonElement>;
}

/** The user's own reactions on the event, by emoji, pointing at the reaction event ids. */
function getOwnReactions(reactions: Relations | null | undefined): Record<string, string> {
    if (!reactions) return {};
    const userId = MatrixClientPeg.safeGet().getSafeUserId();
    const own = reactions.getAnnotationsBySender()?.[userId] ?? new Set<MatrixEvent>();
    return Object.fromEntries(
        [...own].filter((event) => !event.isRedacted()).map((event) => [event.getRelation()?.key, event.getId()]),
    );
}

/**
 * A row of one-tap reactions shown above the message context menu, with a button that opens the
 * full emoji picker. Choosing an emoji the user has already reacted with removes that reaction.
 */
export function QuickReactionBar({
    mxEvent,
    reactions,
    canSelfRedact,
    onFinished,
    onShowAll,
    showAllRef,
}: Props): JSX.Element {
    const own = getOwnReactions(reactions);

    const onChoose = useCallback(
        (emoji: string): void => {
            const client = MatrixClientPeg.safeGet();
            const roomId = mxEvent.getRoomId()!;
            const ownReaction = getOwnReactions(reactions)[emoji];
            if (ownReaction) {
                if (canSelfRedact && !mxEvent.isRedacted()) void client.redactEvent(roomId, ownReaction);
            } else {
                void client.sendEvent(roomId, EventType.Reaction, {
                    "m.relates_to": { rel_type: RelationType.Annotation, event_id: mxEvent.getId()!, key: emoji },
                });
            }
            onFinished();
        },
        [mxEvent, reactions, canSelfRedact, onFinished],
    );

    return (
        <li role="none" className="mx_QuickReactionBar">
            <div role="group" aria-label={_t("timeline|context_menu|quick_reactions")}>
                {QUICK_REACTIONS.map((emoji) => {
                    const selected = Boolean(own[emoji]);
                    const label = getEmojiFromUnicode(emoji)?.label ?? emoji;
                    return (
                        <button
                            key={emoji}
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={selected}
                            aria-label={label}
                            title={label}
                            // Removing a reaction needs the right to redact one's own events.
                            disabled={selected && !canSelfRedact}
                            className={classNames("mx_QuickReactionBar_emoji", {
                                mx_QuickReactionBar_emoji_selected: selected,
                            })}
                            onClick={() => onChoose(emoji)}
                        >
                            {emoji}
                        </button>
                    );
                })}
                <button
                    type="button"
                    role="menuitem"
                    aria-label={_t("timeline|context_menu|all_reactions")}
                    title={_t("timeline|context_menu|all_reactions")}
                    className="mx_QuickReactionBar_more"
                    onClick={onShowAll}
                    ref={showAllRef}
                >
                    <ChevronDownIcon aria-hidden={true} />
                </button>
            </div>
        </li>
    );
}
