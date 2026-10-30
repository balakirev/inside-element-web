/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useState } from "react";
import classNames from "classnames";

import { _t } from "../../../../languageHandler";
import { getUserLanguage } from "../../../../i18n/settings";
import type { ClientConversation, LeadCard } from "../../model";
import { channelName, formatClientLocalTime, formatWindowLeft, getServiceWindow } from "../../clientTime";
import { ClientAvatar } from "./ClientAvatar";
import { InsisIcon } from "./icons";

export type LeadCardTab = "lead" | "objects" | "path" | "files";

export interface LeadCardActions {
    onClose: () => void;
    onCall: () => void;
    /** A suggestion of the assistant was picked: open the assistant with its prompt. */
    onSuggestion: (prompt: string) => void;
    onAskAssistant: () => void;
    onOpenInInsis: () => void;
    onAccept: () => void;
    onReturnToQueue: () => void;
}

interface Props extends LeadCardActions {
    conversation: ClientConversation;
    card?: LeadCard;
    now: number;
    /** "side" — the right panel; "sheet" — the bottom sheet on a phone. */
    variant?: "side" | "sheet";
    initialTab?: LeadCardTab;
}

function shortDate(ts: number, now: number): string {
    const d = new Date(ts);
    const today = new Date(now).toDateString() === d.toDateString();
    const date = today
        ? _t("inside_clients|today_lower")
        : new Intl.DateTimeFormat(getUserLanguage(), { day: "2-digit", month: "2-digit" }).format(d);
    const time = new Intl.DateTimeFormat(getUserLanguage(), {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).format(d);
    return `${date} · ${time}`;
}

/** "у клиента сейчас 18:40 · окно WhatsApp ещё 21 ч", from the time zone and the service window. */
export function ClientClockLine({
    conversation,
    now,
}: {
    conversation: ClientConversation;
    now: number;
}): JSX.Element | null {
    const local = formatClientLocalTime(conversation.clientTimeZone, now);
    const serviceWindow = getServiceWindow(conversation, now);
    const channel = channelName(conversation.channel);
    if (!local && serviceWindow.kind === "none") return null;
    return (
        <div className="mx_InsisLead_line" data-testid="insis-client-clock">
            <InsisIcon name="clock" />
            <span className="mx_InsisLead_lineText">
                {local && (
                    <span>
                        {_t("inside_clients|client_time_now")} <b>{local}</b>
                        {serviceWindow.kind !== "none" ? " ·" : ""}
                    </span>
                )}{" "}
                {serviceWindow.kind === "open" && (
                    <span>
                        {_t("inside_clients|card_window_left", { channel })}{" "}
                        <b>{formatWindowLeft(serviceWindow.leftMs)}</b>
                    </span>
                )}
                {serviceWindow.kind === "closed" && <span>{_t("inside_clients|card_window_closed", { channel })}</span>}
            </span>
        </div>
    );
}

function StageBar({ card }: { card: LeadCard }): JSX.Element {
    return (
        <div className="mx_InsisLead_stage">
            <div
                className="mx_InsisLead_stageBar"
                role="img"
                aria-label={_t("inside_clients|stage_of", {
                    stage: card.stage,
                    n: card.stageIndex,
                    total: card.stageCount,
                })}
            >
                {Array.from({ length: card.stageCount }, (_, i) => i + 1).map((n) => (
                    <i
                        key={n}
                        className={classNames({
                            mx_InsisLead_stageDone: n < card.stageIndex,
                            mx_InsisLead_stageCurrent: n === card.stageIndex,
                        })}
                    />
                ))}
            </div>
            <div className="mx_InsisLead_stageLine">
                <b>{card.stage}</b>
                <span>{_t("inside_clients|stage_n_of", { n: card.stageIndex, total: card.stageCount })}</span>
            </div>
        </div>
    );
}

function Suggestions({
    card,
    onSuggestion,
}: {
    card: LeadCard;
    onSuggestion: (prompt: string) => void;
}): JSX.Element | null {
    const suggestions = card.suggestions.slice(0, 3);
    if (!suggestions.length) return null;
    return (
        <section className="mx_InsisLead_suggestions" aria-label={_t("inside_clients|assistant_suggests")}>
            <div className="mx_InsisLead_suggestionsHead">
                <InsisIcon name="spark" />
                <b>{_t("inside_clients|assistant_suggests")}</b>
                <span>{suggestions.length}</span>
            </div>
            {suggestions.map((s) => (
                <button
                    key={s.id}
                    type="button"
                    className="mx_InsisLead_suggestion"
                    onClick={() => onSuggestion(s.prompt)}
                    data-testid="insis-suggestion"
                >
                    <p>{s.title}</p>
                    <span className="mx_InsisLead_why">
                        <InsisIcon name="help" />
                        {s.reason}
                    </span>
                    <InsisIcon name="chev" className="mx_InsisLead_suggestionGo" />
                </button>
            ))}
        </section>
    );
}

function LeadPane({
    conversation,
    card,
    now,
    onSuggestion,
}: {
    conversation: ClientConversation;
    card: LeadCard;
    now: number;
    onSuggestion: (prompt: string) => void;
}): JSX.Element {
    return (
        <>
            <Suggestions card={card} onSuggestion={onSuggestion} />
            <div className="mx_InsisLead_group">
                <div className="mx_InsisLead_groupHead">
                    <span className="mx_InsisLead_label">{_t("inside_clients|lead_in_insis")}</span>
                    <span className="mx_InsisLead_id">{card.leadId}</span>
                </div>
                <StageBar card={card} />
                <dl className="mx_InsisLead_kv">
                    <dt>{_t("inside_clients|budget")}</dt>
                    <dd>{card.budget}</dd>
                    <dt>{_t("inside_clients|source")}</dt>
                    <dd>
                        {card.source}
                        {card.campaign && <small>{card.campaign}</small>}
                    </dd>
                    <dt>{_t("inside_clients|broker")}</dt>
                    <dd>{card.broker}</dd>
                </dl>
                {card.wants.length > 0 && (
                    <div className="mx_InsisLead_chips">
                        <small>{_t("inside_clients|client_wants")}</small>
                        {card.wants.map((w) => (
                            <span key={w} className="mx_InsisLead_chip">
                                {w}
                            </span>
                        ))}
                    </div>
                )}
                {card.nextStep && (
                    <div className="mx_InsisLead_next">
                        <span className="mx_InsisLead_nextIcon">
                            <InsisIcon name="cal" />
                        </span>
                        <div>
                            <b>{card.nextStep.title}</b>
                            <span>
                                {_t("inside_clients|next_step")} · {card.nextStep.when}
                            </span>
                        </div>
                    </div>
                )}
                <ClientClockLine conversation={conversation} now={now} />
            </div>
        </>
    );
}

function ObjectsPane({ card }: { card: LeadCard }): JSX.Element {
    if (!card.listings.length) return <p className="mx_InsisLead_empty">{_t("inside_clients|no_objects")}</p>;
    return (
        <div className="mx_InsisLead_objects">
            {card.listings.map((l) => (
                <div key={l.id} className="mx_InsisLead_object">
                    <i style={l.thumb ? { background: l.thumb } : undefined} />
                    <span className="mx_InsisLead_objectText">
                        <b>{l.title}</b>
                        <span className="mx_InsisLead_objectPrice">
                            {l.price}
                            {l.subtitle ? ` · ${l.subtitle}` : ""}
                        </span>
                        {(l.tags?.length || l.status) && (
                            <span className="mx_InsisLead_objectTags">
                                {(l.tags ?? [{ label: l.status! }]).map((t) => (
                                    <span
                                        key={t.label}
                                        className={classNames({
                                            mx_InsisLead_tagKey: t.tone === "key",
                                            mx_InsisLead_tagSignal: t.tone === "signal",
                                        })}
                                    >
                                        {t.label}
                                    </span>
                                ))}
                            </span>
                        )}
                    </span>
                </div>
            ))}
        </div>
    );
}

function PathPane({ card, now }: { card: LeadCard; now: number }): JSX.Element {
    if (!card.journey.length) return <p className="mx_InsisLead_empty">{_t("inside_clients|no_path")}</p>;
    return (
        <ol className="mx_InsisLead_path">
            {card.journey.map((step) => (
                <li key={step.id} className={classNames({ mx_InsisLead_pathCurrent: !step.done })}>
                    <i />
                    <div>
                        <b>{step.title}</b>
                        <span>
                            {shortDate(step.ts, now)}
                            {step.detail ? ` · ${step.detail}` : ""}
                        </span>
                    </div>
                </li>
            ))}
        </ol>
    );
}

function FilesPane({ card, now }: { card: LeadCard; now: number }): JSX.Element {
    if (!card.files.length) return <p className="mx_InsisLead_empty">{_t("inside_clients|no_files")}</p>;
    return (
        <div className="mx_InsisLead_files">
            {card.files.map((f) => {
                const pages = f.pageSeconds;
                const max = pages?.length ? Math.max(...pages) : 0;
                return (
                    <div key={f.id} className={classNames("mx_InsisLead_file", { mx_InsisLead_fileSmall: !pages })}>
                        <div className="mx_InsisLead_fileHead">
                            <span className="mx_InsisLead_fileIcon">
                                <InsisIcon name="doc" />
                            </span>
                            <div>
                                <b>{f.name}</b>
                                <span>
                                    {f.size} · {shortDate(f.ts, now)}
                                </span>
                            </div>
                        </div>
                        {pages && max > 0 && (
                            <div
                                className="mx_InsisLead_pages"
                                role="img"
                                aria-label={_t("inside_clients|time_on_pages")}
                            >
                                {pages
                                    .map((sec, i) => ({ sec, page: i + 1 }))
                                    .map(({ sec, page }) => (
                                        <i
                                            key={page}
                                            className={classNames({ mx_InsisLead_pageTop: sec === max })}
                                            style={{ height: `${Math.round((sec / max) * 100)}%` }}
                                        >
                                            <em>{page}</em>
                                        </i>
                                    ))}
                            </div>
                        )}
                        {f.viewSummary && <div className="mx_InsisLead_fileNote">{f.viewSummary}</div>}
                    </div>
                );
            })}
        </div>
    );
}

/**
 * Inside: the lead card of a client chat (ADR-069 Amendment 2026-10-30 п. 2, variant B with "Помощник предлагает"
 * of variant C): contact, tabs Лид · Объекты · Путь · Файлы, read only; actions — "Принять", "Вернуть в очередь"
 * where the lead is in the queue, "Позвонить", "Открыть в Insis", "Спросить помощника". No CRM edit buttons.
 */
export function LeadCardPanel({
    conversation,
    card,
    now,
    variant = "side",
    initialTab = "lead",
    ...actions
}: Props): JSX.Element {
    const [tab, setTab] = useState<LeadCardTab>(initialTab);
    const [menu, setMenu] = useState(false);
    const tabs: { id: LeadCardTab; label: string }[] = [
        { id: "lead", label: _t("inside_clients|tab_lead") },
        {
            id: "objects",
            label: card?.listings.length
                ? _t("inside_clients|tab_objects_n", { n: card.listings.length })
                : _t("inside_clients|tab_objects"),
        },
        { id: "path", label: _t("inside_clients|tab_path") },
        { id: "files", label: _t("inside_clients|tab_files") },
    ];
    const sheet = variant === "sheet";

    return (
        <aside
            className={classNames("mx_InsisLead", sheet ? "mx_InsisLead_sheet" : "mx_InsisLead_side")}
            aria-label={_t("inside_clients|card_title")}
        >
            {sheet ? (
                <div className="mx_InsisLead_grab" aria-hidden="true" />
            ) : (
                <div className="mx_InsisLead_head">
                    <b>{_t("inside_clients|card_title")}</b>
                    <button
                        type="button"
                        className="mx_InsisIconButton"
                        aria-label={_t("inside_clients|close")}
                        onClick={actions.onClose}
                    >
                        <InsisIcon name="x" />
                    </button>
                </div>
            )}
            <div className="mx_InsisLead_contact">
                <ClientAvatar
                    initials={conversation.initials}
                    color={conversation.avatarColor}
                    online={conversation.online}
                />
                <div className="mx_InsisLead_who">
                    <b>{conversation.displayName}</b>
                    <span>{sheet && card ? `${card.leadId} · ${card.broker}` : conversation.phone}</span>
                </div>
                <button
                    type="button"
                    className="mx_InsisIconButton mx_InsisIconButton_filled"
                    aria-label={_t("inside_clients|call")}
                    onClick={actions.onCall}
                >
                    <InsisIcon name="phone" />
                </button>
                {!sheet && (
                    <button
                        type="button"
                        className="mx_InsisIconButton mx_InsisIconButton_filled"
                        aria-label={_t("inside_clients|more")}
                        aria-expanded={menu}
                        onClick={() => setMenu(!menu)}
                    >
                        <InsisIcon name="more" />
                    </button>
                )}
                {menu && (
                    <div className="mx_InsisMenu mx_InsisLead_menu" role="menu">
                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                setMenu(false);
                                void navigator.clipboard?.writeText(conversation.phone);
                            }}
                        >
                            <InsisIcon name="phone" />
                            {_t("inside_clients|copy_phone")}
                        </button>
                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                setMenu(false);
                                actions.onOpenInInsis();
                            }}
                        >
                            <InsisIcon name="ext" />
                            {_t("inside_clients|open_in_insis")}
                        </button>
                    </div>
                )}
            </div>
            {conversation.queue && (
                <div className="mx_InsisLead_queue">
                    {conversation.queue === "pending" && (
                        <button
                            type="button"
                            className="mx_InsisButton mx_InsisButton_primary"
                            onClick={actions.onAccept}
                        >
                            {_t("inside_clients|accept")}
                        </button>
                    )}
                    <button
                        type="button"
                        className="mx_InsisButton mx_InsisButton_secondary"
                        onClick={actions.onReturnToQueue}
                    >
                        {_t("inside_clients|return_to_queue")}
                    </button>
                </div>
            )}
            <div className="mx_InsisLead_tabs" role="tablist">
                {tabs.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.id}
                        className={classNames({ mx_InsisLead_tabOn: tab === t.id })}
                        onClick={() => setTab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            <div className="mx_InsisLead_pane" role="tabpanel">
                {!card ? (
                    <p className="mx_InsisLead_empty">{_t("inside_clients|no_card")}</p>
                ) : tab === "lead" ? (
                    <LeadPane conversation={conversation} card={card} now={now} onSuggestion={actions.onSuggestion} />
                ) : tab === "objects" ? (
                    <ObjectsPane card={card} />
                ) : tab === "path" ? (
                    <PathPane card={card} now={now} />
                ) : (
                    <FilesPane card={card} now={now} />
                )}
            </div>
            <div className="mx_InsisLead_actions">
                <button type="button" className="mx_InsisButton mx_InsisButton_primary" onClick={actions.onOpenInInsis}>
                    <InsisIcon name="ext" />
                    {_t("inside_clients|open_in_insis")}
                </button>
                <button
                    type="button"
                    className="mx_InsisButton mx_InsisButton_secondary"
                    onClick={actions.onAskAssistant}
                >
                    <InsisIcon name="spark" />
                    {sheet ? _t("inside_clients|assistant") : _t("inside_clients|ask_assistant")}
                </button>
            </div>
        </aside>
    );
}
