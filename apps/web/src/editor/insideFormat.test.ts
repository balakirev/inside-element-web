/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";

import {
    htmlHasFormatting,
    htmlToLines,
    markdownTextToLines,
    normalizeLinkTarget,
    parseInlineMarkdown,
    type FormatRun,
} from "./insideFormat";
import EditorModel from "./model";
import { createPartCreator } from "./__mocks__";
import { htmlSerializeIfNeeded, textSerialize } from "./serialize";
import { formatRunsToParts, parsePastedContent } from "./deserialize";

const simple = (runs: FormatRun[]): (string | [string, object])[] =>
    runs.map((r) => (r.format ? [r.text, r.format] : r.text));

describe("editor/insideFormat", () => {
    describe("parseInlineMarkdown", () => {
        it.each([
            ["**bold**", [["bold", { bold: true }]]],
            ["__italic__", [["italic", { italic: true }]]],
            ["*italic*", [["italic", { italic: true }]]],
            ["_italic_", [["italic", { italic: true }]]],
            ["~~gone~~", [["gone", { strike: true }]]],
            ["***both***", [["both", { bold: true, italic: true }]]],
            ["`a * b`", [["a * b", { code: true }]]],
            ["``a ` b``", [["a ` b", { code: true }]]],
            ["[site](https://example.org)", [["site", { link: "https://example.org" }]]],
            ["[site](example.org)", [["site", { link: "https://example.org" }]]],
            [
                "[**b** site](https://e.org)",
                [
                    ["b", { link: "https://e.org", bold: true }],
                    [" site", { link: "https://e.org" }],
                ],
            ],
            [
                "a **b *c* d** e",
                ["a ", ["b ", { bold: true }], ["c", { bold: true, italic: true }], [" d", { bold: true }], " e"],
            ],
            ["«**кавычки**»", ["«", ["кавычки", { bold: true }], "»"]],
        ])("%s", (md, expected) => {
            expect(simple(parseInlineMarkdown(md))).toEqual(expected);
        });

        it.each([
            "2*3*4",
            "snake_case_name",
            "a * b * c",
            "** not bold **",
            "[link](javascript:alert(1))",
            "price: 5$ * 2",
            "\\*\\*escaped\\*\\*",
        ])("leaves %s as text", (md) => {
            const runs = parseInlineMarkdown(md);
            expect(runs.every((r) => !r.format)).toBe(true);
        });
    });

    it("reads headings as bold lines, keeps lists, quotes and code blocks as markdown", () => {
        const lines = markdownTextToLines("## Title\n- **one**\n1. two\n> quote\n```\n**not bold**\n```");
        expect(lines.map(simple)).toEqual([
            [["Title", { bold: true }]],
            ["- ", ["one", { bold: true }]],
            ["1. ", "two"],
            ["> ", "quote"],
            ["```"],
            ["**not bold**"],
            ["```"],
        ]);
    });

    describe("htmlToLines", () => {
        it("reads inline formatting", () => {
            const lines = htmlToLines(
                "<p>A <strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <code>c</code> <a href='https://x.y/'>l</a></p>",
            );
            expect(lines.map(simple)).toEqual([
                [
                    "A ",
                    ["b", { bold: true }],
                    " ",
                    ["i", { italic: true }],
                    " ",
                    ["u", { underline: true }],
                    " ",
                    ["s", { strike: true }],
                    " ",
                    ["c", { code: true }],
                    " ",
                    ["l", { link: "https://x.y/" }],
                ],
            ]);
        });

        it("reads Google Docs' inline styles, not its <b style=font-weight:normal> wrapper", () => {
            const html =
                '<b style="font-weight:normal;" id="docs-internal-guid-1"><span style="font-weight:700">Bold</span>' +
                '<span style="font-weight:400"> plain </span><span style="font-style:italic">it</span></b>';
            expect(htmlToLines(html).map(simple)).toEqual([
                [["Bold", { bold: true }], " plain ", ["it", { italic: true }]],
            ]);
        });

        it("reads ChatGPT's lists and paragraphs", () => {
            const html =
                "<h3>Plan</h3><p>Steps:</p><ol><li><p><strong>First</strong> step</p></li><li><p>Second</p></li></ol>" +
                "<ul><li>dot</li></ul><p>End</p>";
            expect(htmlToLines(html).map(simple)).toEqual([
                [["Plan", { bold: true }]],
                [],
                ["Steps:"],
                [],
                ["1. ", ["First", { bold: true }], " step"],
                ["2. ", "Second"],
                [],
                ["- ", "dot"],
                [],
                ["End"],
            ]);
        });

        it("keeps a <pre> as a fenced code block and <br> as line breaks", () => {
            const html = "<div>one<br>two</div><pre><code>let a = 1;\n  b();\n</code></pre>";
            expect(htmlToLines(html).map(simple)).toEqual([
                ["one"],
                ["two"],
                [],
                ["```"],
                ["let a = 1;"],
                ["  b();"],
                ["```"],
            ]);
        });

        it("tells HTML with formatting from plain HTML", () => {
            expect(htmlHasFormatting("<p>just text</p>")).toBe(false);
            expect(htmlHasFormatting("<p>a <b>b</b></p>")).toBe(true);
            expect(htmlHasFormatting("<ul><li>x</li></ul>")).toBe(true);
        });
    });

    it.each([
        ["https://a.b/c", "https://a.b/c"],
        ["example.org/path", "https://example.org/path"],
        ["mailto:a@b.c", "mailto:a@b.c"],
        ["javascript:alert(1)", undefined],
        ["not a link", undefined],
        ["", undefined],
    ])("normalizeLinkTarget(%s)", (input, expected) => {
        expect(normalizeLinkTarget(input)).toBe(expected);
    });

    describe("sending", () => {
        const pc = createPartCreator();
        const model = (lines: FormatRun[][]) => new EditorModel(formatRunsToParts(lines, pc), pc);

        it("sends formats as HTML and the text as the body", () => {
            const m = model([parseInlineMarkdown("Hi **bold** and [link](https://e.org) with `a*b`")]);
            expect(htmlSerializeIfNeeded(m)).toBe(
                'Hi <strong>bold</strong> and <a href="https://e.org">link</a> with <code>a*b</code>',
            );
            expect(textSerialize(m)).toBe("Hi bold and link with a*b");
        });

        it("escapes markdown inside formatted text", () => {
            const m = model([[{ text: "2*3*4 <tag> _x_", format: { bold: true } }]]);
            expect(htmlSerializeIfNeeded(m)).toBe("<strong>2*3*4 &lt;tag&gt; _x_</strong>");
        });

        it("still sends markdown typed outside formatted text", () => {
            const m = model([[{ text: "**md** and " }, { text: "fmt", format: { italic: true } }]]);
            expect(htmlSerializeIfNeeded(m)).toBe("<strong>md</strong> and <em>fmt</em>");
        });

        it("nests formats once over their whole run", () => {
            const m = model([
                [
                    { text: "a ", format: { strike: true } },
                    { text: "b", format: { strike: true, bold: true } },
                    { text: " c", format: { strike: true } },
                ],
            ]);
            expect(htmlSerializeIfNeeded(m)).toBe("<del>a <strong>b</strong> c</del>");
        });

        it("sends formats as HTML with markdown off", () => {
            const m = model([[{ text: "**raw** " }, { text: "u", format: { underline: true } }], [{ text: "x<y" }]]);
            expect(htmlSerializeIfNeeded(m, { useMarkdown: false })).toBe("**raw** <u>u</u><br/>x&lt;y");
        });

        it("pastes HTML and markdown through parsePastedContent", () => {
            const fromHtml = parsePastedContent("<i>it</i> x", "it x", pc).map((p) => p.serialize());
            expect(fromHtml).toEqual([
                { type: "plain", text: "it", format: { italic: true } },
                { type: "plain", text: " x" },
            ]);
            const fromMd = parsePastedContent("", "~~old~~ new", pc).map((p) => p.serialize());
            expect(fromMd).toEqual([
                { type: "plain", text: "old", format: { strike: true } },
                { type: "plain", text: " new" },
            ]);
            const plain = parsePastedContent("<p>plain</p>", "plain *", pc).map((p) => p.serialize());
            expect(plain).toEqual([{ type: "plain", text: "plain *" }]);
        });
    });
});
