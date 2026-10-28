/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { render, screen, waitFor } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { composeStories } from "@storybook/react-vite";
import { describe, it, expect } from "vitest";

import * as stories from "./RoomListItemView.stories";

const {
    Default,
    Selected,
    Bold,
    WithNotification,
    WithMention,
    WithVoiceCall,
    WithVideoCall,
    Invitation,
    UnsentMessage,
    NoMessagePreview,
    WithHoverMenu,
    WithoutHoverMenu,
    WithTimestampAndSender,
    DirectMessageTwoLinePreview,
    OwnMessageRead,
    OwnMessageSent,
    Muted,
    Favourite,
} = composeStories(stories);

describe("<RoomListItemView />", () => {
    it("renders Default story", () => {
        const { container } = render(<Default />);
        expect(container).toMatchSnapshot();
    });

    it("renders Selected story", () => {
        const { container } = render(<Selected />);
        expect(container).toMatchSnapshot();
    });

    it("renders Bold story", () => {
        const { container } = render(<Bold />);
        expect(container).toMatchSnapshot();
    });

    it("renders WithNotification story", () => {
        const { container } = render(<WithNotification />);
        expect(container).toMatchSnapshot();
    });

    it("renders WithMention story", () => {
        const { container } = render(<WithMention />);
        expect(container).toMatchSnapshot();
    });

    it("renders WithVoiceCall story", () => {
        const { container } = render(<WithVoiceCall />);
        expect(container).toMatchSnapshot();
    });

    it("renders WithVideoCall story", () => {
        const { container } = render(<WithVideoCall />);
        expect(container).toMatchSnapshot();
    });

    it("renders Invitation story", () => {
        const { container } = render(<Invitation />);
        expect(container).toMatchSnapshot();
    });

    it("renders UnsentMessage story", () => {
        const { container } = render(<UnsentMessage />);
        expect(container).toMatchSnapshot();
    });

    it("renders NoMessagePreview story", () => {
        const { container } = render(<NoMessagePreview />);
        expect(container).toMatchSnapshot();
    });

    it("renders WithHoverMenu story", () => {
        const { container } = render(<WithHoverMenu />);
        expect(container).toMatchSnapshot();
    });

    it("renders WithTimestampAndSender story", () => {
        const { container } = render(<WithTimestampAndSender />);
        expect(container).toMatchSnapshot();
    });

    it("shows the time and the sender on its own line", () => {
        render(<WithTimestampAndSender />);
        expect(screen.getByText("20:20")).toHaveAttribute("title", "Tue, 27 Oct 2026, 20:20");
        expect(screen.getByText("Alice")).toBeInTheDocument();
        expect(screen.getByText("Hey everyone! The viewing moved to Friday, 16:00.")).toBeInTheDocument();
    });

    it("allows two preview lines when there is no sender line", () => {
        const { container } = render(<DirectMessageTwoLinePreview />);
        expect(container).toMatchSnapshot();
    });

    it.each([
        ["read", OwnMessageRead, "Open room General, your last message was read"],
        ["sent", OwnMessageSent, "Open room General, your last message was sent"],
    ])("shows the %s ticks and announces them", (status, Story, label) => {
        render(<Story />);
        expect(screen.getByTestId(`message-status-${status}`)).toBeInTheDocument();
        expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    });

    it("shows the muted icon for muted rooms", () => {
        const { container } = render(<Muted />);
        expect(container).toMatchSnapshot();
    });

    it("shows a pin for favourite rooms without unread messages", () => {
        render(<Favourite />);
        expect(screen.getByTestId("room-list-item-pin")).toHaveClass("mx_RoomListItemView_inside_pin");
    });

    it("shows the unread badge instead of the pin for favourite rooms with unread messages", () => {
        render(<WithNotification isFavourite={true} />);
        expect(screen.queryByTestId("room-list-item-pin")).toBeNull();
        expect(screen.getByTestId("notification-decoration")).toBeInTheDocument();
    });

    it("should call onOpenRoom when clicked", async () => {
        const user = userEvent.setup();
        render(<Default />);

        await user.click(screen.getByRole("option"));
        expect(Default.args.onOpenRoom).toHaveBeenCalled();
    });

    it("should have aria-selected true when selected", () => {
        render(<Selected />);
        expect(screen.getByRole("option")).toHaveAttribute("aria-selected", "true");
    });

    it("should have aria-selected false when not selected", () => {
        render(<Default />);
        expect(screen.getByRole("option")).toHaveAttribute("aria-selected", "false");
    });

    it("should have tabIndex -1 when not focused", () => {
        render(<Default />);
        expect(screen.getByRole("option")).toHaveAttribute("tabIndex", "-1");
    });

    it("should call onFocus when focused", () => {
        render(<Default />);
        screen.getByRole("option").focus();
        expect(Default.args.onFocus).toHaveBeenCalled();
    });

    it("should display notification decoration when present", () => {
        render(<WithNotification />);
        expect(screen.getByTestId("notification-decoration")).toBeInTheDocument();
    });

    it("should hide notification decoration when not present", () => {
        render(<Default />);
        expect(screen.queryByTestId("notification-decoration")).toBeNull();
    });

    it("should show hover menu when showMoreOptionsMenu is true", () => {
        const { container } = render(<WithHoverMenu />);
        expect(container.querySelector('[aria-label="More Options"]')).not.toBeNull();
    });

    it("should hide hover menu when showMoreOptionsMenu is false", () => {
        const { container } = render(<WithoutHoverMenu />);
        expect(container.querySelector('[aria-label="More Options"]')).toBeNull();
    });

    it("reveals the hover menu on keyboard focus and clears it when focus leaves", async () => {
        // isFocused focuses the row via the keyboard on mount, so the hover menu is revealed.
        const { container } = render(<WithHoverMenu isFocused={true} />);
        const option = screen.getByRole("option");
        const moreButton = container.querySelector('[aria-label="More Options"]');

        expect(option.className).toMatch(/keyboardActive/);
        expect(moreButton).toBeVisible();

        // Focus leaving the row hides the menu again.
        option.blur();
        await waitFor(() => expect(option.className).not.toMatch(/keyboardActive/));
        expect(moreButton).not.toBeVisible();
    });
});
