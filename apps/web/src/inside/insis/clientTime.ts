/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { _t } from "../../languageHandler";
import { getUserLanguage } from "../../i18n/settings";
import type { ClientConversation } from "./model";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/**
 * Inside: the service window of a conversation (WABA 24 h) — whether the channel has one and whether it is open.
 * A closed window allows only approved templates (ADR-069 § 3, К-8).
 */
export type ServiceWindow = { kind: "none" } | { kind: "open"; leftMs: number } | { kind: "closed" };

export function getServiceWindow(
    conversation: Pick<ClientConversation, "serviceWindowUntil">,
    now = Date.now(),
): ServiceWindow {
    const until = conversation.serviceWindowUntil;
    if (until === undefined) return { kind: "none" };
    return until > now ? { kind: "open", leftMs: until - now } : { kind: "closed" };
}

/** "21 ч", "35 мин": what is left of the window, rounded down; at least a minute. */
export function formatWindowLeft(leftMs: number): string {
    if (leftMs >= HOUR) return _t("inside_clients|hours_short", { hours: Math.floor(leftMs / HOUR) });
    return _t("inside_clients|minutes_short", { minutes: Math.max(1, Math.floor(leftMs / MIN)) });
}

/** "18:40" — the client's local time now, in their time zone; undefined without a valid zone. */
export function formatClientLocalTime(
    timeZone: string | undefined,
    now = Date.now(),
    locale?: string,
): string | undefined {
    if (!timeZone) return undefined;
    try {
        return new Intl.DateTimeFormat(locale ?? getUserLanguage(), {
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
            timeZone,
        }).format(new Date(now));
    } catch {
        return undefined;
    }
}

/** The name of the channel for "окно WhatsApp". */
export function channelName(channel: ClientConversation["channel"]): string {
    switch (channel) {
        case "whatsapp":
            return "WhatsApp";
        case "telegram":
            return "Telegram";
        case "instagram":
            return "Instagram";
    }
}

/** First name for templates: "Алина Касымова" → "Алина". */
export function firstName(displayName: string): string {
    return displayName.trim().split(/\s+/)[0] ?? displayName;
}

/** A template body with the client's name filled in. */
export function fillTemplate(body: string, conversation: Pick<ClientConversation, "displayName">): string {
    return body.replace(/\{\{\s*name\s*\}\}/g, firstName(conversation.displayName));
}
