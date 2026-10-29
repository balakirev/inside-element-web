/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { composeStories } from "@storybook/react-vite";
import { render } from "@test-utils";
import React, { type JSX } from "react";
import { describe, expect, it, vi } from "vitest";

import * as stories from "./RoomAvatarEventView.stories.tsx";
import { useMockedViewModel } from "../../../../../core/viewmodel";
import { RoomAvatarEventView } from "./RoomAvatarEventView";

const { Changed, Removed } = composeStories(stories);

describe("RoomAvatarEventView", () => {
    it("renders a changed room avatar event", () => {
        const { container } = render(<Changed />);
        expect(container).toMatchSnapshot();
    });

    it("renders a removed room avatar event", () => {
        const { container } = render(<Removed />);
        expect(container).toMatchSnapshot();
    });

    describe("Inside: renderSenderName", () => {
        function WithRenderedName({ isRemoved }: { isRemoved: boolean }): JSX.Element {
            const vm = useMockedViewModel(
                {
                    senderDisplayName: "Alice",
                    roomName: "General",
                    avatarUrl: isRemoved ? undefined : "mxc://example.org/avatar",
                    lightboxLabel: "Alice changed the avatar for General",
                    isRemoved,
                },
                { onAvatarClick: vi.fn() },
            );
            return (
                <RoomAvatarEventView
                    vm={vm}
                    renderAvatar={() => <span data-testid="avatar" />}
                    renderSenderName={(snapshot) => <b data-testid="name">{snapshot.senderDisplayName}</b>}
                />
            );
        }

        it.each([false, true])("puts the rendered name into the text (removed: %s)", (isRemoved) => {
            const { container, getByTestId } = render(<WithRenderedName isRemoved={isRemoved} />);
            expect(getByTestId("name")).toHaveTextContent("Alice");
            expect(container).toHaveTextContent(
                isRemoved ? "Alice removed the room avatar." : "Alice changed the room avatar to",
            );
            expect(container.textContent).not.toContain("senderName");
        });
    });
});
