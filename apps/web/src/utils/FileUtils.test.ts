/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MediaEventContent } from "matrix-js-sdk/src/types";
import { afterEach, describe, it, expect } from "vitest";

import { downloadLabelForFile, fileSize } from "./FileUtils.ts";
import { setLocale } from "@element-hq/web-shared-components";

describe("FileUtils", () => {
    describe("downloadLabelForFile", () => {
        it.each([
            [
                "File with size",
                {
                    input: {
                        msgtype: "m.file",
                        body: "Test",
                        info: {
                            size: 102434566,
                        },
                    } as MediaEventContent,
                    output: "Download (97.7 MB)",
                },
            ],
            [
                "Image",
                {
                    input: {
                        msgtype: "m.image",
                        body: "Test",
                    } as MediaEventContent,
                    output: "Download",
                },
            ],
            [
                "Video",
                {
                    input: {
                        msgtype: "m.video",
                        body: "Test",
                    } as MediaEventContent,
                    output: "Download",
                },
            ],
            [
                "Audio",
                {
                    input: {
                        msgtype: "m.audio",
                        body: "Test",
                    } as MediaEventContent,
                    output: "Download",
                },
            ],
        ])("should correctly label %s", (_d, { input, output }) => expect(downloadLabelForFile(input)).toBe(output));
    });

    describe("fileSize", () => {
        afterEach(() => {
            setLocale("en");
        });

        it.each([
            [0, "0 bytes"],
            [1, "1 byte"],
            [861, "861 bytes"],
            [1024, "1 kB"],
            [9049210, "8.6 MB"],
            [1048570, "1 MB"],
            [1288490189, "1.2 GB"],
        ])("formats %d bytes in English as %s", (bytes, expected) => {
            expect(fileSize(bytes)).toBe(expected);
        });

        it.each([
            [861, "861 Б"],
            [9049210, "8,6 МБ"],
            [1288490189, "1,2 ГБ"],
        ])("formats %d bytes in Russian as %s", (bytes, expected) => {
            setLocale("ru");
            expect(fileSize(bytes)).toBe(expected);
        });

        it("still returns other outputs of filesize", () => {
            expect(fileSize(2048, { output: "object" })).toEqual(expect.objectContaining({ value: 2, exponent: 1 }));
        });
    });
});
