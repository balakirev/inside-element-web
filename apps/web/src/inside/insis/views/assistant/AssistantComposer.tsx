/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useEffect, useImperativeHandle, useRef, useState, type JSX, type Ref } from "react";
import classNames from "classnames";

import { _t } from "../../../../languageHandler";
import { fileSize } from "../../../../utils/FileUtils";
import { sendToAssistant } from "../../assistant";
import { AssistantIcon } from "./icons";
import { useVoiceRecorder } from "./useVoiceRecorder";
import { formatVoiceDuration } from "./time";

export interface AssistantComposerHandle {
    /** Put a text into the field and focus it ("Изменить" of an artifact). */
    setText(text: string): void;
}

/** How long the recognised text stays in the field before it is sent by itself. */
export const VOICE_AUTOSEND_MS = 700;

/**
 * Inside: the composer of an assistant session — attach, "Спросите или продиктуйте…", and the round button: the mic
 * while the field is empty, "send" once there is text. The mic records (MediaRecorder); when it stops, the recognised
 * text appears in the field and is sent by itself, as the ✨ button of INSIS does (ADR-067 "нажал — сказал").
 * In the preview the recognised text is canned and the sound goes nowhere.
 */
export function AssistantComposer({
    sessionId,
    handleRef,
}: {
    sessionId: string;
    handleRef?: Ref<AssistantComposerHandle>;
}): JSX.Element {
    const [text, setText] = useState("");
    const [pendingVoice, setPendingVoice] = useState<number | null>(null);
    const [elapsedSec, setElapsedSec] = useState(0);
    const input = useRef<HTMLInputElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    useImperativeHandle(handleRef, () => ({
        setText(t: string) {
            setText(t);
            input.current?.focus();
        },
    }));

    const voice = useVoiceRecorder((sec) => {
        setText(_t("insis_assistant|voice_transcript"));
        setPendingVoice(sec);
    });

    // The recognised text is sent by itself shortly after it appears.
    useEffect(() => {
        if (pendingVoice === null) return;
        const t = setTimeout(() => {
            sendToAssistant(sessionId, _t("insis_assistant|voice_transcript"), { voiceDurationSec: pendingVoice });
            setPendingVoice(null);
            setText("");
        }, VOICE_AUTOSEND_MS);
        return () => clearTimeout(t);
    }, [pendingVoice, sessionId]);

    // The recording timer.
    const recording = voice.state.kind === "recording";
    const recordingSince = voice.state.kind === "recording" ? voice.state.startedAt : 0;
    useEffect(() => {
        if (!recordingSince) return;
        setElapsedSec(0);
        const t = setInterval(() => setElapsedSec((Date.now() - recordingSince) / 1000), 500);
        return () => clearInterval(t);
    }, [recordingSince]);

    const send = (): void => {
        if (!text.trim() || pendingVoice !== null) return;
        sendToAssistant(sessionId, text);
        setText("");
    };

    const hasText = text.trim().length > 0;
    const notice =
        voice.state.kind === "denied"
            ? _t("insis_assistant|mic_denied")
            : voice.state.kind === "unsupported"
              ? _t("insis_assistant|mic_unsupported")
              : null;

    let roundLabel: string;
    let roundIcon: JSX.Element;
    let onRound: () => void;
    if (recording) {
        roundLabel = _t("insis_assistant|mic_stop");
        roundIcon = <AssistantIcon name="stop" />;
        onRound = () => voice.stop();
    } else if (hasText) {
        roundLabel = _t("insis_assistant|send");
        roundIcon = <AssistantIcon name="send" />;
        onRound = send;
    } else {
        roundLabel = _t("insis_assistant|dictate");
        roundIcon = <AssistantIcon name="mic" />;
        onRound = () => void voice.start();
    }

    return (
        <div className="mx_InsisComposer">
            {notice && (
                <div className="mx_InsisComposer_notice" role="alert">
                    <AssistantIcon name="warn" />
                    <span>{notice}</span>
                    <button type="button" onClick={() => voice.dismiss()} aria-label={_t("action|close")}>
                        ×
                    </button>
                </div>
            )}
            <div className="mx_InsisComposer_row">
                <button
                    type="button"
                    className="mx_InsisComposer_round mx_InsisComposer_attach"
                    aria-label={_t("insis_assistant|attach")}
                    onClick={() => fileInput.current?.click()}
                >
                    <AssistantIcon name="clip" />
                </button>
                <input
                    ref={fileInput}
                    type="file"
                    hidden
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                            sendToAssistant(sessionId, text, { file: { name: file.name, size: fileSize(file.size) } });
                        setText("");
                        e.target.value = "";
                    }}
                />
                <label
                    className={classNames("mx_InsisComposer_field", { mx_InsisComposer_field_recording: recording })}
                >
                    {recording ? (
                        <span className="mx_InsisComposer_recording" aria-live="polite">
                            <i aria-hidden="true" />
                            {_t("insis_assistant|recording", { time: formatVoiceDuration(elapsedSec) })}
                        </span>
                    ) : (
                        <input
                            ref={input}
                            value={text}
                            placeholder={_t("insis_assistant|composer_placeholder")}
                            aria-label={_t("insis_assistant|composer_placeholder")}
                            autoComplete="off"
                            readOnly={pendingVoice !== null}
                            onChange={(e) => setText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                                    e.preventDefault();
                                    send();
                                }
                            }}
                        />
                    )}
                </label>
                <button
                    type="button"
                    className={classNames("mx_InsisComposer_round mx_InsisComposer_send", {
                        mx_InsisComposer_send_go: hasText || recording,
                    })}
                    aria-label={roundLabel}
                    disabled={voice.state.kind === "starting" || pendingVoice !== null}
                    onClick={onRound}
                >
                    {roundIcon}
                </button>
            </div>
        </div>
    );
}
