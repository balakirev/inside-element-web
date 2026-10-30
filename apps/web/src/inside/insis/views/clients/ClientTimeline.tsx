/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode } from "react";
import classNames from "classnames";

import { _t } from "../../../../languageHandler";
import { formatTime } from "../../../../DateUtils";
import { getUserLanguage } from "../../../../i18n/settings";
import SettingsStore from "../../../../settings/SettingsStore";
import type { ClientMessageAuthor, ClientTimelineItem, DeliveryState } from "../../model";
import { InsisIcon } from "./icons";

type MessageItem = Extract<ClientTimelineItem, { kind: "message" }>;

/** Which side a message is on: the client on the left, the company (anyone of it) on the right (ADR-069 К-6). */
export const isOutgoing = (author: ClientMessageAuthor): boolean => author.kind !== "client";

/**
 * The small label over an outgoing message that the viewer did not write in Lobby: the colleague's name,
 * "ИИ-агент", "Автосообщение"; "с телефона" when it was sent from the phone (`outgoing_origin = 'device'`).
 */
export function outgoingLabel(author: ClientMessageAuthor): string | undefined {
    const fromPhone = (author.kind === "me" || author.kind === "colleague") && author.fromPhone;
    let who: string | undefined;
    if (author.kind === "colleague") who = author.displayName;
    else if (author.kind === "ai_agent") who = _t("inside_clients|author_ai_agent");
    else if (author.kind === "automation") who = _t("inside_clients|author_automation");
    const parts = [who, fromPhone ? _t("inside_clients|from_phone") : undefined].filter(Boolean);
    return parts.length ? parts.join(" · ") : undefined;
}

function sameDay(a: number, b: number): boolean {
    const da = new Date(a);
    const db = new Date(b);
    return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

/** "Сегодня", "Вчера" or "пн, 27 окт" for a day separator. */
export function formatDay(ts: number, now = Date.now()): string {
    if (sameDay(ts, now)) return _t("inside_clients|today");
    if (sameDay(ts, now - 24 * 60 * 60 * 1000)) return _t("inside_clients|yesterday");
    const date = new Date(ts);
    const options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
    if (date.getFullYear() !== new Date(now).getFullYear()) options.year = "numeric";
    return new Intl.DateTimeFormat(getUserLanguage(), options).format(date);
}

function time(ts: number): string {
    return formatTime(new Date(ts), SettingsStore.getValue("showTwelveHourTimestamps"));
}

function DeliveryMark({ delivery }: { delivery?: DeliveryState }): JSX.Element | null {
    switch (delivery) {
        case "sending":
            return (
                <span className="mx_InsisMsg_delivery" title={_t("inside_clients|delivery_sending")}>
                    <InsisIcon name="clock" />
                </span>
            );
        case "sent":
            return (
                <span className="mx_InsisMsg_delivery" title={_t("inside_clients|delivery_sent")}>
                    <InsisIcon name="tick" />
                </span>
            );
        case "delivered":
            return (
                <span className="mx_InsisMsg_delivery" title={_t("inside_clients|delivery_delivered")}>
                    <InsisIcon name="ticks" />
                </span>
            );
        case "read":
            return (
                <span
                    className="mx_InsisMsg_delivery mx_InsisMsg_delivery_read"
                    title={_t("inside_clients|delivery_read")}
                >
                    <InsisIcon name="ticks" />
                </span>
            );
        case "failed":
            return (
                <span
                    className="mx_InsisMsg_delivery mx_InsisMsg_delivery_failed"
                    title={_t("inside_clients|delivery_failed")}
                >
                    <InsisIcon name="warn" />
                </span>
            );
        default:
            return null;
    }
}

function Message({
    item,
    label,
    last,
}: {
    item: MessageItem;
    /** The author label, on the first message of a run. */
    label?: string;
    /** The last message of a run: the bubble gets its tail. */
    last: boolean;
}): JSX.Element {
    const out = isOutgoing(item.author);
    const failed = item.delivery === "failed";
    const { attachment } = item;
    return (
        <div
            className={classNames("mx_InsisMsg", out ? "mx_InsisMsg_out" : "mx_InsisMsg_in", {
                mx_InsisMsg_last: last,
                mx_InsisMsg_failed: failed,
            })}
            data-testid="insis-message"
        >
            <div className="mx_InsisMsg_bubble">
                {label && <div className="mx_InsisMsg_author">{label}</div>}
                {item.templateName && (
                    <div className="mx_InsisMsg_template">
                        <InsisIcon name="template" />
                        {_t("inside_clients|template_label", { name: item.templateName })}
                    </div>
                )}
                {item.replyTo && (
                    <span className="mx_InsisMsg_quote">
                        <b>{item.replyTo.author}</b>
                        <span>{item.replyTo.text}</span>
                    </span>
                )}
                {attachment?.kind === "file" ? (
                    <div className="mx_InsisMsg_file">
                        <span className="mx_InsisMsg_fileIcon">
                            <InsisIcon name="doc" />
                        </span>
                        <div>
                            <b>{attachment.title}</b>
                            {attachment.subtitle && <span>{attachment.subtitle}</span>}
                        </div>
                    </div>
                ) : null}
                {item.text}
                {attachment?.kind === "listing" || attachment?.kind === "image" ? (
                    <span className="mx_InsisMsg_listing">
                        {attachment.site && <span className="mx_InsisMsg_listingSite">{attachment.site}</span>}
                        <b>{attachment.title}</b>
                        {attachment.subtitle && <span>{attachment.subtitle}</span>}
                    </span>
                ) : null}
                {item.reactions?.length ? (
                    <div className="mx_InsisMsg_reactions">
                        {item.reactions.map((r) => (
                            <span key={r.key}>
                                {r.key} {r.count}
                            </span>
                        ))}
                    </div>
                ) : null}
                <span className="mx_InsisMsg_meta">
                    {time(item.ts)}
                    {out && <DeliveryMark delivery={item.delivery} />}
                </span>
            </div>
            {failed && (
                <div className="mx_InsisMsg_failReason" role="alert">
                    {_t("inside_clients|not_delivered")}
                    {item.failReason ? `: ${item.failReason}` : ""}
                </div>
            )}
        </div>
    );
}

function Pill({
    icon,
    children,
    className,
}: {
    icon?: ReactNode;
    children: ReactNode;
    className?: string;
}): JSX.Element {
    return (
        <div className={classNames("mx_InsisPill", className)}>
            {icon}
            <span>{children}</span>
        </div>
    );
}

/**
 * Inside: the timeline of a client conversation — day separators, client messages on the left, the company's on
 * the right with the author over others' outgoing ones, the "Передано" separator and system lines.
 */
export function ClientTimeline({ items, now }: { items: readonly ClientTimelineItem[]; now: number }): JSX.Element {
    const out: JSX.Element[] = [];
    const current = now;
    items.forEach((item, i) => {
        const prev = items[i - 1];
        const next = items[i + 1];
        if (!prev || !sameDay(prev.ts, item.ts)) {
            out.push(
                <Pill key={`day-${item.id}`} className="mx_InsisPill_day">
                    {formatDay(item.ts, current)}
                </Pill>,
            );
        }
        if (item.kind === "system") {
            const icon = item.icon === "calendar" ? "cal" : item.icon === "lead" ? "case" : "info";
            out.push(
                <Pill key={item.id} icon={<InsisIcon name={icon} />}>
                    {item.text}
                </Pill>,
            );
            return;
        }
        if (item.kind === "assignment_changed") {
            const to = item.to === "me" ? _t("inside_clients|transferred_to_you") : item.to;
            out.push(
                <Pill key={item.id} className="mx_InsisPill_transfer">
                    {_t("inside_clients|transferred", { from: item.from, to })} · {formatDay(item.ts, current)}
                </Pill>,
            );
            return;
        }
        const label = isOutgoing(item.author) ? outgoingLabel(item.author) : undefined;
        const prevLabel = prev?.kind === "message" && isOutgoing(prev.author) ? outgoingLabel(prev.author) : undefined;
        const continues =
            prev?.kind === "message" &&
            sameDay(prev.ts, item.ts) &&
            isOutgoing(prev.author) === isOutgoing(item.author) &&
            prevLabel === label;
        const nextLabel = next?.kind === "message" && isOutgoing(next.author) ? outgoingLabel(next.author) : undefined;
        const last = !(
            next?.kind === "message" &&
            sameDay(next.ts, item.ts) &&
            isOutgoing(next.author) === isOutgoing(item.author) &&
            nextLabel === label
        );
        out.push(<Message key={item.id} item={item} label={continues ? undefined : label} last={last} />);
    });
    return <>{out}</>;
}
