/*
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { getLocale } from "../i18n/i18n";

const SIZE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte", "petabyte"] as const;
const BASE = 1024;

/**
 * format a size in bytes into a human readable form in the current language,
 * e.g: 1024 -> "1 kB" in English, 9049210 -> "8,6 МБ" in Russian
 *
 * Inside: uses the units of Intl.NumberFormat, so they follow the language ("861 Б", "1,2 ГБ"); Element wrote
 * English units ("861 Bytes", "8.63 MB") everywhere. Whole bytes; larger units with up to `decimals` decimal
 * places (default 1), trailing zeros dropped.
 */
export function formatBytes(bytes: number, decimals = 1): string {
    const fractionDigits = Math.max(0, Math.floor(decimals));
    let exponent = 0;
    let value = Math.max(0, bytes);
    while (exponent < SIZE_UNITS.length - 1 && value >= BASE) {
        value /= BASE;
        exponent++;
    }
    // 1023.96 KB rounds to "1024 KB": write it as "1 MB" instead.
    if (exponent > 0 && exponent < SIZE_UNITS.length - 1 && Number(value.toFixed(fractionDigits)) >= BASE) {
        value /= BASE;
        exponent++;
    }
    const locale = getLocale() || "en";
    // English has no short plural for bytes ("861 byte"), so it spells them out.
    const unitDisplay = exponent === 0 && locale.toLowerCase().startsWith("en") ? "long" : "short";
    return new Intl.NumberFormat(locale, {
        style: "unit",
        unit: SIZE_UNITS[exponent],
        unitDisplay,
        maximumFractionDigits: exponent === 0 ? 0 : fractionDigits,
    }).format(value);
}
