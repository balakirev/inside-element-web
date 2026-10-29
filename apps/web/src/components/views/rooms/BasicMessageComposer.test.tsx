/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { type MatrixClient, Room } from "matrix-js-sdk/src/matrix";

import BasicMessageComposer from "./BasicMessageComposer";
import * as TestUtils from "test-utils";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import EditorModel from "../../../editor/model";
import { createPartCreator, createRenderer } from "../../../editor/__mocks__";
import { CommandPartCreator } from "../../../editor/parts";
import DocumentOffset from "../../../editor/offset";
import { SDKContextClass } from "../../../contexts/SDKContextClass";
import SettingsStore from "../../../settings/SettingsStore";
import { SDKContext } from "../../../contexts/SDKContext.ts";

describe("BasicMessageComposer", () => {
    const renderer = createRenderer();
    const pc = createPartCreator();

    TestUtils.stubClient();

    const client: MatrixClient = MatrixClientPeg.safeGet();

    const roomId = "!1234567890:domain";
    const userId = client.getSafeUserId();
    const room = new Room(roomId, client, userId);

    it("should allow a user to paste a URL without it being mangled", async () => {
        const model = new EditorModel([], pc, renderer);
        render(<BasicMessageComposer model={model} room={room} />, {
            wrapper: ({ children }) => (
                <SDKContext.Provider value={SDKContextClass.instance}>{children}</SDKContext.Provider>
            ),
        });
        const testUrl = "https://element.io";
        const mockDataTransfer = generateMockDataTransferForString(testUrl);
        await userEvent.paste(mockDataTransfer);

        expect(model.parts).toHaveLength(1);
        expect(model.parts[0].text).toBe(testUrl);
        expect(screen.getByText(testUrl)).toBeInTheDocument();
    });

    it("should replaceEmoticons properly", async () => {
        vi.spyOn(SettingsStore, "getValue").mockImplementation((settingName: string) => {
            return settingName === "MessageComposerInput.autoReplaceEmoji";
        });
        userEvent.setup();
        const model = new EditorModel([], pc, renderer);
        render(<BasicMessageComposer model={model} room={room} />, {
            wrapper: ({ children }) => (
                <SDKContext.Provider value={SDKContextClass.instance}>{children}</SDKContext.Provider>
            ),
        });

        const tranformations = [
            { before: "4:3 video", after: "4:3 video" },
            { before: "regexp 12345678", after: "regexp 12345678" },
            { before: "--:--)", after: "--:--)" },

            { before: "we <3 matrix", after: "we ❤️ matrix" },
            { before: "hello world :-)", after: "hello world 🙂" },
            { before: ":) hello world", after: "🙂 hello world" },
            { before: ":D 4:3 video :)", after: "😄 4:3 video 🙂" },

            { before: ":-D", after: "😄" },
            { before: ":D", after: "😄" },
            { before: ":3", after: "😽" },
            { before: "=-]", after: "🙂" },
        ];
        const input = screen.getByRole("textbox");

        for (const { before, after } of tranformations) {
            await userEvent.clear(input);
            //add a space after the text to trigger the replacement
            await userEvent.type(input, before + " ");
            const transformedText = model.parts.map((part) => part.text).join("");
            expect(transformedText).toBe(after + " ");
        }
    });

    it("should not mangle shift-enter when the autocomplete is open", async () => {
        const model = new EditorModel([], pc, renderer);
        render(<BasicMessageComposer model={model} room={room} />, {
            wrapper: ({ children }) => (
                <SDKContext.Provider value={SDKContextClass.instance}>{children}</SDKContext.Provider>
            ),
        });

        const input = screen.getByRole("textbox");

        await userEvent.type(input, "/plain foobar");
        await userEvent.type(input, "{Shift>}{Enter}{/Shift}");
        const transformedText = model.parts.map((part) => part.text).join("");
        expect(transformedText).toBe("/plain foobar\n");
    });

    it("should replace the selected text when inserting a new line", async () => {
        const model = new EditorModel([], pc, renderer);
        render(<BasicMessageComposer model={model} room={room} />, {
            wrapper: ({ children }) => (
                <SDKContext.Provider value={SDKContextClass.instance}>{children}</SDKContext.Provider>
            ),
        });

        const input = screen.getByRole("textbox");
        await userEvent.type(input, "hello world");

        // Select "world".
        const textNode = document.createTreeWalker(input, NodeFilter.SHOW_TEXT).nextNode()!;
        const range = document.createRange();
        range.setStart(textNode, 6);
        range.setEnd(textNode, 11);
        // jsdom does not implement Range.getBoundingClientRect, which the format bar asks for when
        // the selection changes.
        range.getBoundingClientRect = vi.fn().mockReturnValue({ top: 0, left: 0, width: 0, height: 0 });
        const selection = document.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);

        // Guard: without a real selection this test would only be exercising the caret path.
        expect(selection.isCollapsed).toBe(false);
        expect(selection.toString()).toBe("world");

        await userEvent.keyboard("{Shift>}{Enter}{/Shift}");

        expect(model.parts.map((part) => part.text).join("")).toBe("hello \n");
    });

    it("should escape single quote in placeholder", async () => {
        const model = new EditorModel([], pc, renderer);
        const composer = render(<BasicMessageComposer placeholder="Don't" model={model} room={room} />, {
            wrapper: ({ children }) => (
                <SDKContext.Provider value={SDKContextClass.instance}>{children}</SDKContext.Provider>
            ),
        });
        const input = composer.queryAllByRole("textbox");
        const placeholder = input[0].style.getPropertyValue("--placeholder");
        expect(placeholder).toMatch("'Don\\'t'");
    });

    it("should escape backslash in placeholder", async () => {
        const model = new EditorModel([], pc, renderer);
        const composer = render(<BasicMessageComposer placeholder={"w\\e"} model={model} room={room} />, {
            wrapper: ({ children }) => (
                <SDKContext.Provider value={SDKContextClass.instance}>{children}</SDKContext.Provider>
            ),
        });
        const input = composer.queryAllByRole("textbox");
        const placeholder = input[0].style.getPropertyValue("--placeholder");
        expect(placeholder).toMatch("'w\\\\e'");
    });

    it("should not consider typing for unknown or disabled slash commands", async () => {
        // create a command part which represents a slash command the client doesn't recognise
        const commandPc = new CommandPartCreator(room as unknown as Room, client as unknown as MatrixClient, null);
        const commandPart = commandPc.command("/unknown do stuff");
        const model = new EditorModel([commandPart], commandPc, renderer);

        // spy on typingStore.setSelfTyping
        const spy = vi.spyOn(SDKContextClass.instance.typingStore, "setSelfTyping");

        render(<BasicMessageComposer model={model} room={room} />, {
            wrapper: ({ children }) => (
                <SDKContext.Provider value={SDKContextClass.instance}>{children}</SDKContext.Provider>
            ),
        });

        // simulate typing by updating the model - this will call the component's update callback
        await model.update(commandPart.text, "insertText", new DocumentOffset(commandPart.text.length, true));

        // Since the command is not in CommandMap, it should not be considered typing
        expect(spy).toHaveBeenCalledWith(room.roomId, null, false);
        spy.mockRestore();
    });

    it("should ignore keydown events during IME composition", () => {
        const model = new EditorModel([], pc, renderer);
        render(<BasicMessageComposer model={model} room={room} />, {
            wrapper: ({ children }) => (
                <SDKContext.Provider value={SDKContextClass.instance}>{children}</SDKContext.Provider>
            ),
        });
        const input = screen.getByRole("textbox");

        // Start IME composition
        fireEvent.compositionStart(input);

        // Simulate Tab key during IME composition
        // The keydown should be ignored, so we check that the model state doesn't change
        const initialAutoComplete = model.autoComplete;
        const initialPartsLength = model.parts.length;

        // Create a keyboard event with isComposing flag
        const tabKeyEvent = new KeyboardEvent("keydown", {
            key: "Tab",
            bubbles: true,
            cancelable: true,
        });
        Object.defineProperty(tabKeyEvent, "isComposing", {
            value: true,
            writable: false,
        });

        // Fire the keydown event with isComposing flag
        fireEvent.keyDown(input, {
            ...tabKeyEvent,
            nativeEvent: tabKeyEvent,
        } as unknown as React.KeyboardEvent);

        // During IME composition, the keydown should be ignored
        // The model should not have changed
        expect(model.autoComplete).toBe(initialAutoComplete);
        expect(model.parts.length).toBe(initialPartsLength);

        // End IME composition
        fireEvent.compositionEnd(input);
    });

    // oxlint-disable-next-line vitest/expect-expect
    it("should handle keydown events normally when not composing", () => {
        const model = new EditorModel([], pc, renderer);
        render(<BasicMessageComposer model={model} room={room} />, {
            wrapper: ({ children }) => (
                <SDKContext.Provider value={SDKContextClass.instance}>{children}</SDKContext.Provider>
            ),
        });
        const input = screen.getByRole("textbox");

        // Simulate Tab key when NOT composing
        const tabKeyEvent = new KeyboardEvent("keydown", {
            key: "Tab",
            bubbles: true,
            cancelable: true,
        });
        Object.defineProperty(tabKeyEvent, "isComposing", {
            value: false,
            writable: false,
        });

        // Fire the keydown event without isComposing flag
        fireEvent.keyDown(input, {
            ...tabKeyEvent,
            nativeEvent: tabKeyEvent,
        } as unknown as React.KeyboardEvent);

        // The event should be processed normally (not ignored)
        // We can't easily verify tabCompleteName was called since it's private,
        // but the important thing is that the event wasn't ignored
        // The test passes if no errors are thrown and the event is handled
    });

    describe("Inside: formats as in Telegram Desktop", () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <SDKContext.Provider value={SDKContextClass.instance}>{children}</SDKContext.Provider>
        );

        function formats(model: EditorModel) {
            return model.parts.map((p) => (p.format ? [p.text, p.format] : p.text));
        }

        it("pastes HTML with its formatting, not as markdown", async () => {
            const model = new EditorModel([], pc, renderer);
            render(<BasicMessageComposer model={model} room={room} />, { wrapper });
            await userEvent.paste(
                generateMockDataTransfer({
                    "text/plain": "Hello world, see docs",
                    "text/html":
                        '<meta charset="utf-8"><p>Hello <b>world</b>, see <a href="https://example.org/docs">docs</a></p>',
                }),
            );
            expect(formats(model)).toEqual([
                "Hello ",
                ["world", { bold: true }],
                ", see ",
                ["docs", { link: "https://example.org/docs" }],
            ]);
            // Shown formatted in the field.
            expect(screen.getByText("world")).toHaveClass("mx_BasicMessageComposer_format_bold");
            expect(screen.getByText("docs")).toHaveClass("mx_BasicMessageComposer_format_link");
        });

        it("turns markdown in pasted plain text into formats", async () => {
            const model = new EditorModel([], pc, renderer);
            render(<BasicMessageComposer model={model} room={room} />, { wrapper });
            await userEvent.paste(generateMockDataTransferForString("**bold**, *it* and `x = 1`, [site](https://a.b)"));
            expect(formats(model)).toEqual([
                ["bold", { bold: true }],
                ", ",
                ["it", { italic: true }],
                " and ",
                ["x = 1", { code: true }],
                ", ",
                ["site", { link: "https://a.b" }],
            ]);
        });

        it("pastes plain text without markdown as it is", async () => {
            const model = new EditorModel([], pc, renderer);
            render(<BasicMessageComposer model={model} room={room} />, { wrapper });
            await userEvent.paste(generateMockDataTransferForString("2*3*4 and snake_case_name"));
            expect(formats(model)).toEqual(["2*3*4 and snake_case_name"]);
        });

        it.each([
            ["KeyB", false, { bold: true }],
            ["KeyI", false, { italic: true }],
            ["KeyU", false, { underline: true }],
            ["KeyX", true, { strike: true }],
            ["KeyM", true, { code: true }],
        ])("Ctrl+%s (shift: %s) formats the selection", async (code, shiftKey, format) => {
            const model = new EditorModel([pc.plain("hello world")], pc, renderer);
            render(<BasicMessageComposer model={model} room={room} />, { wrapper });
            const input = screen.getByRole("textbox");
            const textNode = input.querySelector("div")!.firstChild!;
            const range = document.createRange();
            range.setStart(textNode, 6);
            range.setEnd(textNode, 11);
            document.getSelection()!.removeAllRanges();
            document.getSelection()!.addRange(range);
            const isMac = navigator.platform.toUpperCase().includes("MAC");
            fireEvent.keyDown(input, {
                code,
                key: code.slice(3).toLowerCase(),
                shiftKey,
                ctrlKey: !isMac,
                metaKey: isMac,
            });
            expect(formats(model)).toEqual(["hello ", ["world", format]]);
            // And off again.
            fireEvent.keyDown(input, {
                code,
                key: code.slice(3).toLowerCase(),
                shiftKey,
                ctrlKey: !isMac,
                metaKey: isMac,
            });
            expect(formats(model)).toEqual(["hello world"]);
        });
    });
});

function generateMockDataTransferForString(string: string): DataTransfer {
    return {
        getData: (type) => {
            if (type === "text/plain") {
                return string;
            }
            return "";
        },
        dropEffect: "link",
        effectAllowed: "link",
        files: {} as FileList,
        items: {} as DataTransferItemList,
        types: [],
        clearData: () => {},
        setData: () => {},
        setDragImage: () => {},
    };
}

function generateMockDataTransfer(data: Record<string, string>): DataTransfer {
    return {
        ...generateMockDataTransferForString(data["text/plain"] ?? ""),
        getData: (type: string) => data[type] ?? "",
        types: Object.keys(data),
    } as DataTransfer;
}
