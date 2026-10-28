/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { act, fireEvent, render, screen } from "test-utils-rtl";

import InsideRecordButton, { type VoiceRecordingControls } from "./InsideRecordButton";
import { RoundVideoError, type RoundVideoRecorder, type RoundVideoResult } from "../../../utils/RoundVideoRecorder";
import { RECORD_HOLD_MS } from "../../../utils/recordGesture";
import Modal from "../../../Modal";

const result: RoundVideoResult = {
    blob: new Blob(["x"], { type: "video/mp4" }),
    mimeType: "video/mp4",
    durationMs: 5000,
    width: 384,
    height: 384,
};

function fakeRecorder(start: () => Promise<void> = () => Promise.resolve()): RoundVideoRecorder {
    return {
        canvas: document.createElement("canvas"),
        state: "recording",
        elapsedMs: 0,
        locked: false,
        onMaxDuration: null,
        on: () => () => {},
        start: vi.fn(start),
        stop: vi.fn().mockResolvedValue(result),
        cancel: vi.fn(),
        lock: vi.fn(),
    } as unknown as RoundVideoRecorder;
}

describe("InsideRecordButton", () => {
    let voice: { [K in keyof VoiceRecordingControls]: Mock<VoiceRecordingControls[K]> };
    let onRoundVideo: Mock<(result: RoundVideoResult) => void>;
    let onActiveChange: Mock<(active: boolean) => void>;
    let recorder: RoundVideoRecorder;

    beforeEach(() => {
        localStorage.removeItem("mx_inside_record_mode");
        vi.useFakeTimers();
        voice = {
            start: vi.fn().mockResolvedValue(true),
            send: vi.fn().mockResolvedValue(undefined),
            cancel: vi.fn().mockResolvedValue(undefined),
        };
        onRoundVideo = vi.fn();
        onActiveChange = vi.fn();
        recorder = fakeRecorder();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const renderButton = (): HTMLElement => {
        render(
            <InsideRecordButton
                voice={voice}
                onRoundVideo={onRoundVideo}
                onActiveChange={onActiveChange}
                createRecorder={() => recorder}
            />,
        );
        return screen.getByTestId("voicemessagebtn");
    };

    const press = (el: HTMLElement, x = 500, y = 500): void => {
        fireEvent.pointerDown(el, { button: 0, clientX: x, clientY: y, pointerId: 1 });
    };
    const hold = async (el: HTMLElement): Promise<void> => {
        press(el);
        await act(() => vi.advanceTimersByTimeAsync(RECORD_HOLD_MS + 10));
    };

    it("switches the mode on a short tap and keeps it on the device", async () => {
        const button = renderButton();
        expect(button).toHaveAttribute("data-mode", "voice");
        press(button);
        await act(() => vi.advanceTimersByTimeAsync(100));
        fireEvent.pointerUp(button, { pointerId: 1 });
        expect(button).toHaveAttribute("data-mode", "round");
        expect(button).toHaveClass("mx_InsideRecordButton_round");
        expect(localStorage.getItem("mx_inside_record_mode")).toBe("round");
        expect(voice.start).not.toHaveBeenCalled();
        expect(recorder.start).not.toHaveBeenCalled();
        // the hint says what a hold does now
        expect(screen.getByRole("status")).toHaveTextContent("Hold to record a video message");
    });

    it("records a voice message while held and sends it on release", async () => {
        const button = renderButton();
        await hold(button);
        expect(voice.start).toHaveBeenCalledTimes(1);
        expect(onActiveChange).toHaveBeenLastCalledWith(true);
        fireEvent.pointerUp(button, { pointerId: 1 });
        await act(() => vi.advanceTimersByTimeAsync(0));
        expect(voice.send).toHaveBeenCalledTimes(1);
        expect(onActiveChange).toHaveBeenLastCalledWith(false);
    });

    it("hands a voice message slid up over to Element's recording UI", async () => {
        const button = renderButton();
        await hold(button);
        fireEvent.pointerMove(button, { clientX: 500, clientY: 400, pointerId: 1 });
        fireEvent.pointerUp(button, { pointerId: 1 });
        await act(() => vi.advanceTimersByTimeAsync(0));
        expect(voice.send).not.toHaveBeenCalled();
        expect(voice.cancel).not.toHaveBeenCalled();
        expect(onActiveChange).toHaveBeenLastCalledWith(false);
    });

    it("cancels a voice message slid left", async () => {
        const button = renderButton();
        await hold(button);
        fireEvent.pointerMove(button, { clientX: 300, clientY: 500, pointerId: 1 });
        await act(() => vi.advanceTimersByTimeAsync(0));
        expect(voice.cancel).toHaveBeenCalledTimes(1);
        expect(voice.send).not.toHaveBeenCalled();
    });

    describe("in round video mode", () => {
        beforeEach(() => localStorage.setItem("mx_inside_record_mode", "round"));

        it("records while held, with the camera circle, and sends on release", async () => {
            const button = renderButton();
            expect(button).toHaveAttribute("data-mode", "round");
            await hold(button);
            expect(recorder.start).toHaveBeenCalledTimes(1);
            expect(voice.start).not.toHaveBeenCalled();
            expect(document.querySelector(".mx_InsideRoundRecorder")).not.toBeNull();
            expect(screen.getByRole("timer")).toHaveTextContent("0:00");

            fireEvent.pointerUp(button, { pointerId: 1 });
            await act(() => vi.advanceTimersByTimeAsync(0));
            expect(recorder.stop).toHaveBeenCalled();
            expect(onRoundVideo).toHaveBeenCalledWith(result);
            expect(document.querySelector(".mx_InsideRoundRecorder")).toBeNull();
        });

        it("locks when slid up; the button then sends", async () => {
            const button = renderButton();
            await hold(button);
            fireEvent.pointerMove(button, { clientX: 500, clientY: 420, pointerId: 1 });
            expect(recorder.lock).toHaveBeenCalled();
            fireEvent.pointerUp(button, { pointerId: 1 });
            await act(() => vi.advanceTimersByTimeAsync(0));
            expect(onRoundVideo).not.toHaveBeenCalled();
            expect(button).toHaveAccessibleName("Send video message");
            expect(document.querySelector(".mx_InsideRoundRecorder_locked")).not.toBeNull();

            fireEvent.click(button);
            await act(() => vi.advanceTimersByTimeAsync(0));
            expect(onRoundVideo).toHaveBeenCalledWith(result);
        });

        it("cancels on Escape", async () => {
            const button = renderButton();
            await hold(button);
            fireEvent.keyDown(window, { key: "Escape" });
            expect(recorder.cancel).toHaveBeenCalled();
            fireEvent.pointerUp(button, { pointerId: 1 });
            await act(() => vi.advanceTimersByTimeAsync(0));
            expect(onRoundVideo).not.toHaveBeenCalled();
        });

        it("sends by itself at 60 seconds", async () => {
            const button = renderButton();
            await hold(button);
            act(() => recorder.onMaxDuration!(Promise.resolve(result)));
            await act(() => vi.advanceTimersByTimeAsync(0));
            expect(onRoundVideo).toHaveBeenCalledWith(result);
            expect(document.querySelector(".mx_InsideRoundRecorder")).toBeNull();
        });

        it("says so when the camera is not allowed", async () => {
            const dialog = vi.spyOn(Modal, "createDialog").mockReturnValue({} as any);
            recorder = fakeRecorder(() => Promise.reject(new RoundVideoError("permission")));
            const button = renderButton();
            await hold(button);
            await act(() => vi.advanceTimersByTimeAsync(0));
            expect(dialog).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ title: "Unable to record a video message" }),
            );
            expect(document.querySelector(".mx_InsideRoundRecorder")).toBeNull();
        });
    });
});
