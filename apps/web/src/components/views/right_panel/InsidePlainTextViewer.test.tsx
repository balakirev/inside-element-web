/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "test-utils-rtl";

import { InsidePlainTextViewer, MAX_PLAIN_TEXT_BYTES } from "./InsidePlainTextViewer";
import { type DocumentMedia } from "../../../@types/document-viewer";

function media(body: BlobPart = "line 1\n  line 2\n", size?: number): DocumentMedia {
    return {
        uri: "mxc://example.org/notes.txt",
        name: "notes.txt",
        size,
        blob: vi.fn(async () => new Blob([body], { type: "text/plain" })),
    };
}

describe("InsidePlainTextViewer", () => {
    it("shows the text as it is, lines and spaces kept", async () => {
        render(<InsidePlainTextViewer media={media()} />);

        expect(screen.getByRole("status")).toHaveTextContent("Loading document");
        const content = await screen.findByTestId("plain-text-content");
        expect(content.tagName).toBe("PRE");
        expect(content.textContent).toBe("line 1\n  line 2\n");
    });

    it("never treats the text as markup", async () => {
        render(<InsidePlainTextViewer media={media("<b>bold</b><script>window.pwned = true</script>")} />);

        const content = await screen.findByTestId("plain-text-content");
        expect(content.querySelector("b, script")).toBeNull();
        expect(content).toHaveTextContent("<b>bold</b><script>window.pwned = true</script>");
    });

    it("refuses a file the sender declares as too large without downloading it", async () => {
        const tooLarge = media("x", MAX_PLAIN_TEXT_BYTES + 1);

        render(<InsidePlainTextViewer media={tooLarge} />);

        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Unable to load this file."));
        expect(tooLarge.blob).not.toHaveBeenCalled();
    });

    it("refuses a file that is not text after all", async () => {
        render(<InsidePlainTextViewer media={media(new Uint8Array([0x50, 0x4b, 0x00, 0x03]))} />);

        await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
        expect(screen.queryByTestId("plain-text-content")).toBeNull();
    });
});
