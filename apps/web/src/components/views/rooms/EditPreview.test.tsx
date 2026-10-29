/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "test-utils-rtl";
import { mkEvent, stubClient } from "test-utils";

import EditPreview from "./EditPreview";

describe("<EditPreview />", () => {
    beforeEach(() => {
        stubClient();
    });

    const event = (content: Record<string, unknown>) =>
        mkEvent({ type: "m.room.message", user: "@alice:server", room: "!room:server", content, event: true });

    it("shows the text of a text message without a picture", () => {
        const { container } = render(
            <EditPreview mxEvent={event({ msgtype: "m.text", body: "Hi" })} onCancel={vi.fn()} />,
        );
        expect(container.querySelector(".mx_EditPreview_text")).toHaveTextContent("Hi");
        expect(container.querySelector(".mx_EditPreview_thumbnail")).toBeNull();
    });

    it("shows the thumbnail and caption of a photo", () => {
        const { container } = render(
            <EditPreview
                mxEvent={event({ msgtype: "m.image", body: "Look", filename: "a.jpg", url: "mxc://server/a" })}
                onCancel={vi.fn()}
            />,
        );
        expect(container.querySelector(".mx_EditPreview_text")).toHaveTextContent("Look");
        expect(container.querySelector("img.mx_EditPreview_thumbnail")).not.toBeNull();
    });

    it("shows a file icon and the file name for a file without a caption", () => {
        const { container } = render(
            <EditPreview
                mxEvent={event({ msgtype: "m.file", body: "doc.pdf", url: "mxc://server/d" })}
                onCancel={vi.fn()}
            />,
        );
        expect(container.querySelector(".mx_EditPreview_text")).toHaveTextContent("doc.pdf");
        expect(container.querySelector(".mx_EditPreview_thumbnail_icon")).not.toBeNull();
    });
});
