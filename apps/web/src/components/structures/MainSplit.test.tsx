/*
Copyright 2024 New Vector Ltd.
Copyright 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import React from "react";
import { render, fireEvent, act } from "test-utils-rtl";

import MainSplit, { INSIDE_PANEL_LEAVE_MS, PANEL_LEAVING_CLASS } from "./MainSplit";
import { PosthogAnalytics } from "../../PosthogAnalytics.ts";
import { SDKContext } from "../../contexts/SDKContext.ts";
import { SDKContextClass } from "../../contexts/SDKContextClass";

describe("<MainSplit/>", () => {
    const children = (
        <div>
            Child<span>Foo</span>Bar
        </div>
    );
    const panel = <div>Right panel</div>;
    let sdkContext: SDKContextClass;

    beforeEach(() => {
        localStorage.clear();
        sdkContext = new SDKContextClass();
    });

    it("renders", () => {
        const { asFragment, container } = render(
            <MainSplit children={children} panel={panel} analyticsRoomType="other_room" />,
        );
        expect(asFragment()).toMatchSnapshot();
        // Assert it matches the default width of 320
        expect(container.querySelector<HTMLElement>(".mx_RightPanel_ResizeWrapper")!.style.width).toBe("320px");
    });

    it("respects defaultSize prop", () => {
        const { asFragment, container } = render(
            <MainSplit children={children} panel={panel} defaultSize={500} analyticsRoomType="other_room" />,
        );
        expect(asFragment()).toMatchSnapshot();
        // Assert it matches the default width of 350
        expect(container.querySelector<HTMLElement>(".mx_RightPanel_ResizeWrapper")!.style.width).toBe("500px");
    });

    it("prefers size stashed in LocalStorage to the defaultSize prop", () => {
        localStorage.setItem("mx_rhs_size_thread", "333");
        const { container } = render(
            <MainSplit
                children={children}
                panel={panel}
                sizeKey="thread"
                defaultSize={400}
                analyticsRoomType="other_room"
            />,
        );
        expect(container.querySelector<HTMLElement>(".mx_RightPanel_ResizeWrapper")!.style.width).toBe("333px");
    });

    it("should report to analytics on resize stop", () => {
        const { container } = render(
            <MainSplit
                children={children}
                panel={panel}
                sizeKey="thread"
                defaultSize={400}
                analyticsRoomType="other_room"
            />,
            { wrapper: ({ children }) => <SDKContext.Provider value={sdkContext}>{children}</SDKContext.Provider> },
        );

        const spy = vi.spyOn(PosthogAnalytics.instance, "trackEvent");

        const handle = container.querySelector(".mx_ResizeHandle--horizontal")!;
        expect(handle).toBeInTheDocument();
        fireEvent.mouseDown(handle);
        fireEvent.resize(handle, { clientX: 0 });
        fireEvent.mouseUp(handle);

        expect(spy).toHaveBeenCalledWith({
            eventName: "WebPanelResize",
            panel: "right",
            roomType: "other_room",
            size: 400,
        });
    });

    describe("Inside: the right panel slides out when closed", () => {
        /** Pretend the window is `width` px wide, optionally asking for reduced motion. */
        function mockWindow(width: number, reducedMotion = false): void {
            vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
                const max = /max-width:\s*(\d+)px/.exec(query);
                const matches = max ? width <= Number(max[1]) : /reduce/.test(query) && reducedMotion;
                return {
                    matches,
                    media: query,
                    addEventListener: () => {},
                    removeEventListener: () => {},
                } as unknown as MediaQueryList;
            });
        }

        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        const renderSplit = (withPanel: boolean): ReturnType<typeof render> =>
            render(
                <MainSplit children={children} panel={withPanel ? panel : undefined} analyticsRoomType="other_room" />,
            );

        it("keeps the panel on a phone while it slides out, then removes it", () => {
            mockWindow(390);
            const { container, rerender } = renderSplit(true);
            rerender(<MainSplit children={children} panel={undefined} analyticsRoomType="other_room" />);

            const wrapper = container.querySelector(".mx_RightPanel_ResizeWrapper");
            expect(wrapper).toHaveClass(PANEL_LEAVING_CLASS);
            expect(wrapper).toHaveTextContent("Right panel");

            act(() => vi.advanceTimersByTime(INSIDE_PANEL_LEAVE_MS));
            expect(container.querySelector(".mx_RightPanel_ResizeWrapper")).toBeNull();
        });

        it("shows the panel again if it is reopened while sliding out", () => {
            mockWindow(390);
            const { container, rerender } = renderSplit(true);
            rerender(<MainSplit children={children} panel={undefined} analyticsRoomType="other_room" />);
            rerender(<MainSplit children={children} panel={panel} analyticsRoomType="other_room" />);

            act(() => vi.advanceTimersByTime(INSIDE_PANEL_LEAVE_MS));
            const wrapper = container.querySelector(".mx_RightPanel_ResizeWrapper");
            expect(wrapper).not.toHaveClass(PANEL_LEAVING_CLASS);
            expect(wrapper).toHaveTextContent("Right panel");
        });

        it.each([
            ["a wide window", 1440, false],
            ["reduced motion", 390, true],
        ])("removes the panel at once with %s", (_, width, reducedMotion) => {
            mockWindow(width, reducedMotion);
            const { container, rerender } = renderSplit(true);
            rerender(<MainSplit children={children} panel={undefined} analyticsRoomType="other_room" />);
            expect(container.querySelector(".mx_RightPanel_ResizeWrapper")).toBeNull();
        });
    });
});
