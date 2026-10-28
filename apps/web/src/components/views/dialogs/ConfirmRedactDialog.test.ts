/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { type MatrixClient, MatrixEvent } from "matrix-js-sdk/src/matrix";
import { screen, act } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import { flushPromises, mkEvent, stubClient } from "test-utils";
import { createRedactEventDialog } from "./ConfirmRedactDialog";
import Modal from "../../../Modal";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import * as DustEffect from "../../../utils/DustEffect";

describe("ConfirmRedactDialog", () => {
    const roomId = "!room:example.com";
    let client: MatrixClient;
    let mxEvent: MatrixEvent;

    const confirmDeleteVoiceBroadcastStartedEvent = async () => {
        act(() => createRedactEventDialog({ mxEvent }));
        // double-flush promises required for the dialog to show up
        await flushPromises();
        await flushPromises();

        await userEvent.click(await screen.findByTestId("dialog-primary-button"));
    };

    beforeEach(() => {
        client = stubClient();
    });

    it("should raise an error for an event without ID", async () => {
        mxEvent = mkEvent({
            event: true,
            type: "m.room.message",
            room: roomId,
            content: {},
            user: client.getSafeUserId(),
        });
        vi.spyOn(mxEvent, "getId").mockReturnValue(undefined);
        await expect(confirmDeleteVoiceBroadcastStartedEvent()).rejects.toThrow("cannot redact event without ID");
    });

    it("should raise an error for an event without room-ID", async () => {
        mxEvent = mkEvent({
            event: true,
            type: "m.room.message",
            room: roomId,
            content: {},
            user: client.getSafeUserId(),
        });
        vi.spyOn(mxEvent, "getRoomId").mockReturnValue(undefined);
        await expect(confirmDeleteVoiceBroadcastStartedEvent()).rejects.toThrow(
            `cannot redact event ${mxEvent.getId()} without room ID`,
        );
    });
});

// Inside: the deleted message turns to dust.
describe("createRedactEventDialog dust effect", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    const event = new MatrixEvent({
        type: "m.room.message",
        event_id: "$event",
        room_id: "!room:example.org",
        sender: "@me:example.org",
        content: { msgtype: "m.text", body: "hi" },
    });

    function setup(proceed: boolean): {
        order: string[];
        redactEvent: ReturnType<typeof vi.fn>;
        dust: ReturnType<typeof vi.spyOn>;
    } {
        const order: string[] = [];
        vi.spyOn(Modal, "createDialog").mockReturnValue({
            finished: Promise.resolve([proceed, undefined]),
            close: vi.fn(),
        } as any);
        const redactEvent = vi.fn().mockImplementation(async () => {
            order.push("redact");
            return {};
        });
        vi.spyOn(MatrixClientPeg, "safeGet").mockReturnValue({ redactEvent } as any);
        const dust = vi.spyOn(DustEffect, "playDustEffect").mockImplementation(() => {
            order.push("dust");
            return true;
        });
        return { order, redactEvent, dust };
    }

    it("turns the message to dust and redacts it without waiting for the effect", async () => {
        const { order, redactEvent, dust } = setup(true);

        createRedactEventDialog({ mxEvent: event });
        await vi.waitFor(() => expect(redactEvent).toHaveBeenCalled());

        expect(dust).toHaveBeenCalledWith("$event");
        expect(redactEvent).toHaveBeenCalledWith("!room:example.org", "$event", undefined, {});
        expect(order).toEqual(["dust", "redact"]);
    });

    it("plays nothing when the user cancels", async () => {
        const { redactEvent, dust } = setup(false);

        createRedactEventDialog({ mxEvent: event });
        await flushPromises();

        expect(dust).not.toHaveBeenCalled();
        expect(redactEvent).not.toHaveBeenCalled();
    });
});
