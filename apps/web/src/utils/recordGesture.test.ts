/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { RECORD_CANCEL_PX, RECORD_HOLD_MS, RECORD_LOCK_PX, RecordGesture } from "./recordGesture";

describe("RecordGesture", () => {
    let handlers: {
        onTap: Mock<() => void>;
        onHoldStart: Mock<() => void>;
        onRelease: Mock<() => void>;
        onLock: Mock<() => void>;
        onCancel: Mock<() => void>;
        onDrag: Mock<(lock: number, cancel: number) => void>;
    };
    let gesture: RecordGesture;

    beforeEach(() => {
        vi.useFakeTimers();
        handlers = {
            onTap: vi.fn(),
            onHoldStart: vi.fn(),
            onRelease: vi.fn(),
            onLock: vi.fn(),
            onCancel: vi.fn(),
            onDrag: vi.fn(),
        };
        gesture = new RecordGesture(handlers);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("treats a short press as a tap and records nothing", () => {
        gesture.down(100, 100);
        vi.advanceTimersByTime(RECORD_HOLD_MS - 50);
        gesture.up();
        vi.advanceTimersByTime(1000);
        expect(handlers.onTap).toHaveBeenCalledTimes(1);
        expect(handlers.onHoldStart).not.toHaveBeenCalled();
        expect(gesture.phase).toBe("idle");
    });

    it("starts recording on a hold and sends on release", () => {
        gesture.down(100, 100);
        vi.advanceTimersByTime(RECORD_HOLD_MS);
        expect(handlers.onHoldStart).toHaveBeenCalledTimes(1);
        expect(gesture.phase).toBe("holding");
        gesture.up();
        expect(handlers.onRelease).toHaveBeenCalledTimes(1);
        expect(handlers.onTap).not.toHaveBeenCalled();
        expect(gesture.phase).toBe("idle");
    });

    it("locks when slid up, and a release then does not send", () => {
        gesture.down(100, 100);
        vi.advanceTimersByTime(RECORD_HOLD_MS);
        gesture.move(100, 100 - RECORD_LOCK_PX / 2);
        expect(handlers.onDrag).toHaveBeenLastCalledWith(0.5, 0);
        expect(handlers.onLock).not.toHaveBeenCalled();
        gesture.move(100, 100 - RECORD_LOCK_PX);
        expect(handlers.onLock).toHaveBeenCalledTimes(1);
        expect(gesture.phase).toBe("locked");
        gesture.up();
        expect(handlers.onRelease).not.toHaveBeenCalled();
        expect(gesture.phase).toBe("locked");
    });

    it("cancels when slid left", () => {
        gesture.down(300, 100);
        vi.advanceTimersByTime(RECORD_HOLD_MS);
        gesture.move(300 - RECORD_CANCEL_PX, 100);
        expect(handlers.onCancel).toHaveBeenCalledTimes(1);
        gesture.up();
        expect(handlers.onRelease).not.toHaveBeenCalled();
    });

    it("ignores moves before the hold starts", () => {
        gesture.down(300, 300);
        gesture.move(0, 0);
        expect(handlers.onCancel).not.toHaveBeenCalled();
        expect(handlers.onLock).not.toHaveBeenCalled();
    });

    it("cancels a held or locked recording when the pointer is taken away (or Escape)", () => {
        gesture.down(100, 100);
        vi.advanceTimersByTime(RECORD_HOLD_MS);
        gesture.cancel();
        expect(handlers.onCancel).toHaveBeenCalledTimes(1);

        gesture.startLocked();
        gesture.cancel();
        expect(handlers.onCancel).toHaveBeenCalledTimes(2);
    });

    it("does nothing on cancel during a press that is not yet a hold", () => {
        gesture.down(100, 100);
        gesture.cancel();
        vi.advanceTimersByTime(1000);
        expect(handlers.onCancel).not.toHaveBeenCalled();
        expect(handlers.onHoldStart).not.toHaveBeenCalled();
        expect(handlers.onTap).not.toHaveBeenCalled();
    });

    it("starts a locked recording from the keyboard", () => {
        gesture.startLocked();
        expect(handlers.onHoldStart).toHaveBeenCalledTimes(1);
        expect(handlers.onLock).toHaveBeenCalledTimes(1);
        expect(gesture.phase).toBe("locked");
    });
});
