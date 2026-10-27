/*
Copyright 2025 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { fireEvent, render, waitFor } from "test-utils-rtl";
import { secureRandomString } from "matrix-js-sdk/src/randomstring";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import UploadConfirmDialog from "./UploadConfirmDialog.tsx";

/**
 * The shared media preview tile hides the image until it has loaded it once out of band, which jsdom
 * never does: it fires neither `load` nor `error` for a real element. Stub the loader so the preview
 * settles into its loaded state.
 */
class MockImage {
    public onload: (() => void) | null = null;
    public onerror: ((error: unknown) => void) | null = null;
    public naturalWidth = 320;
    public naturalHeight = 240;
    private internalSrc = "";

    public get src(): string {
        return this.internalSrc;
    }

    public set src(value: string) {
        this.internalSrc = value;
        setTimeout(() => this.onload?.(), 0);
    }
}

/**
 * The video and audio tiles probe their source the same way, through a detached element that
 * happy-dom never loads either. Resolve the probe as soon as a source is set.
 */
function mockMediaElement(element: HTMLElement): void {
    Object.defineProperties(element, {
        videoWidth: { configurable: true, value: 320 },
        videoHeight: { configurable: true, value: 240 },
        src: {
            configurable: true,
            get: () => element.getAttribute("src") ?? "",
            set: (value: string) => {
                element.setAttribute("src", value);
                setTimeout(() => (element as HTMLMediaElement).onloadedmetadata?.(new Event("loadedmetadata")), 0);
            },
        },
    });
}

describe("<UploadConfirmDialog />", () => {
    const originalImage = window.Image;
    const createElement = document.createElement.bind(document);

    beforeEach(() => {
        window.Image = MockImage as unknown as typeof window.Image;
        vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
            const element = createElement(tagName, options);
            if (tagName === "video" || tagName === "audio") mockMediaElement(element);
            return element;
        }) as typeof document.createElement);
    });

    afterEach(() => {
        window.Image = originalImage;
        vi.mocked(document.createElement).mockRestore();
    });

    it("should display image preview", async () => {
        const url = "blob:null/1234-5678-9101-1121";
        vi.spyOn(URL, "createObjectURL").mockReturnValue(url);

        const file = new File([secureRandomString(1024 * 124)], "image.png", { type: "image/png" });
        const { asFragment, getByRole } = render(
            <UploadConfirmDialog file={file} currentIndex={0} totalFiles={1} onFinished={vi.fn()} />,
        );

        // The preview labels the image with the file name.
        await waitFor(() => expect(getByRole("img", { name: "image.png" })).toHaveAttribute("src", url));
        expect(asFragment()).toMatchSnapshot();
    });
    it.each([
        ["video", "video/mp4", "clip.mp4"],
        ["audio", "audio/ogg", "voice.ogg"],
    ])("should display %s preview", async (tag, type, name) => {
        const url = "blob:null/1234-5678-9101-1121";
        vi.spyOn(URL, "createObjectURL").mockReturnValue(url);

        const file = new File([secureRandomString(1024 * 124)], name, { type });
        const { container } = render(
            <UploadConfirmDialog file={file} currentIndex={0} totalFiles={1} onFinished={vi.fn()} />,
        );

        await waitFor(() => expect(container.querySelector(tag)).toHaveAttribute("src", url));
    });

    it("should display a file with no media preview", () => {
        const file = new File(["hello"], "notes.txt", { type: "text/plain" });
        const { container, getByText } = render(
            <UploadConfirmDialog file={file} currentIndex={0} totalFiles={1} onFinished={vi.fn()} />,
        );

        expect(getByText("notes.txt")).toBeInTheDocument();
        expect(container.querySelector("img, video, audio")).toBeNull();
    });

    describe("caption", () => {
        const file = new File(["hello"], "notes.txt", { type: "text/plain" });

        it("sends the typed caption on Enter", () => {
            const onFinished = vi.fn();
            const { getByRole } = render(<UploadConfirmDialog file={file} onFinished={onFinished} />);
            const caption = getByRole("textbox", { name: "Caption" });

            fireEvent.change(caption, { target: { value: "  Signed contract  " } });
            fireEvent.keyDown(caption, { key: "Enter" });

            expect(onFinished).toHaveBeenCalledWith(true, false, "Signed contract");
        });

        it("does not send on Shift+Enter", () => {
            const onFinished = vi.fn();
            const { getByRole } = render(<UploadConfirmDialog file={file} onFinished={onFinished} />);
            const caption = getByRole("textbox", { name: "Caption" });

            fireEvent.change(caption, { target: { value: "first line" } });
            fireEvent.keyDown(caption, { key: "Enter", shiftKey: true });

            expect(onFinished).not.toHaveBeenCalled();
        });

        it("sends without a caption when the field is left empty", () => {
            const onFinished = vi.fn();
            const { getByRole } = render(<UploadConfirmDialog file={file} onFinished={onFinished} />);

            fireEvent.click(getByRole("button", { name: "Upload" }));

            expect(onFinished).toHaveBeenCalledWith(true, false, undefined);
        });

        it("closes straight away when there is no caption to lose", () => {
            const onFinished = vi.fn();
            const { getByRole, queryByRole } = render(<UploadConfirmDialog file={file} onFinished={onFinished} />);

            fireEvent.click(getByRole("button", { name: "Close dialog" }));

            expect(onFinished).toHaveBeenCalledWith(false);
            expect(queryByRole("alertdialog")).toBeNull();
        });

        it("keeps the typed caption when the user chooses to keep editing", () => {
            const onFinished = vi.fn();
            const { getByRole, queryByRole } = render(<UploadConfirmDialog file={file} onFinished={onFinished} />);
            const caption = getByRole("textbox", { name: "Caption" });

            fireEvent.change(caption, { target: { value: "draft" } });
            fireEvent.click(getByRole("button", { name: "Close dialog" }));
            expect(getByRole("alertdialog", { name: "Discard caption?" })).toBeInTheDocument();

            fireEvent.click(getByRole("button", { name: "Keep editing" }));

            expect(queryByRole("alertdialog")).toBeNull();
            expect(caption).toHaveValue("draft");
            expect(onFinished).not.toHaveBeenCalled();

            // And the kept caption is still sent.
            fireEvent.keyDown(caption, { key: "Enter" });
            expect(onFinished).toHaveBeenCalledWith(true, false, "draft");
        });

        it("focuses keep editing and ignores Enter in the caption while asking", () => {
            const onFinished = vi.fn();
            const { getByRole } = render(<UploadConfirmDialog file={file} onFinished={onFinished} />);
            const caption = getByRole("textbox", { name: "Caption" });

            fireEvent.change(caption, { target: { value: "draft" } });
            fireEvent.click(getByRole("button", { name: "Close dialog" }));

            expect(getByRole("button", { name: "Keep editing" })).toHaveFocus();
            fireEvent.keyDown(caption, { key: "Enter" });
            expect(onFinished).not.toHaveBeenCalled();
        });

        it("closes the dialog when the user discards the caption", () => {
            const onFinished = vi.fn();
            const { getByRole } = render(<UploadConfirmDialog file={file} onFinished={onFinished} />);

            fireEvent.change(getByRole("textbox", { name: "Caption" }), { target: { value: "draft" } });
            fireEvent.click(getByRole("button", { name: "Close dialog" }));
            fireEvent.click(getByRole("button", { name: "Discard" }));

            expect(onFinished).toHaveBeenCalledWith(false);
        });
    });
});
