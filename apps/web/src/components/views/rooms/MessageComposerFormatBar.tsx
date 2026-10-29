/*
Copyright 2024 New Vector Ltd.
Copyright 2019-2021 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { createRef, type JSX } from "react";
import classNames from "classnames";
import {
    BoldIcon,
    ItalicIcon,
    UnderlineIcon,
    StrikethroughIcon,
    InlineCodeIcon,
    LinkIcon,
    CheckIcon,
    CloseIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t } from "../../../languageHandler";
import { RovingAccessibleButton } from "../../../accessibility/RovingTabIndex";
import Toolbar from "../../../accessibility/Toolbar";
import { type InlineFormat } from "../../../editor/insideFormat";

export enum Formatting {
    Bold = "bold",
    Italics = "italics",
    /** Inside: underline, as in Telegram. */
    Underline = "underline",
    Strikethrough = "strikethrough",
    Code = "code",
    Quote = "quote",
    InsertLink = "insert_link",
}

interface IProps {
    shortcuts: Partial<Record<Formatting, string>>;
    onAction(action: Formatting): void;
    /** Inside: the formats of the selected text, shown as pressed buttons. */
    activeFormat?: InlineFormat;
    /** Inside: the link field was confirmed (undefined: remove the link). */
    onLinkSubmit?(href: string | undefined): void;
    /** Inside: the link field was closed without a link; `refocus` is false when the focus went elsewhere. */
    onLinkCancel?(refocus: boolean): void;
}

interface IState {
    visible: boolean;
    /** Inside: the bar shows the field for a link address instead of its buttons. */
    linkMode: boolean;
    linkValue: string;
}

/**
 * The small bar over selected text in the composer. Inside: as in Telegram Desktop — bold, italic, underline,
 * strike, monospace and link, with the formats the selection has pressed; the link button turns the bar
 * into a field for the address (Enter applies, Escape cancels).
 */
export default class MessageComposerFormatBar extends React.PureComponent<IProps, IState> {
    private readonly formatBarRef = createRef<HTMLDivElement>();
    private readonly linkInputRef = createRef<HTMLInputElement>();
    /**
     * The height of the format bar in pixels.
     * @private
     */
    private readonly BAR_HEIGHT = 40;
    private lastRect?: DOMRect;

    public constructor(props: IProps) {
        super(props);
        this.state = { visible: false, linkMode: false, linkValue: "" };
    }

    public componentDidUpdate(prevProps: IProps, prevState: IState): void {
        if (this.state.linkMode && !prevState.linkMode) {
            this.linkInputRef.current?.focus();
            this.linkInputRef.current?.select();
        }
        if (this.state.visible && this.lastRect && (this.state.linkMode !== prevState.linkMode || !prevState.visible)) {
            this.position(this.lastRect);
        }
    }

    private onLinkKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>): void => {
        if (ev.key === "Enter") {
            ev.preventDefault();
            ev.stopPropagation();
            this.submitLink();
        } else if (ev.key === "Escape") {
            ev.preventDefault();
            ev.stopPropagation();
            this.setState({ linkMode: false, visible: false });
            this.props.onLinkCancel?.(true);
        }
    };

    private onLinkBlur = (ev: React.FocusEvent<HTMLInputElement>): void => {
        if (this.contains(ev.relatedTarget as Node | null)) return;
        // The focus went back to the composer (submit, cancel) or elsewhere: close without stealing it back.
        if (!this.state.linkMode) return;
        this.setState({ linkMode: false, visible: false });
        this.props.onLinkCancel?.(false);
    };

    private submitLink = (): void => {
        const value = this.state.linkValue.trim();
        this.setState({ linkMode: false, visible: false });
        if (value) {
            this.props.onLinkSubmit?.(value);
        } else {
            this.props.onLinkCancel?.(true);
        }
    };

    private removeLink = (): void => {
        this.setState({ linkMode: false, visible: false });
        this.props.onLinkSubmit?.(undefined);
    };

    /**
     * Inside: a press on the bar keeps the focus and the selection in the composer (Safari does not focus
     * buttons, so the composer's blur would hide the bar before the click). The link field takes the focus.
     */
    private onMouseDown = (ev: React.MouseEvent): void => {
        if (!(ev.target instanceof HTMLInputElement)) ev.preventDefault();
    };

    private onLinkChange = (ev: React.ChangeEvent<HTMLInputElement>): void => {
        this.setState({ linkValue: ev.target.value });
    };

    /** Inside: is the link field open (the editor has lost the focus to it). */
    public get isEditingLink(): boolean {
        return this.state.linkMode;
    }

    public contains(node: Node | null): boolean {
        return !!node && !!this.formatBarRef.current?.contains(node);
    }

    public render(): React.ReactNode {
        const active = this.props.activeFormat ?? {};
        const classes = classNames("mx_MessageComposerFormatBar", {
            mx_MessageComposerFormatBar_shown: this.state.visible,
            mx_MessageComposerFormatBar_linkMode: this.state.linkMode,
        });
        if (this.state.linkMode) {
            return (
                <div className={classes} ref={this.formatBarRef} onMouseDown={this.onMouseDown}>
                    <LinkIcon className="mx_MessageComposerFormatBar_linkIcon" />
                    <input
                        ref={this.linkInputRef}
                        className="mx_MessageComposerFormatBar_linkInput"
                        type="url"
                        inputMode="url"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={_t("composer|format_link_placeholder")}
                        aria-label={_t("composer|format_link")}
                        value={this.state.linkValue}
                        onChange={this.onLinkChange}
                        onKeyDown={this.onLinkKeyDown}
                        onBlur={this.onLinkBlur}
                    />
                    {active.link && (
                        <button
                            type="button"
                            className="mx_MessageComposerFormatBar_button"
                            onClick={this.removeLink}
                            aria-label={_t("composer|format_link_remove")}
                            title={_t("composer|format_link_remove")}
                        >
                            <CloseIcon />
                        </button>
                    )}
                    <button
                        type="button"
                        className="mx_MessageComposerFormatBar_button mx_MessageComposerFormatBar_apply"
                        onClick={this.submitLink}
                        aria-label={_t("action|apply")}
                        title={_t("action|apply")}
                    >
                        <CheckIcon />
                    </button>
                </div>
            );
        }
        return (
            <Toolbar
                className={classes}
                ref={this.formatBarRef}
                aria-label={_t("composer|formatting_toolbar_label")}
                onMouseDown={this.onMouseDown}
            >
                <FormatButton
                    label={_t("composer|format_bold")}
                    onClick={() => this.props.onAction(Formatting.Bold)}
                    icon={<BoldIcon />}
                    shortcut={this.props.shortcuts.bold}
                    active={!!active.bold}
                />
                <FormatButton
                    label={_t("composer|format_italics")}
                    onClick={() => this.props.onAction(Formatting.Italics)}
                    icon={<ItalicIcon />}
                    shortcut={this.props.shortcuts.italics}
                    active={!!active.italic}
                />
                <FormatButton
                    label={_t("composer|format_underline")}
                    onClick={() => this.props.onAction(Formatting.Underline)}
                    icon={<UnderlineIcon />}
                    shortcut={this.props.shortcuts.underline}
                    active={!!active.underline}
                />
                <FormatButton
                    label={_t("composer|format_strikethrough")}
                    onClick={() => this.props.onAction(Formatting.Strikethrough)}
                    icon={<StrikethroughIcon />}
                    shortcut={this.props.shortcuts.strikethrough}
                    active={!!active.strike}
                />
                <FormatButton
                    label={_t("composer|format_monospace")}
                    onClick={() => this.props.onAction(Formatting.Code)}
                    icon={<InlineCodeIcon />}
                    shortcut={this.props.shortcuts.code}
                    active={!!active.code}
                />
                <FormatButton
                    label={_t("composer|format_link")}
                    onClick={() => this.props.onAction(Formatting.InsertLink)}
                    icon={<LinkIcon />}
                    shortcut={this.props.shortcuts.insert_link}
                    active={!!active.link}
                />
            </Toolbar>
        );
    }

    /** Inside: opens the field for the link address over the selection, with the current link in it. */
    public showLinkField(selectionRect: DOMRect | undefined, current?: string): void {
        if (selectionRect) this.lastRect = selectionRect;
        this.setState({ visible: true, linkMode: true, linkValue: current ?? "" });
    }

    public showAt(selectionRect: DOMRect): void {
        if (!this.formatBarRef.current?.parentElement) return;
        this.lastRect = selectionRect;
        this.setState({ visible: true });
        this.position(selectionRect);
    }

    /**
     * Inside: centred over the selection, kept inside the composer's width (or the window), above the
     * selection's first line as in Telegram.
     */
    private position(selectionRect: DOMRect): void {
        const bar = this.formatBarRef.current;
        if (!bar?.parentElement) return;
        const parentRect = bar.parentElement.getBoundingClientRect();
        const width = bar.offsetWidth || 6 * 36 + 8;
        const centre = selectionRect.left + selectionRect.width / 2 - parentRect.left;
        const minLeft = Math.max(-parentRect.left + 8, -48);
        const maxLeft = Math.min(window.innerWidth - parentRect.left - width - 8, parentRect.width - width + 48);
        const left = Math.max(minLeft, Math.min(centre - width / 2, maxLeft));
        bar.style.left = `${left}px`;
        const top = selectionRect.top - parentRect.top - this.BAR_HEIGHT - 8;
        bar.style.top = `${top}px`;
    }

    public hide(): void {
        if (this.state.linkMode) return;
        this.setState({ visible: false });
    }

    /** Inside: hides the bar also while the link field is open. */
    public close(): void {
        this.setState({ visible: false, linkMode: false });
    }
}

interface IFormatButtonProps {
    label: string;
    icon: JSX.Element;
    shortcut?: string;
    active?: boolean;
    onClick(): void;
}

class FormatButton extends React.PureComponent<IFormatButtonProps> {
    public render(): React.ReactNode {
        // element="button" and type="button" are necessary for the buttons to work on WebKit,
        // otherwise the text is deselected before onClick can ever be called
        return (
            <RovingAccessibleButton
                element="button"
                type="button"
                onClick={this.props.onClick}
                aria-label={this.props.label}
                aria-pressed={this.props.active}
                title={this.props.label}
                caption={this.props.shortcut}
                className={classNames("mx_MessageComposerFormatBar_button", {
                    mx_MessageComposerFormatBar_buttonActive: this.props.active,
                })}
            >
                {this.props.icon}
            </RovingAccessibleButton>
        );
    }
}
