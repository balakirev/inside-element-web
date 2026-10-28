/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { EventType, MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";

import InsideQuickLook, { openInsideQuickLook } from "./InsideQuickLook";
import Modal from "../../../Modal";
import { FileDownloader } from "../../../utils/FileDownloader";
import { type MediaEventHelper } from "../../../utils/MediaEventHelper";
import { type DocumentMedia } from "../../../@types/document-viewer";
import { type PdfHostMessage, type PdfUsercontentMessage } from "../../../usercontent/pdf/protocol";
import { PDF_IFRAME_PERMISSIONS, PDF_USERCONTENT_URL } from "../right_panel/PdfViewer";
import { flushPdfViewerState } from "../../../utils/pdfViewerState";
import { stubClient } from "../../../test/test-utils";

const blob = new Blob(["%PDF-1.7\n"], { type: "application/pdf" });

function mkMedia(): DocumentMedia {
    return { uri: "mxc://example.org/spec.pdf", name: "spec.pdf", size: 9049210, blob: vi.fn(async () => blob) };
}

interface FakePort {
    postMessage: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent) => void) | null;
    close: ReturnType<typeof vi.fn>;
}

/** Give the frame a window and hand over its end of the channel, as the usercontent page does. */
function connectFrame(): FakePort {
    const port: FakePort = { postMessage: vi.fn(), onmessage: null, close: vi.fn() };
    const source = {};
    Object.defineProperty(screen.getByTestId("pdf-iframe"), "contentWindow", { configurable: true, value: source });
    const event = new MessageEvent("message", {
        data: { type: "ready" } satisfies PdfUsercontentMessage,
        source: source as Window,
        origin: "null",
    });
    Object.defineProperty(event, "ports", { value: [port] });
    act(() => {
        window.dispatchEvent(event);
    });
    return port;
}

function fromFrame(port: FakePort, data: PdfUsercontentMessage): void {
    act(() => port.onmessage?.(new MessageEvent("message", { data })));
}

function sent(port: FakePort): PdfHostMessage[] {
    return port.postMessage.mock.calls.map(([message]) => message as PdfHostMessage);
}

async function renderLoaded(onFinished = vi.fn()): Promise<{ port: FakePort; onFinished: ReturnType<typeof vi.fn> }> {
    render(<InsideQuickLook media={mkMedia()} name="spec.pdf" onFinished={onFinished} />);
    const port = connectFrame();
    await waitFor(() => expect(sent(port).some((message) => message.type === "load")).toBe(true));
    fromFrame(port, { type: "loaded", pageCount: 12, page: 3 });
    await waitFor(() => expect(document.activeElement).toHaveClass("mx_InsideQuickLook_body"));
    return { port, onFinished };
}

describe("InsideQuickLook", () => {
    beforeEach(() => {
        flushPdfViewerState();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Modal.forceCloseAllModals();
    });

    it("shows the PDF in the sandboxed frame inside a window, with the name, page and size", async () => {
        const { container } = render(<InsideQuickLook media={mkMedia()} name="spec.pdf" onFinished={vi.fn()} />);

        const frame = screen.getByTestId("pdf-iframe");
        expect(frame).toHaveAttribute("sandbox", PDF_IFRAME_PERMISSIONS);
        expect(frame.getAttribute("src")).toContain(PDF_USERCONTENT_URL);
        expect(frame.closest(".mx_InsideQuickLook_body")).toBeInTheDocument();
        expect(screen.getByRole("dialog", { name: "spec.pdf" })).toHaveClass("mx_InsideQuickLook_window");
        expect(container.querySelector(".mx_InsideQuickLook_backdrop")).toBeInTheDocument();
        expect(container.querySelector(".mx_InsideQuickLook_title")).toHaveTextContent("spec.pdf");
        expect(container.querySelector(".mx_InsideQuickLook_meta")).toHaveTextContent("8.6 MB");
        // The pages have the keys from the start.
        await waitFor(() => expect(document.activeElement).toBe(container.querySelector(".mx_InsideQuickLook_body")));

        const port = connectFrame();
        await waitFor(() => expect(sent(port)[0]).toMatchObject({ type: "load" }));
        fromFrame(port, { type: "loaded", pageCount: 12, page: 3 });
        expect(container.querySelector(".mx_InsideQuickLook_meta")).toHaveTextContent("Page 3 of 12 · 8.6 MB");
        fromFrame(port, { type: "page", page: 4 });
        expect(container.querySelector(".mx_InsideQuickLook_meta")).toHaveTextContent("Page 4 of 12");
    });

    it.each([
        ["Escape", () => fireEvent.keyDown(document.activeElement!, { key: "Escape" })],
        ["the close button", () => fireEvent.click(screen.getByRole("button", { name: "Close" }))],
        ["the backdrop", () => fireEvent.click(screen.getByTestId("quick-look-backdrop"))],
        ["Escape inside the frame", (port: FakePort) => fromFrame(port, { type: "dismiss" })],
    ])("closes on %s after the closing animation", async (_, trigger) => {
        const { port, onFinished } = await renderLoaded();

        trigger(port);

        expect(document.querySelector(".mx_InsideQuickLook")).toHaveClass("mx_InsideQuickLook_closing");
        await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    });

    it("closes at once with reduced motion", async () => {
        vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
        const { onFinished } = await renderLoaded();

        fireEvent.keyDown(document.activeElement!, { key: "Escape" });

        expect(onFinished).toHaveBeenCalledTimes(1);
    });

    it("scrolls and zooms the pages from the keyboard", async () => {
        const { port } = await renderLoaded();
        const body = document.activeElement!;

        fireEvent.keyDown(body, { key: " " });
        fireEvent.keyDown(body, { key: " ", shiftKey: true });
        fireEvent.keyDown(body, { key: "ArrowDown" });
        fireEvent.keyDown(body, { key: "PageUp" });
        fireEvent.keyDown(body, { key: "=", metaKey: true });
        fireEvent.keyDown(body, { key: "-", ctrlKey: true });

        expect(sent(port).slice(1)).toEqual([
            { type: "scroll", step: "page_down" },
            { type: "scroll", step: "page_up" },
            { type: "scroll", step: "line_down" },
            { type: "scroll", step: "page_up" },
            { type: "zoom", direction: "in" },
            { type: "zoom", direction: "out" },
        ]);
    });

    it("leaves Space on a focused button to the button", async () => {
        const { port } = await renderLoaded();
        const zoomIn = screen.getByRole("button", { name: "Zoom in" });

        fireEvent.keyDown(zoomIn, { key: " " });
        fireEvent.click(zoomIn);

        expect(sent(port).slice(1)).toEqual([{ type: "zoom", direction: "in" }]);
    });

    it("downloads the file under its name", async () => {
        const download = vi.spyOn(FileDownloader.prototype, "download").mockResolvedValue(undefined);
        await renderLoaded();

        await userEvent.click(screen.getByRole("button", { name: "Download" }));

        await waitFor(() => expect(download).toHaveBeenCalledWith({ blob, name: "spec.pdf" }));
    });

    describe.each([
        ["Markdown", "markdown", "README.md", "# Hello\n\nSome text.\n", "markdown-content"],
        ["plain text", "text", "notes.txt", "Hello\nSome text.\n", "plain-text-content"],
    ] as const)("with a %s file", (_, kind, name, body, contentTestId) => {
        const textBlob = new Blob([body], { type: kind === "markdown" ? "text/markdown" : "text/plain" });

        function mkTextMedia(): DocumentMedia {
            return { uri: `mxc://example.org/${name}`, name, size: 2048, blob: vi.fn(async () => textBlob) };
        }

        async function renderText(
            onFinished = vi.fn(),
        ): Promise<{ container: HTMLElement; content: HTMLElement; onFinished: ReturnType<typeof vi.fn> }> {
            const { container } = render(
                <InsideQuickLook media={mkTextMedia()} name={name} kind={kind} onFinished={onFinished} />,
            );
            const content = await screen.findByTestId(contentTestId);
            await waitFor(() => expect(document.activeElement).toHaveClass("mx_InsideQuickLook_body"));
            return { container, content, onFinished };
        }

        beforeEach(() => {
            stubClient();
        });

        it("shows the document in the window, with the same header and no PDF frame or zoom", async () => {
            const { container, content } = await renderText();

            expect(content).toHaveTextContent("Some text.");
            expect(content.closest(".mx_InsideQuickLook_body")).toBeInTheDocument();
            expect(screen.queryByTestId("pdf-iframe")).toBeNull();
            expect(screen.getByRole("dialog", { name })).toHaveClass("mx_InsideQuickLook_window");
            expect(container.querySelector(".mx_InsideQuickLook_title")).toHaveTextContent(name);
            expect(container.querySelector(".mx_InsideQuickLook_meta")).toHaveTextContent("2 kB");
            expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
            expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
        });

        it.each([
            ["Escape", () => fireEvent.keyDown(document.activeElement!, { key: "Escape" })],
            ["the close button", () => fireEvent.click(screen.getByRole("button", { name: "Close" }))],
            ["the backdrop", () => fireEvent.click(screen.getByTestId("quick-look-backdrop"))],
        ])("closes on %s", async (_, trigger) => {
            const { onFinished } = await renderText();

            trigger();

            expect(document.querySelector(".mx_InsideQuickLook")).toHaveClass("mx_InsideQuickLook_closing");
            await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
        });

        it("keeps the focus inside the window", async () => {
            await renderText();
            const outside = document.createElement("button");
            document.body.appendChild(outside);

            act(() => outside.focus());

            await waitFor(() =>
                expect(document.querySelector(".mx_InsideQuickLook")).toContainElement(
                    document.activeElement as HTMLElement,
                ),
            );
            outside.remove();
        });

        it("scrolls the document from the keyboard", async () => {
            const { content } = await renderText();
            Object.defineProperty(content, "clientHeight", { configurable: true, value: 400 });
            Object.defineProperty(content, "scrollHeight", { configurable: true, value: 5000 });
            const body = document.activeElement!;

            fireEvent.keyDown(body, { key: "ArrowDown" });
            expect(content.scrollTop).toBe(40);
            fireEvent.keyDown(body, { key: " " });
            expect(content.scrollTop).toBe(400);
            fireEvent.keyDown(body, { key: "ArrowUp" });
            expect(content.scrollTop).toBe(360);
            fireEvent.keyDown(body, { key: "Home" });
            expect(content.scrollTop).toBe(0);
        });

        it("downloads the file under its name", async () => {
            const download = vi.spyOn(FileDownloader.prototype, "download").mockResolvedValue(undefined);
            await renderText();

            await userEvent.click(screen.getByRole("button", { name: "Download" }));

            await waitFor(() => expect(download).toHaveBeenCalledWith({ blob: textBlob, name }));
        });
    });

    describe("as a modal", () => {
        function mkEvent(): MatrixEvent {
            return new MatrixEvent({
                room_id: "!room:example.org",
                sender: "@user:example.org",
                type: EventType.RoomMessage,
                content: {
                    body: "spec.pdf",
                    msgtype: MsgType.File,
                    url: "mxc://example.org/spec.pdf",
                    info: { mimetype: "application/pdf", size: 1234 },
                },
            });
        }

        function mkHelper(): MediaEventHelper {
            return {
                media: { srcMxc: "mxc://example.org/spec.pdf" },
                fileName: "spec.pdf",
                sourceBlob: { value: Promise.resolve(blob) },
            } as unknown as MediaEventHelper;
        }

        it("keeps Escape from the room beneath (which would close the right panel) and gives the focus back", async () => {
            const { getByRole } = render(<button>tile</button>);
            const tile = getByRole("button", { name: "tile" });
            tile.focus();
            const roomEscape = vi.fn();
            document.addEventListener("keydown", roomEscape);

            act(() => openInsideQuickLook(mkEvent(), mkHelper()));
            await waitFor(() => expect(document.querySelector(".mx_InsideQuickLook")).toBeInTheDocument());
            expect(document.querySelector(".mx_Dialog_insideQuickLook")).toBeInTheDocument();
            expect(Modal.hasDialogs()).toBe(true);

            await waitFor(() => expect(document.activeElement).toHaveClass("mx_InsideQuickLook_body"));
            fireEvent.keyDown(document.activeElement!, { key: "Escape" });

            expect(roomEscape).not.toHaveBeenCalled();
            // The Modal root renders outside testing-library: let the closing animation run inside act.
            await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
            await waitFor(() => expect(document.querySelector(".mx_InsideQuickLook")).not.toBeInTheDocument());
            expect(Modal.hasDialogs()).toBe(false);
            await waitFor(() => expect(document.activeElement).toBe(tile));
            document.removeEventListener("keydown", roomEscape);
        });

        it("opens a Markdown file as Markdown", async () => {
            stubClient();
            const mxEvent = new MatrixEvent({
                room_id: "!room:example.org",
                sender: "@user:example.org",
                type: EventType.RoomMessage,
                content: {
                    body: "README.md",
                    msgtype: MsgType.File,
                    url: "mxc://example.org/readme",
                    info: { mimetype: "text/markdown", size: 12 },
                },
            });
            const helper = {
                media: { srcMxc: "mxc://example.org/readme" },
                fileName: "README.md",
                sourceBlob: { value: Promise.resolve(new Blob(["# Read me\n"], { type: "text/markdown" })) },
            } as unknown as MediaEventHelper;

            act(() => openInsideQuickLook(mxEvent, helper));

            await waitFor(() =>
                expect(document.querySelector("[data-testid='markdown-content'] h1")).toHaveTextContent("Read me"),
            );
            expect(document.querySelector("[data-testid='pdf-iframe']")).toBeNull();
        });
    });
});
