/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useState } from "react";
import classNames from "classnames";

import { _t } from "../../../../languageHandler";
import type { ClientConversation, ClientTemplate } from "../../model";
import { channelName, fillTemplate, formatWindowLeft, getServiceWindow } from "../../clientTime";
import { InsisIcon } from "./icons";

const WINDOW_SOON_MS = 2 * 60 * 60 * 1000;

interface Props {
    conversation: ClientConversation;
    templates: readonly ClientTemplate[];
    now: number;
    onSend: (text: string, templateName?: string) => void;
    /** Something the preview cannot do yet (attachments, voice): shown as a notice. */
    onUnavailable: (what: "attach" | "voice") => void;
}

/**
 * Inside: the templates of the channel with a preview of the chosen one (ADR-069 К-8): outside the service
 * window only an approved template can be sent.
 */
export function TemplateSheet({
    conversation,
    templates,
    onSend,
    onClose,
}: {
    conversation: ClientConversation;
    templates: readonly ClientTemplate[];
    onSend: (text: string, templateName: string) => void;
    onClose: () => void;
}): JSX.Element {
    const [chosen, setChosen] = useState<ClientTemplate | undefined>();
    const channel = channelName(conversation.channel);
    return (
        <div className="mx_InsisTemplates" role="dialog" aria-label={_t("inside_clients|templates_title", { channel })}>
            <div className="mx_InsisTemplates_head">
                {chosen ? (
                    <button
                        type="button"
                        className="mx_InsisIconButton"
                        aria-label={_t("inside_clients|back")}
                        onClick={() => setChosen(undefined)}
                    >
                        <InsisIcon name="back" />
                    </button>
                ) : (
                    <span />
                )}
                <b>{chosen ? chosen.name : _t("inside_clients|templates_title", { channel })}</b>
                <button
                    type="button"
                    className="mx_InsisIconButton"
                    aria-label={_t("inside_clients|close")}
                    onClick={onClose}
                >
                    <InsisIcon name="x" />
                </button>
            </div>
            {chosen ? (
                <div className="mx_InsisTemplates_preview">
                    <div className="mx_InsisTemplates_previewWall">
                        <div className="mx_InsisMsg mx_InsisMsg_out mx_InsisMsg_last">
                            <div className="mx_InsisMsg_bubble">{fillTemplate(chosen.body, conversation)}</div>
                        </div>
                    </div>
                    <p className="mx_InsisTemplates_hint">{_t("inside_clients|template_hint")}</p>
                    <button
                        type="button"
                        className="mx_InsisButton mx_InsisButton_primary"
                        onClick={() => onSend(fillTemplate(chosen.body, conversation), chosen.name)}
                    >
                        <InsisIcon name="send" />
                        {_t("inside_clients|template_send")}
                    </button>
                </div>
            ) : (
                <ul className="mx_InsisTemplates_list">
                    {templates.map((t) => (
                        <li key={t.id}>
                            <button type="button" onClick={() => setChosen(t)}>
                                <span className="mx_InsisTemplates_name">
                                    {t.name}
                                    <span className="mx_InsisTemplates_lang">{t.language}</span>
                                </span>
                                <span className="mx_InsisTemplates_body">{fillTemplate(t.body, conversation)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/**
 * Inside: the composer of a client chat, by the rules of the channel: the 24 h window counter; outside the window
 * the field gives way to "Выбрать шаблон" and the templates sheet.
 */
export function ClientComposer({ conversation, templates, now, onSend, onUnavailable }: Props): JSX.Element {
    const [text, setText] = useState("");
    const [sheet, setSheet] = useState(false);
    const serviceWindow = getServiceWindow(conversation, now);
    const channel = channelName(conversation.channel);
    const hasText = text.trim().length > 0;

    const send = (): void => {
        if (!hasText) return;
        onSend(text);
        setText("");
    };

    const sendTemplate = (body: string, name: string): void => {
        onSend(body, name);
        setSheet(false);
    };

    return (
        <div className="mx_InsisComposer">
            {sheet && (
                <TemplateSheet
                    conversation={conversation}
                    templates={templates}
                    onSend={sendTemplate}
                    onClose={() => setSheet(false)}
                />
            )}
            {serviceWindow.kind === "open" && (
                <div
                    className={classNames("mx_InsisComposer_window", {
                        mx_InsisComposer_window_soon: serviceWindow.leftMs < WINDOW_SOON_MS,
                    })}
                    data-testid="insis-window"
                >
                    <InsisIcon name="clock" />
                    {_t("inside_clients|window_left", { channel, time: formatWindowLeft(serviceWindow.leftMs) })}
                </div>
            )}
            <div className="mx_InsisComposer_row">
                <button
                    type="button"
                    className="mx_InsisComposer_round mx_InsisGlass"
                    aria-label={_t("inside_clients|attach")}
                    onClick={() => onUnavailable("attach")}
                >
                    <InsisIcon name="clip" />
                </button>
                {serviceWindow.kind === "closed" ? (
                    <>
                        <div
                            className="mx_InsisComposer_field mx_InsisGlass mx_InsisComposer_closed"
                            data-testid="insis-window-closed"
                        >
                            <InsisIcon name="clock" />
                            <span>{_t("inside_clients|window_closed", { channel })}</span>
                        </div>
                        <button
                            type="button"
                            className="mx_InsisComposer_template"
                            aria-expanded={sheet}
                            onClick={() => setSheet(!sheet)}
                        >
                            <InsisIcon name="template" />
                            {_t("inside_clients|choose_template")}
                        </button>
                    </>
                ) : (
                    <>
                        <label className="mx_InsisComposer_field mx_InsisGlass">
                            <input
                                value={text}
                                placeholder={_t("inside_clients|composer_placeholder")}
                                aria-label={_t("inside_clients|composer_placeholder")}
                                autoComplete="off"
                                onChange={(e) => setText(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                                        e.preventDefault();
                                        send();
                                    }
                                }}
                            />
                            <span className="mx_InsisComposer_emoji" aria-hidden="true">
                                <InsisIcon name="smile" />
                            </span>
                        </label>
                        <button
                            type="button"
                            className={classNames("mx_InsisComposer_round", "mx_InsisComposer_send", {
                                mx_InsisComposer_send_go: hasText,
                            })}
                            aria-label={hasText ? _t("inside_clients|send") : _t("inside_clients|voice")}
                            onClick={hasText ? send : () => onUnavailable("voice")}
                        >
                            <InsisIcon name={hasText ? "send" : "mic"} />
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
