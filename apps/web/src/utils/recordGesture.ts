/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Inside: the gesture of the record button, as in Telegram Desktop. A short tap switches between
 * voice and round video; press and hold records; releasing sends; sliding up locks the recording
 * (hands-free, then stop or send); sliding left (or Escape) cancels.
 */

/** A press shorter than this is a tap (Telegram Desktop waits 120 ms plus 0.2 s of samples). */
export const RECORD_HOLD_MS = 250;
/** Upward travel that locks the recording. */
export const RECORD_LOCK_PX = 60;
/** Leftward travel that cancels it. */
export const RECORD_CANCEL_PX = 110;

export type RecordGesturePhase = "idle" | "pressed" | "holding" | "locked";

export interface RecordGestureHandlers {
    /** A short tap: switch the mode. */
    onTap(): void;
    /** The press became a hold: start recording. */
    onHoldStart(): void;
    /** Released while holding: stop and send. */
    onRelease(): void;
    /** Slid up: keep recording without holding. */
    onLock(): void;
    /** Slid left, or the pointer was taken away: throw the recording away. */
    onCancel(): void;
    /** Progress of the slides, 0..1, for the hints. */
    onDrag?(lockProgress: number, cancelProgress: number): void;
}

export interface RecordGestureClock {
    setTimeout(fn: () => void, ms: number): number;
    clearTimeout(id: number): void;
}

const windowClock: RecordGestureClock = {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
};

export class RecordGesture {
    private phaseValue: RecordGesturePhase = "idle";
    private timer: number | null = null;
    private startX = 0;
    private startY = 0;

    public constructor(
        private readonly handlers: RecordGestureHandlers,
        private readonly clock: RecordGestureClock = windowClock,
    ) {}

    public get phase(): RecordGesturePhase {
        return this.phaseValue;
    }

    /** Pointer went down on the button. */
    public down(x: number, y: number): void {
        if (this.phaseValue !== "idle") return;
        this.phaseValue = "pressed";
        this.startX = x;
        this.startY = y;
        this.timer = this.clock.setTimeout(() => {
            this.timer = null;
            if (this.phaseValue !== "pressed") return;
            this.phaseValue = "holding";
            this.handlers.onHoldStart();
        }, RECORD_HOLD_MS);
    }

    /** Pointer moved while down. */
    public move(x: number, y: number): void {
        if (this.phaseValue !== "holding") return;
        const up = Math.max(0, this.startY - y);
        const left = Math.max(0, this.startX - x);
        const lockProgress = Math.min(1, up / RECORD_LOCK_PX);
        const cancelProgress = Math.min(1, left / RECORD_CANCEL_PX);
        this.handlers.onDrag?.(lockProgress, cancelProgress);
        if (cancelProgress >= 1) {
            this.phaseValue = "idle";
            this.handlers.onCancel();
        } else if (lockProgress >= 1) {
            this.phaseValue = "locked";
            this.handlers.onLock();
        }
    }

    /** Pointer went up. */
    public up(): void {
        const phase = this.phaseValue;
        this.clearTimer();
        if (phase === "pressed") {
            this.phaseValue = "idle";
            this.handlers.onTap();
        } else if (phase === "holding") {
            this.phaseValue = "idle";
            this.handlers.onRelease();
        }
        // locked: the pointer is free, the recording goes on until stop or cancel
    }

    /** The browser took the pointer away (scroll, system gesture), or Escape. */
    public cancel(): void {
        const phase = this.phaseValue;
        this.clearTimer();
        this.phaseValue = "idle";
        if (phase === "holding" || phase === "locked") this.handlers.onCancel();
    }

    /** Start recording right away in the locked state (keyboard: Enter or Space on the button). */
    public startLocked(): void {
        if (this.phaseValue !== "idle") return;
        this.phaseValue = "locked";
        this.handlers.onHoldStart();
        this.handlers.onLock();
    }

    /** The recording is over (sent, cancelled elsewhere, or failed to start). */
    public reset(): void {
        this.clearTimer();
        this.phaseValue = "idle";
    }

    private clearTimer(): void {
        if (this.timer !== null) {
            this.clock.clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
