/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import classNames from "classnames";
import { logger } from "matrix-js-sdk/src/logger";
import {
    ChevronUpIcon,
    DeleteIcon,
    LockSolidIcon,
    MicOnSolidIcon,
    SendSolidIcon,
    VideoCallSolidIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t } from "../../../languageHandler";
import AccessibleButton, { type ButtonEvent } from "../elements/AccessibleButton";
import Modal from "../../../Modal";
import ErrorDialog from "../dialogs/ErrorDialog";
import { PlaybackManager } from "../../../audio/PlaybackManager";
import UIStore from "../../../stores/UIStore";
import { RecordGesture } from "../../../utils/recordGesture";
import {
    ROUND_VIDEO_MAX_MS,
    type RecordMode,
    formatRoundDuration,
    getRecordMode,
    setRecordMode,
} from "../../../utils/roundVideo";
import {
    RoundVideoError,
    type RoundVideoErrorCode,
    RoundVideoRecorder,
    type RoundVideoResult,
} from "../../../utils/RoundVideoRecorder";

/** Element's voice recording, driven by the hold gesture of the button. */
export interface VoiceRecordingControls {
    /** Start recording; resolves to whether it started. */
    start(): Promise<boolean>;
    /** Stop and send what was recorded (thrown away if too short). */
    send(): Promise<void>;
    /** Throw the recording away. */
    cancel(): Promise<void>;
}

interface Props {
    voice: VoiceRecordingControls;
    /** Send a finished round video. */
    onRoundVideo: (result: RoundVideoResult) => void;
    /** A recording is held or locked with this button (the composer keeps the button meanwhile). */
    onActiveChange?: (active: boolean) => void;
    /** For tests: makes the recorder. */
    createRecorder?: () => RoundVideoRecorder;
}

const ERROR_TEXT: Record<RoundVideoErrorCode, () => string> = {
    permission: () => _t("composer|round_video_error_permission"),
    no_camera: () => _t("composer|round_video_error_no_camera"),
    unsupported: () => _t("composer|round_video_error_unsupported"),
    failed: () => _t("composer|round_video_error_failed"),
};

function showRoundVideoError(code: RoundVideoErrorCode): void {
    Modal.createDialog(ErrorDialog, {
        title: _t("composer|round_video_error_title"),
        description: <p>{ERROR_TEXT[code]()}</p>,
    });
}

interface ActiveState {
    mode: RecordMode;
    locked: boolean;
    lockProgress: number;
    cancelProgress: number;
}

/**
 * Inside: the round button in place of "send" while the composer is empty, as in Telegram Desktop.
 * A short tap switches between voice and round video messages (the mic and camera icons swap, and
 * the mode is kept on the device); press and hold records in the current mode, releasing sends,
 * sliding up locks the recording, sliding left or Escape cancels. Enter or Space start a locked
 * recording. Voice recording itself is Element's {@link VoiceRecordComposerTile}.
 */
export default function InsideRecordButton({
    voice,
    onRoundVideo,
    onActiveChange,
    createRecorder,
}: Props): JSX.Element {
    const [mode, setMode] = useState<RecordMode>(getRecordMode);
    const [active, setActive] = useState<ActiveState | null>(null);
    const [hint, setHint] = useState(false);
    const [recorder, setRecorder] = useState<RoundVideoRecorder | null>(null);
    const buttonRef = useRef<HTMLDivElement>(null);
    const voiceStart = useRef<Promise<boolean> | null>(null);
    const recorderRef = useRef<RoundVideoRecorder | null>(null);
    const modeRef = useRef(mode);
    modeRef.current = mode;
    const activeRef = useRef(active);
    activeRef.current = active;

    const finish = useCallback((): void => {
        voiceStart.current = null;
        recorderRef.current = null;
        setRecorder(null);
        setActive(null);
        gestureRef.current?.reset();
    }, []);

    const sendRound = useCallback(
        async (rec: RoundVideoRecorder): Promise<void> => {
            const result = await rec.stop();
            if (result) onRoundVideo(result);
        },
        [onRoundVideo],
    );

    const handlers = useMemo(
        () => ({
            onTap: (): void => {
                const next: RecordMode = modeRef.current === "voice" ? "round" : "voice";
                setRecordMode(next);
                setMode(next);
                setHint(true);
            },
            onHoldStart: (): void => {
                const current = modeRef.current;
                setActive({ mode: current, locked: false, lockProgress: 0, cancelProgress: 0 });
                PlaybackManager.instance.pauseAllExcept();
                if (current === "voice") {
                    voiceStart.current = voice.start().then((started) => {
                        if (!started && voiceStart.current) finish();
                        return started;
                    });
                    return;
                }
                const rec = createRecorder?.() ?? new RoundVideoRecorder();
                recorderRef.current = rec;
                setRecorder(rec);
                rec.onMaxDuration = (result): void => {
                    // 60 s: stop and send, as Telegram does
                    finish();
                    void result.then((r) => r && onRoundVideo(r));
                };
                rec.start().catch((e) => {
                    if (recorderRef.current !== rec) return;
                    logger.warn("Unable to start a round video", e);
                    finish();
                    showRoundVideoError(e instanceof RoundVideoError ? e.code : "failed");
                });
            },
            onRelease: (): void => {
                const current = activeRef.current;
                const rec = recorderRef.current;
                const started = voiceStart.current;
                finish();
                if (current?.mode === "voice" && started) {
                    void started
                        .then((ok) => (ok ? voice.send() : undefined))
                        .catch((e) => logger.warn("Unable to send a voice message", e));
                } else if (rec) {
                    void sendRound(rec);
                }
            },
            onLock: (): void => {
                if (activeRef.current?.mode === "voice" || modeRef.current === "voice") {
                    // Element's recording UI (stop, delete, send) takes over, as it did before.
                    finish();
                    return;
                }
                recorderRef.current?.lock();
                setActive((a) => (a ? { ...a, locked: true, lockProgress: 1 } : a));
            },
            onCancel: (): void => {
                const current = activeRef.current;
                const rec = recorderRef.current;
                const started = voiceStart.current;
                finish();
                if (current?.mode === "voice" && started) {
                    void started
                        .then((ok) => (ok ? voice.cancel() : undefined))
                        .catch((e) => logger.warn("Unable to cancel a voice message", e));
                }
                rec?.cancel();
            },
            onDrag: (lockProgress: number, cancelProgress: number): void => {
                setActive((a) => (a && !a.locked ? { ...a, lockProgress, cancelProgress } : a));
            },
        }),
        [voice, createRecorder, finish, onRoundVideo, sendRound],
    );
    const gestureRef = useRef<RecordGesture | null>(null);
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;
    gestureRef.current ??= new RecordGesture({
        onTap: () => handlersRef.current.onTap(),
        onHoldStart: () => handlersRef.current.onHoldStart(),
        onRelease: () => handlersRef.current.onRelease(),
        onLock: () => handlersRef.current.onLock(),
        onCancel: () => handlersRef.current.onCancel(),
        onDrag: (l, c) => handlersRef.current.onDrag(l, c),
    });
    const gesture = gestureRef.current;

    useEffect(() => {
        onActiveChange?.(!!active);
    }, [active, onActiveChange]);

    // The hint after a tap ("hold to record…") goes after a moment.
    useEffect(() => {
        if (!hint) return;
        const id = window.setTimeout(() => setHint(false), 2000);
        return () => window.clearTimeout(id);
    }, [hint, mode]);

    // Escape cancels, as sliding left does.
    useEffect(() => {
        if (!active) return;
        const onKey = (ev: KeyboardEvent): void => {
            if (ev.key !== "Escape") return;
            ev.preventDefault();
            ev.stopPropagation();
            gesture.cancel();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [active, gesture]);

    // Leaving the room or the thread throws a round video away.
    useEffect(
        () => () => {
            recorderRef.current?.cancel();
            gestureRef.current?.reset();
        },
        [],
    );

    const onPointerDown = (ev: React.PointerEvent): void => {
        if (ev.button !== 0 || activeRef.current?.locked) return;
        ev.preventDefault();
        try {
            (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
        } catch {
            // jsdom and old browsers
        }
        setHint(false);
        gesture.down(ev.clientX, ev.clientY);
    };
    const onPointerMove = (ev: React.PointerEvent): void => gesture.move(ev.clientX, ev.clientY);
    const onPointerUp = (): void => gesture.up();
    const onPointerCancel = (): void => gesture.cancel();

    const onClick = (ev: ButtonEvent): void => {
        if (activeRef.current?.locked && recorderRef.current) {
            // Locked round video: the button sends it.
            const rec = recorderRef.current;
            finish();
            void sendRound(rec);
            return;
        }
        // Pointer clicks are handled by the gesture; Enter and Space start a locked recording.
        if (ev.type === "click") return;
        gesture.startLocked();
    };

    const onCancelClick = (): void => gesture.cancel();

    const roundLocked = !!active?.locked && active.mode === "round";
    const title = roundLocked
        ? _t("composer|round_video_send")
        : mode === "round"
          ? _t("composer|record_button_round")
          : _t("composer|record_button_voice");

    const button = (
        <AccessibleButton
            ref={buttonRef}
            className={classNames("mx_MessageComposer_sendMessage", "mx_InsideRecordButton", {
                // The skin draws the mic over this class; while a round video is locked the button sends.
                mx_MessageComposer_voiceMessage: !roundLocked,
                mx_InsideRecordButton_round: mode === "round",
                mx_InsideRecordButton_active: !!active,
            })}
            onClick={onClick}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onContextMenu={(ev: React.MouseEvent) => ev.preventDefault()}
            title={title}
            disableTooltip={!!active}
            data-testid="voicemessagebtn"
            data-mode={mode}
        >
            {roundLocked ? (
                <SendSolidIcon />
            ) : (
                <>
                    <span className="mx_InsideRecordButton_icon mx_InsideRecordButton_mic" aria-hidden>
                        <MicOnSolidIcon />
                    </span>
                    <span className="mx_InsideRecordButton_icon mx_InsideRecordButton_camera" aria-hidden>
                        <VideoCallSolidIcon />
                    </span>
                </>
            )}
        </AccessibleButton>
    );

    return (
        <>
            {button}
            {(active || hint) &&
                createPortal(
                    <RecordOverlay
                        anchor={buttonRef.current}
                        active={active}
                        hint={hint ? title : null}
                        recorder={recorder}
                        onCancel={onCancelClick}
                    />,
                    document.body,
                )}
        </>
    );
}

const RING_R = 48;
const RING_C = 2 * Math.PI * RING_R;

interface OverlayProps {
    anchor: HTMLElement | null;
    active: ActiveState | null;
    hint: string | null;
    recorder: RoundVideoRecorder | null;
    onCancel: () => void;
}

/** The lock pill above the button, the hint, and for round videos the circular camera preview. */
function RecordOverlay({ anchor, active, hint, recorder, onCancel }: OverlayProps): JSX.Element {
    const rect = anchor?.getBoundingClientRect();
    const composer = anchor?.closest(".mx_MessageComposer")?.getBoundingClientRect() ?? rect;
    const anchorX = rect ? rect.left + rect.width / 2 : UIStore.instance.windowWidth - 40;
    const anchorTop = rect ? rect.top : UIStore.instance.windowHeight - 80;

    return (
        <div className="mx_InsideRecordOverlay">
            {hint && !active && (
                <div
                    className="mx_InsideRecordOverlay_hint"
                    style={{ left: anchorX, bottom: UIStore.instance.windowHeight - anchorTop + 10 }}
                    role="status"
                >
                    {hint}
                </div>
            )}
            {active && !active.locked && (
                <div
                    className="mx_InsideRecordOverlay_lock"
                    style={{
                        left: anchorX,
                        bottom: UIStore.instance.windowHeight - anchorTop + 12 + active.lockProgress * 24,
                        opacity: 1 - active.cancelProgress * 0.6,
                    }}
                    aria-hidden
                >
                    <LockSolidIcon />
                    <ChevronUpIcon />
                </div>
            )}
            {active?.mode === "round" && recorder && (
                <RoundVideoPreview
                    recorder={recorder}
                    locked={active.locked}
                    cancelProgress={active.cancelProgress}
                    centerX={composer ? composer.left + composer.width / 2 : UIStore.instance.windowWidth / 2}
                    bottom={UIStore.instance.windowHeight - (composer?.top ?? anchorTop) + 16}
                    onCancel={onCancel}
                />
            )}
        </div>
    );
}

interface PreviewProps {
    recorder: RoundVideoRecorder;
    locked: boolean;
    cancelProgress: number;
    centerX: number;
    bottom: number;
    onCancel: () => void;
}

/** The live camera circle with the 60 s progress ring on its edge and the timer under it. */
export function RoundVideoPreview({
    recorder,
    locked,
    cancelProgress,
    centerX,
    bottom,
    onCancel,
}: PreviewProps): JSX.Element {
    const holder = useRef<HTMLDivElement>(null);
    const [elapsed, setElapsed] = useState(0);
    const [state, setState] = useState(recorder.state);

    useEffect(() => {
        const node = holder.current;
        if (!node) return;
        recorder.canvas.classList.add("mx_InsideRoundRecorder_canvas");
        node.appendChild(recorder.canvas);
        return () => {
            recorder.canvas.remove();
        };
    }, [recorder]);

    useEffect(() => recorder.on(() => setState(recorder.state)), [recorder]);

    useEffect(() => {
        let frame = 0;
        const tick = (): void => {
            setElapsed(recorder.elapsedMs);
            frame = window.requestAnimationFrame(tick);
        };
        frame = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frame);
    }, [recorder]);

    const progress = Math.min(1, elapsed / ROUND_VIDEO_MAX_MS);
    return (
        <div
            className={classNames("mx_InsideRoundRecorder", { mx_InsideRoundRecorder_locked: locked })}
            style={{ left: centerX, bottom, opacity: 1 - cancelProgress * 0.7 }}
            role="dialog"
            aria-label={_t("composer|round_video_recording")}
        >
            <div className="mx_InsideRoundRecorder_circle">
                <div
                    ref={holder}
                    className={classNames("mx_InsideRoundRecorder_video", {
                        mx_InsideRoundRecorder_video_ready: state === "recording",
                    })}
                />
                <svg className="mx_InsideRoundRecorder_ring" viewBox="0 0 100 100" aria-hidden>
                    <circle
                        cx="50"
                        cy="50"
                        r={RING_R}
                        strokeDasharray={RING_C}
                        strokeDashoffset={RING_C * (1 - progress)}
                    />
                </svg>
            </div>
            <div className="mx_InsideRoundRecorder_bar">
                <span className="mx_InsideRoundRecorder_dot" aria-hidden />
                <span className="mx_InsideRoundRecorder_time" role="timer">
                    {formatRoundDuration(elapsed)}
                </span>
                {locked ? (
                    <AccessibleButton
                        className="mx_InsideRoundRecorder_cancel"
                        onClick={onCancel}
                        title={_t("action|delete")}
                    >
                        <DeleteIcon />
                    </AccessibleButton>
                ) : (
                    <span className="mx_InsideRoundRecorder_hint">{_t("composer|record_slide_cancel")}</span>
                )}
            </div>
        </div>
    );
}
