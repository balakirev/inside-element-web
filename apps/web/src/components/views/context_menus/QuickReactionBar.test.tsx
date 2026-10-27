/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { fireEvent, render, screen } from "test-utils-rtl";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventType, type MatrixClient, type MatrixEvent, type Relations, RelationType } from "matrix-js-sdk/src/matrix";
import { mkEvent, stubClient } from "test-utils";

import { QUICK_REACTIONS, QuickReactionBar } from "./QuickReactionBar";

describe("<QuickReactionBar />", () => {
    let client: MatrixClient;
    let message: MatrixEvent;

    /** Relations where the user has already reacted with the given emoji. */
    function ownReactions(emoji: string): Relations {
        const reaction = mkEvent({
            event: true,
            type: EventType.Reaction,
            user: client.getSafeUserId(),
            room: "!room:server",
            content: { "m.relates_to": { rel_type: RelationType.Annotation, event_id: "$message", key: emoji } },
        });
        return {
            getAnnotationsBySender: () => ({ [client.getSafeUserId()]: new Set([reaction]) }),
        } as unknown as Relations;
    }

    beforeEach(() => {
        client = stubClient();
        message = mkEvent({
            event: true,
            type: EventType.RoomMessage,
            user: "@alice:server",
            room: "!room:server",
            content: { msgtype: "m.text", body: "hello" },
        });
        Object.defineProperty(message, "getId", { value: () => "$message" });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("offers the quick emoji and a button for all reactions", () => {
        render(<QuickReactionBar mxEvent={message} canSelfRedact={true} onFinished={vi.fn()} onShowAll={vi.fn()} />);

        expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(QUICK_REACTIONS.length);
        expect(screen.getByRole("menuitem", { name: "All reactions" })).toBeInTheDocument();
    });

    it("sends the chosen reaction and closes the menu", () => {
        const onFinished = vi.fn();
        render(<QuickReactionBar mxEvent={message} canSelfRedact={true} onFinished={onFinished} onShowAll={vi.fn()} />);

        fireEvent.click(screen.getByText("🔥"));

        expect(client.sendEvent).toHaveBeenCalledWith("!room:server", EventType.Reaction, {
            "m.relates_to": { rel_type: RelationType.Annotation, event_id: "$message", key: "🔥" },
        });
        expect(onFinished).toHaveBeenCalled();
    });

    it("removes the user's own reaction when it is chosen again", () => {
        const reactions = ownReactions("❤️");
        render(
            <QuickReactionBar
                mxEvent={message}
                reactions={reactions}
                canSelfRedact={true}
                onFinished={vi.fn()}
                onShowAll={vi.fn()}
            />,
        );

        const heart = screen.getByText("❤️");
        expect(heart).toHaveAttribute("aria-checked", "true");
        fireEvent.click(heart);

        expect(client.redactEvent).toHaveBeenCalled();
        expect(client.sendEvent).not.toHaveBeenCalled();
    });

    it("cannot remove a reaction without the right to redact", () => {
        render(
            <QuickReactionBar
                mxEvent={message}
                reactions={ownReactions("❤️")}
                canSelfRedact={false}
                onFinished={vi.fn()}
                onShowAll={vi.fn()}
            />,
        );

        expect(screen.getByText("❤️")).toBeDisabled();
    });

    it("opens the full picker", () => {
        const onShowAll = vi.fn();
        render(<QuickReactionBar mxEvent={message} canSelfRedact={true} onFinished={vi.fn()} onShowAll={onShowAll} />);

        fireEvent.click(screen.getByRole("menuitem", { name: "All reactions" }));

        expect(onShowAll).toHaveBeenCalled();
    });
});
