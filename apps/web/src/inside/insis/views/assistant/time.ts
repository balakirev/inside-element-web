/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useEffect, useState } from "react";

import { _t } from "../../../../languageHandler";
import { formatTime } from "../../../../DateUtils";
import { getUserLanguage } from "../../../../i18n/settings";

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(ts: number): number {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/** The time of a session row, as the mockup: "12:04" today and yesterday, "24.10" before. */
export function formatSessionTime(ts: number, now = Date.now()): string {
    if (ts >= startOfDay(now) - DAY) return formatTime(new Date(ts));
    return new Intl.DateTimeFormat(getUserLanguage(), { day: "2-digit", month: "2-digit" }).format(new Date(ts));
}

/** The day separator of a session feed: "Сегодня", "Вчера", "24 окт". */
export function formatSessionDay(ts: number, now = Date.now()): string {
    const day = startOfDay(ts);
    const today = startOfDay(now);
    if (day === today) return _t("insis_assistant|day_today");
    if (day === today - DAY) return _t("insis_assistant|day_yesterday");
    return new Intl.DateTimeFormat(getUserLanguage(), { day: "numeric", month: "short" })
        .format(new Date(ts))
        .replace(/\.$/, "");
}

/** "0:18" */
export function formatVoiceDuration(sec: number): string {
    const s = Math.max(0, Math.round(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function isSameDay(a: number, b: number): boolean {
    return startOfDay(a) === startOfDay(b);
}

/** The current time for "Today · Yesterday", updated every minute. */
export function useNow(): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(t);
    }, []);
    return now;
}
