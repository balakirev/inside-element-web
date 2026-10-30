/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceRecorderState =
    | { kind: "idle" }
    | { kind: "starting" }
    | { kind: "recording"; startedAt: number }
    /** No microphone, or the browser refused it. */
    | { kind: "denied" }
    | { kind: "unsupported" };

/**
 * Inside: "нажал — сказал" (ADR-067) of the assistant's composer — a tap starts recording through MediaRecorder
 * (the browser asks for the microphone), a second tap stops it and hands back how long it was. The sound itself is
 * dropped here: in the preview nothing is uploaded; with INSIS it goes to the copilot's voice endpoint (Whisper,
 * deleted within 24 h) and comes back as text.
 */
export function useVoiceRecorder(onRecorded: (durationSec: number) => void): {
    state: VoiceRecorderState;
    start(): Promise<void>;
    stop(): void;
    dismiss(): void;
} {
    const [state, setState] = useState<VoiceRecorderState>({ kind: "idle" });
    const recorder = useRef<MediaRecorder | null>(null);
    const stream = useRef<MediaStream | null>(null);
    const startedAt = useRef(0);
    const onRecordedRef = useRef(onRecorded);
    onRecordedRef.current = onRecorded;

    const release = (): void => {
        stream.current?.getTracks().forEach((t) => t.stop());
        stream.current = null;
        recorder.current = null;
    };

    useEffect(() => release, []);

    const start = useCallback(async (): Promise<void> => {
        if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
            setState({ kind: "unsupported" });
            return;
        }
        setState({ kind: "starting" });
        try {
            stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
            release();
            setState({ kind: "denied" });
            return;
        }
        const rec = new MediaRecorder(stream.current);
        recorder.current = rec;
        rec.onstop = (): void => {
            const sec = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
            release();
            setState({ kind: "idle" });
            onRecordedRef.current(sec);
        };
        startedAt.current = Date.now();
        rec.start();
        setState({ kind: "recording", startedAt: startedAt.current });
    }, []);

    const stop = useCallback((): void => {
        if (recorder.current?.state === "recording") recorder.current.stop();
        else {
            release();
            setState({ kind: "idle" });
        }
    }, []);

    const dismiss = useCallback((): void => setState({ kind: "idle" }), []);

    return { state, start, stop, dismiss };
}
