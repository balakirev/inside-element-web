/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Inside: inline formatting in the composer, as in Telegram Desktop.
 *
 * A plain part may carry a format (bold, italic, underline, strike, monospace, link), shown as such in the
 * composer and sent as HTML. This module has the format type, the conversion of pasted HTML and of markdown
 * in pasted plain text to formatted parts, and the serialisation of formatted runs to markdown or HTML.
 */

import escapeHtml from "escape-html";

export type InlineMark = "bold" | "italic" | "underline" | "strike" | "code";

export interface InlineFormat {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    /** Monospace (inline code). */
    code?: boolean;
    /** The target of a link. */
    link?: string;
}

export const INLINE_MARKS: readonly InlineMark[] = ["bold", "italic", "underline", "strike", "code"];

/** The format without its unset keys, undefined when nothing is set. */
export function normalizeFormat(format?: InlineFormat | null): InlineFormat | undefined {
    if (!format) return undefined;
    const out: InlineFormat = {};
    for (const mark of INLINE_MARKS) {
        if (format[mark]) out[mark] = true;
    }
    if (format.link) out.link = format.link;
    return Object.keys(out).length ? out : undefined;
}

export function formatsEqual(a?: InlineFormat, b?: InlineFormat): boolean {
    const na = normalizeFormat(a);
    const nb = normalizeFormat(b);
    if (!na || !nb) return !na && !nb;
    return INLINE_MARKS.every((m) => !!na[m] === !!nb[m]) && (na.link ?? "") === (nb.link ?? "");
}

export function withMark(format: InlineFormat | undefined, mark: InlineMark, on: boolean): InlineFormat | undefined {
    return normalizeFormat({ ...format, [mark]: on });
}

export function withLink(format: InlineFormat | undefined, link: string | undefined): InlineFormat | undefined {
    return normalizeFormat({ ...format, link });
}

export const FORMAT_CLASS = "mx_BasicMessageComposer_format";

/** The class of the span that shows a formatted part in the composer. */
export function formatClassName(format: InlineFormat): string {
    const classes = [FORMAT_CLASS];
    for (const mark of INLINE_MARKS) {
        if (format[mark]) classes.push(`${FORMAT_CLASS}_${mark}`);
    }
    if (format.link) classes.push(`${FORMAT_CLASS}_link`);
    return classes.join(" ");
}

/**
 * A link target we accept from pasted HTML, markdown or the link field: http(s), mailto and matrix.to style links,
 * and bare domains, which get https:// in front.
 */
export function normalizeLinkTarget(input: string): string | undefined {
    const href = input.trim();
    if (!href || /\s/.test(href)) return undefined;
    if (/^(https?:\/\/|mailto:)/i.test(href)) return href;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return undefined; // javascript:, data: and the like
    if (/^[^/?#@]+\.[a-z]{2,}([/?#:].*)?$/i.test(href)) return `https://${href}`;
    return undefined;
}

// --- Serialisation ---------------------------------------------------------------------------------------------

/** One piece of a line to serialise: the text as it goes out unformatted, the raw text and its format. */
export interface FormatSegment {
    /** The serialised text of the part as Element sends it without a format (markdown, a pill link…). */
    out: string;
    /** The text the user sees, for monospace runs. */
    raw: string;
    format?: InlineFormat;
}

type MarkKey = "link" | InlineMark;
// Monospace is innermost, so a code span may sit inside bold or a link.
const MARK_ORDER: readonly MarkKey[] = ["link", "bold", "italic", "underline", "strike", "code"];

interface Syntax {
    open(key: MarkKey, value: string): string;
    close(key: MarkKey, value: string): string;
    code(raw: string): string;
}

function markValue(format: InlineFormat | undefined, key: MarkKey): string {
    if (!format) return "";
    if (key === "link") return format.link ?? "";
    return format[key] ? "1" : "";
}

/**
 * Wraps runs of segments in their formats, the format covering most first (so `a<del>b <strong>c</strong></del>`
 * stays nested like that rather than being cut into pieces), monospace always innermost.
 */
function wrapSegments(segments: FormatSegment[], keys: readonly MarkKey[], syntax: Syntax): string {
    const present = keys.filter((k) => k !== "code" && segments.some((s) => markValue(s.format, k)));
    let key: MarkKey | undefined;
    let best: [number, number] | undefined;
    for (const k of present) {
        let runs = 0;
        let covered = 0;
        let prev = "";
        for (const seg of segments) {
            const v = markValue(seg.format, k);
            if (v && v !== prev) runs++;
            if (v) covered += seg.raw.length;
            prev = v;
        }
        if (!best || runs < best[0] || (runs === best[0] && covered > best[1])) {
            best = [runs, covered];
            key = k;
        }
    }
    if (!key) {
        // Only monospace (or nothing) is left.
        if (!keys.includes("code")) return segments.map((s) => s.out).join("");
        key = "code";
    }
    const rest = keys.filter((k) => k !== key);
    let out = "";
    let i = 0;
    while (i < segments.length) {
        const value = markValue(segments[i].format, key);
        let j = i + 1;
        while (j < segments.length && markValue(segments[j].format, key) === value) j++;
        const run = segments.slice(i, j);
        if (!value) {
            out += wrapSegments(run, rest, syntax);
        } else if (key === "code") {
            out += syntax.code(run.map((s) => s.raw).join(""));
        } else {
            out += syntax.open(key, value) + wrapSegments(run, rest, syntax) + syntax.close(key, value);
        }
        i = j;
    }
    return out;
}

/** Escapes text of a formatted part for the markdown parser, which the rest of the message still goes through. */
export function escapeMarkdownInline(text: string): string {
    return text.replace(/[\\`*_[\]<>~&|]/g, (c) => "\\" + c);
}

function longestRun(text: string, chr: string): number {
    let longest = 0;
    let current = 0;
    for (const c of text) {
        current = c === chr ? current + 1 : 0;
        longest = Math.max(longest, current);
    }
    return longest;
}

function markdownCodeSpan(raw: string): string {
    const fence = "`".repeat(longestRun(raw, "`") + 1);
    // A code span loses one space at each end when it has both, and cannot start or end with its fence.
    const pad = raw.startsWith("`") || raw.endsWith("`") || (/^ .* $/.test(raw) && raw.trim() !== "") ? " " : "";
    return `${fence}${pad}${raw}${pad}${fence}`;
}

function markdownLinkTarget(href: string): string {
    return "<" + href.replace(/[<>\s]/g, (c) => encodeURIComponent(c)) + ">";
}

const HTML_TAGS: Record<InlineMark, string> = {
    bold: "strong",
    italic: "em",
    underline: "u",
    strike: "del",
    code: "code",
};

/**
 * Markdown for a run of segments (one line). Bold and italic go as the `<strong>` and `<em>` tags the markdown
 * renderer lets through (see Markdown.ts), which unlike `**` have no rules about the characters around them.
 */
export function segmentsToMarkdown(segments: FormatSegment[]): string {
    return wrapSegments(segments, MARK_ORDER, {
        open: (key) => (key === "link" ? "[" : `<${HTML_TAGS[key]}>`),
        close: (key, value) => (key === "link" ? `](${markdownLinkTarget(value)})` : `</${HTML_TAGS[key]}>`),
        code: markdownCodeSpan,
    });
}

/** HTML for a run of segments whose `out` is already HTML. */
export function segmentsToHtml(segments: FormatSegment[]): string {
    return wrapSegments(segments, MARK_ORDER, {
        open: (key, value) => (key === "link" ? `<a href="${escapeHtml(value)}">` : `<${HTML_TAGS[key]}>`),
        close: (key) => (key === "link" ? "</a>" : `</${HTML_TAGS[key]}>`),
        code: (raw) => `<code>${escapeHtml(raw)}</code>`,
    });
}

// --- Markdown in pasted or typed plain text --------------------------------------------------------------------

/** A piece of formatted text, before it becomes composer parts. */
export interface FormatRun {
    text: string;
    format?: InlineFormat;
}

const OPEN_BEFORE = /[\s([{"'«„“—–-]/;
const CLOSE_AFTER = /[\s)\]}"'»“”.,:;!?…—–-]/;

function canOpen(text: string, at: number, markerLen: number): boolean {
    const before = at > 0 ? text[at - 1] : "";
    const after = text[at + markerLen] ?? "";
    return (!before || OPEN_BEFORE.test(before)) && !!after && !/\s/.test(after);
}

function canClose(text: string, at: number, markerLen: number): boolean {
    const before = at > 0 ? text[at - 1] : "";
    const after = text[at + markerLen] ?? "";
    return !!before && !/\s/.test(before) && (!after || CLOSE_AFTER.test(after));
}

const MARKERS: { marker: string; mark: InlineMark }[] = [
    { marker: "***", mark: "bold" }, // bold and italic, handled below
    { marker: "**", mark: "bold" },
    { marker: "__", mark: "italic" },
    { marker: "~~", mark: "strike" },
    { marker: "*", mark: "italic" },
    { marker: "_", mark: "italic" },
];

function pushRun(runs: FormatRun[], text: string, format?: InlineFormat): void {
    if (!text) return;
    const last = runs[runs.length - 1];
    const norm = normalizeFormat(format);
    if (last && formatsEqual(last.format, norm)) {
        last.text += text;
    } else {
        runs.push({ text, format: norm });
    }
}

/**
 * Inline markdown of one line to formatted runs: `**bold**`, `__italic__` / `*italic*` / `_italic_`,
 * `~~strike~~`, `` `code` `` and `[text](url)`, nested, as Telegram Desktop reads them. A marker only counts
 * where markdown would read it (not inside words for `*` and `_`, not before a space), so `2*3*4` and
 * `snake_case_name` stay as they are.
 */
export function parseInlineMarkdown(line: string, format?: InlineFormat): FormatRun[] {
    const runs: FormatRun[] = [];
    let plain = "";
    let i = 0;
    const flush = (): void => {
        pushRun(runs, plain, format);
        plain = "";
    };
    while (i < line.length) {
        const c = line[i];
        if (c === "\\" && i + 1 < line.length && /[\\`*_[\]~]/.test(line[i + 1])) {
            plain += line[i + 1];
            i += 2;
            continue;
        }
        if (c === "`") {
            const fenceLen = /^`+/.exec(line.slice(i))![0].length;
            const fence = "`".repeat(fenceLen);
            const end = line.indexOf(fence, i + fenceLen);
            if (end > i + fenceLen) {
                let code = line.slice(i + fenceLen, end);
                if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1);
                flush();
                pushRun(runs, code, { ...format, code: true });
                i = end + fenceLen;
                continue;
            }
        }
        if (c === "[") {
            const m = /^\[([^\]\n]+)\]\((<[^>\n]+>|[^)\s]+)\)/.exec(line.slice(i));
            const href = m && normalizeLinkTarget(m[2].replace(/^<|>$/g, ""));
            if (m && href) {
                flush();
                for (const run of parseInlineMarkdown(m[1], { ...format, link: href })) {
                    pushRun(runs, run.text, run.format);
                }
                i += m[0].length;
                continue;
            }
        }
        if (c === "*" || c === "_" || c === "~") {
            let matched = false;
            for (const { marker, mark } of MARKERS) {
                if (!line.startsWith(marker, i) || !canOpen(line, i, marker.length)) continue;
                // A single `*` or `_` is not half of a double one.
                const single = marker.length === 1;
                if (single && line[i + 1] === marker) continue;
                const closes = (at: number): boolean =>
                    canClose(line, at, marker.length) &&
                    !(single && (line[at - 1] === marker || line[at + 1] === marker));
                let end = line.indexOf(marker, i + marker.length + 1);
                while (end !== -1 && !closes(end)) {
                    end = line.indexOf(marker, end + 1);
                }
                if (end === -1) continue;
                const inner = line.slice(i + marker.length, end);
                const innerFormat: InlineFormat =
                    marker === "***" ? { ...format, bold: true, italic: true } : { ...format, [mark]: true };
                flush();
                for (const run of parseInlineMarkdown(inner, innerFormat)) {
                    pushRun(runs, run.text, run.format);
                }
                i = end + marker.length;
                matched = true;
                break;
            }
            if (matched) continue;
            // A marker that opened nothing is text, all of it, so `**` does not become two tries at `*`.
            const run = /^(\*+|_+|~+)/.exec(line.slice(i))![0];
            plain += run;
            i += run.length;
            continue;
        }
        plain += c;
        i += 1;
    }
    flush();
    return runs;
}

/** Whether a line of pasted plain text has inline markdown that would become formatting. */
export function hasInlineMarkdown(line: string): boolean {
    return parseInlineMarkdown(line).some((r) => r.format);
}

/**
 * Pasted plain text with markdown to lines of formatted runs. Headings (`# …`) become bold lines; fenced code
 * blocks, lists and quotes stay as their markdown, which is still sent as a code block, list or quote.
 */
export function markdownTextToLines(text: string): FormatRun[][] {
    const lines = text.split(/\r\n|\r|\n/g);
    let inFence = false;
    return lines.map((line) => {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            return [{ text: line }];
        }
        if (inFence) return [{ text: line }];
        const heading = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
        if (heading) return parseInlineMarkdown(heading[1], { bold: true });
        // A list or quote marker stays text, its content may be formatted.
        const prefix = /^(\s*(?:[-+*]|\d{1,9}[.)])\s+|\s*>\s?)/.exec(line);
        if (prefix && !(prefix[0].trim() === "*" && /^\s*\*\S/.test(line))) {
            return [{ text: prefix[0] }, ...parseInlineMarkdown(line.slice(prefix[0].length))];
        }
        return parseInlineMarkdown(line);
    });
}

// --- Pasted HTML -----------------------------------------------------------------------------------------------

const BLOCK_TAGS = new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "DD",
    "DETAILS",
    "DIV",
    "DL",
    "DT",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "FORM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "LI",
    "MAIN",
    "NAV",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "SUMMARY",
    "TABLE",
    "TR",
    "UL",
]);
const SKIPPED_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "HEAD",
    "TITLE",
    "META",
    "LINK",
    "NOSCRIPT",
    "TEMPLATE",
    "SVG",
    "IMG",
]);

/** A line being built from pasted HTML, with its prefix (list marker, quote) kept apart from its runs. */
interface HtmlLine {
    prefix: string;
    runs: FormatRun[];
}

class HtmlLineBuilder {
    public readonly lines: HtmlLine[] = [];
    private current: HtmlLine | null = null;
    private blankLinePending = false;

    public constructor(private readonly quotePrefix: () => string) {}

    private ensureLine(): HtmlLine {
        if (!this.current) {
            if (this.blankLinePending && this.lines.length) {
                this.lines.push({ prefix: this.quotePrefix().trimEnd(), runs: [] });
            }
            this.blankLinePending = false;
            this.current = { prefix: this.quotePrefix(), runs: [] };
            this.lines.push(this.current);
        }
        return this.current;
    }

    public setPrefix(prefix: string): void {
        this.ensureLine().prefix += prefix;
    }

    public text(text: string, format: InlineFormat | undefined, pre: boolean): void {
        if (pre) {
            const parts = text.split("\n");
            parts.forEach((part, i) => {
                if (i > 0) this.newLine();
                if (part) pushRun(this.ensureLine().runs, part, format);
            });
            return;
        }
        let t = text.replace(/\s+/g, " ");
        const runs = this.current?.runs;
        const last = runs?.length ? runs[runs.length - 1].text : "";
        // Spaces collapse as the browser shows them: none at a line start, one between words.
        if (!last || last.endsWith(" ")) t = t.replace(/^ /, "");
        if (!t) return;
        pushRun(this.ensureLine().runs, t, format);
    }

    /** Trailing spaces of the current line go, as the browser does not show them either. */
    private trimLine(): void {
        const runs = this.current?.runs;
        while (runs?.length) {
            const last = runs[runs.length - 1];
            last.text = last.text.replace(/ +$/, "");
            if (last.text) break;
            runs.pop();
        }
    }

    /** Ends the current line (a `<br>`). */
    public newLine(): void {
        if (!this.current) this.ensureLine();
        this.trimLine();
        this.current = null;
    }

    /** Ends the current block, if it has anything. */
    public endBlock(paragraph: boolean): void {
        if (this.current) {
            this.trimLine();
            this.current = null;
        }
        if (paragraph) this.blankLinePending = true;
    }
}

function styleFormat(el: HTMLElement, format: InlineFormat | undefined): InlineFormat | undefined {
    const style = el.style;
    if (!style) return format;
    let out = format;
    const weight = style.fontWeight;
    if (weight) {
        const bold = weight === "bold" || weight === "bolder" || parseInt(weight, 10) >= 600;
        const normal =
            weight === "normal" || weight === "lighter" || (parseInt(weight, 10) > 0 && parseInt(weight, 10) < 600);
        if (bold) out = withMark(out, "bold", true);
        else if (normal) out = withMark(out, "bold", false);
    }
    if (style.fontStyle === "italic" || style.fontStyle === "oblique") out = withMark(out, "italic", true);
    else if (style.fontStyle === "normal") out = withMark(out, "italic", false);
    const decoration = `${style.textDecoration} ${style.textDecorationLine}`;
    if (/underline/.test(decoration) && !el.closest("a")) out = withMark(out, "underline", true);
    if (/line-through/.test(decoration)) out = withMark(out, "strike", true);
    if (/mono/i.test(style.fontFamily) || /\b(menlo|consolas|courier|monaco)\b/i.test(style.fontFamily)) {
        out = withMark(out, "code", true);
    }
    return out;
}

function isPreformatted(el: HTMLElement): boolean {
    return el.tagName === "PRE" || /^pre/.test(el.style?.whiteSpace ?? "");
}

/**
 * Lines of formatted runs from pasted HTML (a browser page, Notion, Google Docs, Telegram, ChatGPT…): bold,
 * italic, underline, strike, monospace and links become formatting; paragraphs and line breaks lines;
 * headings bold lines; lists `- ` / `1. ` lines and quotes `> ` lines, which go out as a list or quote;
 * a `<pre>` a fenced code block. Anything else is its text.
 */
export function htmlToLines(html: string): FormatRun[][] {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const quotes: string[] = [];
    const builder = new HtmlLineBuilder(() => quotes.join(""));
    const listStack: { ordered: boolean; counter: number }[] = [];

    const walk = (node: Node, format: InlineFormat | undefined, pre: boolean): void => {
        if (node.nodeType === Node.TEXT_NODE) {
            builder.text(node.nodeValue ?? "", format, pre);
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as HTMLElement;
        const tag = el.tagName;
        if (SKIPPED_TAGS.has(tag)) return;
        if (el.getAttribute("aria-hidden") === "true" || el.style?.display === "none") return;

        let f = styleFormat(el, format);
        switch (tag) {
            case "B":
            case "STRONG":
                // Google Docs wraps everything in <b style="font-weight:normal">; styleFormat has read that.
                if (!/normal|[1-5]00/.test(el.style?.fontWeight ?? "")) f = withMark(f, "bold", true);
                break;
            case "I":
            case "EM":
            case "CITE":
            case "VAR":
                f = withMark(f, "italic", true);
                break;
            case "U":
            case "INS":
                f = withMark(f, "underline", true);
                break;
            case "S":
            case "DEL":
            case "STRIKE":
                f = withMark(f, "strike", true);
                break;
            case "CODE":
            case "KBD":
            case "SAMP":
            case "TT":
                if (!pre) f = withMark(f, "code", true);
                break;
            case "A": {
                const href = normalizeLinkTarget(el.getAttribute("href") ?? "");
                if (href && href !== el.textContent?.trim()) f = withLink(f, href);
                break;
            }
            case "BR":
                builder.newLine();
                return;
            case "HR":
                builder.endBlock(true);
                builder.text("———", undefined, false);
                builder.endBlock(true);
                return;
        }

        if (/^H[1-6]$/.test(tag)) f = withMark(f, "bold", true);

        if (tag === "PRE" || (isPreformatted(el) && BLOCK_TAGS.has(tag))) {
            builder.endBlock(true);
            const text = (el.textContent ?? "").replace(/\n$/, "");
            const fence = "`".repeat(Math.max(3, longestRun(text, "`") + 1));
            builder.text(fence, undefined, true);
            builder.newLine();
            builder.text(text, undefined, true);
            builder.newLine();
            builder.text(fence, undefined, true);
            builder.endBlock(true);
            return;
        }

        const block = BLOCK_TAGS.has(tag);
        if (tag === "UL" || tag === "OL") {
            builder.endBlock(listStack.length === 0);
            listStack.push({ ordered: tag === "OL", counter: parseInt(el.getAttribute("start") ?? "1", 10) || 1 });
            for (const child of Array.from(el.childNodes)) walk(child, f, pre);
            listStack.pop();
            builder.endBlock(listStack.length === 0);
            return;
        }
        if (tag === "LI") {
            builder.endBlock(false);
            const list = listStack[listStack.length - 1];
            const indent = "    ".repeat(Math.max(0, listStack.length - 1));
            const marker = list?.ordered ? `${list.counter++}. ` : "- ";
            builder.setPrefix(indent + marker);
            for (const child of Array.from(el.childNodes)) {
                // Paragraphs inside list items (ChatGPT, Notion) must not break the item.
                if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName === "P") {
                    for (const c of Array.from(child.childNodes)) walk(c, f, pre);
                } else {
                    walk(child, f, pre);
                }
            }
            builder.endBlock(false);
            return;
        }
        if (tag === "BLOCKQUOTE") {
            builder.endBlock(true);
            quotes.push("> ");
            for (const child of Array.from(el.childNodes)) walk(child, f, pre);
            builder.endBlock(false);
            quotes.pop();
            builder.endBlock(true);
            return;
        }
        if (tag === "TR") {
            builder.endBlock(false);
            const cells = Array.from(el.children).filter((c) => c.tagName === "TD" || c.tagName === "TH");
            cells.forEach((cell, i) => {
                if (i > 0) builder.text(" · ", undefined, true);
                for (const child of Array.from(cell.childNodes))
                    walk(child, cell.tagName === "TH" ? withMark(f, "bold", true) : f, pre);
            });
            builder.endBlock(false);
            return;
        }

        if (block) builder.endBlock(tag === "P" || /^H[1-6]$/.test(tag) || tag === "TABLE");
        const childPre = pre || isPreformatted(el);
        for (const child of Array.from(el.childNodes)) walk(child, f, childPre);
        if (block) builder.endBlock(tag === "P" || /^H[1-6]$/.test(tag) || tag === "TABLE");
    };

    walk(doc.body, undefined, false);

    const lines = builder.lines.map((line) => (line.prefix ? [{ text: line.prefix }, ...line.runs] : line.runs));
    // No empty lines at the ends.
    while (lines.length && !lines[0].some((r) => r.text.trim())) lines.shift();
    while (lines.length && !lines[lines.length - 1].some((r) => r.text.trim())) lines.pop();
    return lines;
}

/** Whether pasted HTML carries anything htmlToLines would keep beyond its text. */
export function htmlHasFormatting(html: string): boolean {
    if (!html) return false;
    const lines = htmlToLines(html);
    return (
        lines.some((line) => line.some((run) => run.format)) ||
        lines.some((l) => /^(\s*(- |\d+\. )|> )/.test(l[0]?.text ?? ""))
    );
}
