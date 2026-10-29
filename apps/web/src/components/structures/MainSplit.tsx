/*
Copyright 2024 New Vector Ltd.
Copyright 2019 The Matrix.org Foundation C.I.C.
Copyright 2018 New Vector Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode } from "react";
import { type NumberSize, Resizable } from "re-resizable";
import { type Direction } from "re-resizable/lib/resizer";
import { type WebPanelResize } from "@matrix-org/analytics-events/types/typescript/WebPanelResize";

import { PosthogAnalytics } from "../../PosthogAnalytics.ts";
import { SDKContext } from "../../contexts/SDKContext.ts";
import { getInsideLayout, prefersReducedMotion } from "../../utils/InsideLayout";

/**
 * Inside: how long the right panel slides out on a phone, as it slides in (`--transition-standard-in` of
 * Telegram Web K, `.3s cubic-bezier(.4, 0, .2, 1)`; the skin animates it).
 */
export const INSIDE_PANEL_LEAVE_MS = 300;
/** Inside: added to the right panel while it slides out, before it is taken off the screen. */
export const PANEL_LEAVING_CLASS = "mx_RightPanel_ResizeWrapper--inside-leaving";

interface IProps {
    collapsedRhs?: boolean;
    panel?: JSX.Element;
    children: ReactNode;
    /**
     * A unique identifier for this panel split.
     *
     * This is appended to the key used to store the panel size in localStorage, allowing the widths of different
     * panels to be stored.
     */
    sizeKey?: string;
    /**
     * The size to use for the panel component if one isn't persisted in storage. Defaults to 320.
     */
    defaultSize: number;

    analyticsRoomType: WebPanelResize["roomType"];
}

interface IState {
    /**
     * Inside: the panel last shown, kept on the screen while it slides out after it was closed (one-column
     * phone layout only, and not with reduced motion), so that it does not just vanish.
     */
    shownPanel?: JSX.Element;
    leaving: boolean;
}

export default class MainSplit extends React.Component<IProps, IState> {
    public static contextType = SDKContext;
    declare public context: React.ContextType<typeof SDKContext>;

    public static defaultProps = {
        defaultSize: 320,
    };

    private leaveTimer?: number;

    public constructor(props: IProps, context: React.ContextType<typeof SDKContext>) {
        super(props, context);
        this.state = { shownPanel: MainSplit.hasPanel(props) ? props.panel : undefined, leaving: false };
    }

    private static hasPanel(props: IProps): boolean {
        return !props.collapsedRhs && !!props.panel;
    }

    public static getDerivedStateFromProps(props: IProps, state: IState): Partial<IState> | null {
        if (MainSplit.hasPanel(props)) return { shownPanel: props.panel, leaving: false };
        if (!state.shownPanel || state.leaving) return null;
        if (getInsideLayout() === "mobile" && !prefersReducedMotion()) return { leaving: true };
        return { shownPanel: undefined };
    }

    public componentDidUpdate(): void {
        if (this.state.leaving && this.leaveTimer === undefined) {
            this.leaveTimer = window.setTimeout(() => {
                this.leaveTimer = undefined;
                if (this.state.leaving) this.setState({ shownPanel: undefined, leaving: false });
            }, INSIDE_PANEL_LEAVE_MS);
        } else if (!this.state.leaving && this.leaveTimer !== undefined) {
            window.clearTimeout(this.leaveTimer);
            this.leaveTimer = undefined;
        }
    }

    public componentWillUnmount(): void {
        if (this.leaveTimer !== undefined) window.clearTimeout(this.leaveTimer);
    }

    private onResizeStart = (): void => {
        this.context.resizeNotifier.startResizing();
    };

    private onResize = (): void => {
        this.context.resizeNotifier.notifyRightHandleResized();
    };

    private get sizeSettingStorageKey(): string {
        let key = "mx_rhs_size";
        if (!!this.props.sizeKey) {
            key += `_${this.props.sizeKey}`;
        }
        return key;
    }

    private onResizeStop = (
        event: MouseEvent | TouchEvent,
        direction: Direction,
        elementRef: HTMLElement,
        delta: NumberSize,
    ): void => {
        const newSize = this.loadSidePanelSize().width + delta.width;
        this.context.resizeNotifier.stopResizing();
        window.localStorage.setItem(this.sizeSettingStorageKey, newSize.toString());

        PosthogAnalytics.instance.trackEvent<WebPanelResize>({
            eventName: "WebPanelResize",
            panel: "right",
            roomType: this.props.analyticsRoomType,
            size: newSize,
        });
    };

    private loadSidePanelSize(): { height: string | number; width: number } {
        let rhsSize = parseInt(window.localStorage.getItem(this.sizeSettingStorageKey)!, 10);

        if (isNaN(rhsSize)) {
            rhsSize = this.props.defaultSize;
        }

        return {
            height: "100%",
            width: rhsSize,
        };
    }

    public render(): React.ReactNode {
        const bodyView = React.Children.only(this.props.children);
        const { leaving } = this.state;
        const panelView = leaving ? this.state.shownPanel : this.props.panel;

        const hasResizer = leaving || (!this.props.collapsedRhs && panelView);

        let children;
        if (hasResizer) {
            children = (
                <Resizable
                    key={this.props.sizeKey}
                    defaultSize={this.loadSidePanelSize()}
                    minWidth={320}
                    maxWidth="50%"
                    enable={{
                        top: false,
                        right: false,
                        bottom: false,
                        left: true,
                        topRight: false,
                        bottomRight: false,
                        bottomLeft: false,
                        topLeft: false,
                    }}
                    onResizeStart={this.onResizeStart}
                    onResize={this.onResize}
                    onResizeStop={this.onResizeStop}
                    className={
                        leaving ? `mx_RightPanel_ResizeWrapper ${PANEL_LEAVING_CLASS}` : "mx_RightPanel_ResizeWrapper"
                    }
                    handleClasses={{ left: "mx_ResizeHandle--horizontal" }}
                >
                    {panelView}
                </Resizable>
            );
        }

        return (
            <div className="mx_MainSplit">
                {bodyView}
                {children}
            </div>
        );
    }
}
