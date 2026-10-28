/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useContext, useEffect, useRef, useState } from "react";
import classNames from "classnames";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { type MediaEventContent } from "matrix-js-sdk/src/types";
import { logger } from "matrix-js-sdk/src/logger";
import { VolumeOffSolidIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { type IBodyProps } from "./IBodyProps";
import { VideoBodyFactory } from "./MBodyFactory";
import RoomContext, { TimelineRenderingType } from "../../../contexts/RoomContext";
import { useMediaVisible } from "../../../hooks/useMediaVisible";
import { useSettingValue } from "../../../hooks/useSettings";
import { type MediaEventHelper } from "../../../utils/MediaEventHelper";
import { _t } from "../../../languageHandler";
import { PlaybackManager } from "../../../audio/PlaybackManager";
import { formatRoundDuration, prefersReducedMotion } from "../../../utils/roundVideo";

/** The timelines that draw a round video as a circle; the panels and exports keep Element's video. */
const ROUND_TIMELINES: TimelineRenderingType[] = [
    TimelineRenderingType.Room,
    TimelineRenderingType.Thread,
    TimelineRenderingType.Search,
];

/** Something that plays a round video with sound and can be told to stop. */
interface SoundOwner {
    stopSound(): void;
}

let soundOwner: SoundOwner | null = null;

/** Only one round video plays with sound at a time: a new one stops the one before. */
export const RoundVideoSound = {
    claim(owner: SoundOwner): void {
        if (soundOwner && soundOwner !== owner) soundOwner.stopSound();
        soundOwner = owner;
        // Voice messages and audio files stop too.
        PlaybackManager.instance.pauseAllExcept();
    },
    release(owner: SoundOwner): void {
        if (soundOwner === owner) soundOwner = null;
    },
    get current(): SoundOwner | null {
        return soundOwner;
    },
};

/**
 * Inside: a round video message («кружок»), as in Telegram: a circle without a bubble that loops
 * muted while it is on screen (not with reduced motion or "autoplay videos" off: then the first
 * frame), and on a click plays from the start with sound and a progress ring around its edge; a
 * click again pauses, the end goes back to the muted loop. Elsewhere it is Element's video.
 */
export default function InsideRoundVideoBody(props: IBodyProps): JSX.Element {
    const { timelineRenderingType } = useContext(RoomContext);
    const [mediaVisible] = useMediaVisible(props.mxEvent);
    if (
        props.forExport ||
        !mediaVisible ||
        !props.mediaEventHelper ||
        !ROUND_TIMELINES.includes(timelineRenderingType)
    ) {
        return <VideoBodyFactory {...props} />;
    }
    return (
        <RoundVideoCircle
            mxEvent={props.mxEvent}
            mediaEventHelper={props.mediaEventHelper}
            inhibitInteraction={props.inhibitInteraction}
        />
    );
}

const RING_R = 48.5;
const RING_C = 2 * Math.PI * RING_R;

interface CircleProps {
    mxEvent: MatrixEvent;
    mediaEventHelper: MediaEventHelper;
    inhibitInteraction?: boolean;
}

export function RoundVideoCircle({ mxEvent, mediaEventHelper, inhibitInteraction }: CircleProps): JSX.Element {
    const content = mxEvent.getContent<MediaEventContent>();
    const infoDurationMs = (content.info as { duration?: number } | undefined)?.duration ?? 0;
    const autoplaySetting = useSettingValue("autoplayVideo");
    const autoplay = !!autoplaySetting && !inhibitInteraction && !prefersReducedMotion();

    const rootRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [visible, setVisible] = useState(false);
    const [src, setSrc] = useState<string | null>(null);
    const [poster, setPoster] = useState<string | undefined>(undefined);
    const [wantSource, setWantSource] = useState(false);
    const [sound, setSound] = useState(false);
    const [paused, setPaused] = useState(false);
    const [positionMs, setPositionMs] = useState(0);
    const [failed, setFailed] = useState(false);
    const playOnLoad = useRef(false);

    // On screen or not.
    useEffect(() => {
        const node = rootRef.current;
        if (!node) return;
        if (typeof IntersectionObserver === "undefined") {
            setVisible(true);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => setVisible(entries.some((e) => e.isIntersecting && e.intersectionRatio > 0.3)),
            { threshold: [0, 0.3, 0.6] },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    // The first frame, as the poster.
    useEffect(() => {
        let cancelled = false;
        mediaEventHelper.thumbnailUrl.value.then(
            (url) => !cancelled && setPoster(url ?? undefined),
            (e) => logger.warn("Unable to load the poster of a round video", e),
        );
        return () => {
            cancelled = true;
        };
    }, [mediaEventHelper]);

    // The video itself, once it is to play.
    const loadSource = wantSource || (autoplay && visible);
    useEffect(() => {
        if (!loadSource || src) return;
        let cancelled = false;
        mediaEventHelper.sourceUrl.value.then(
            (url) => !cancelled && setSrc(url),
            (e) => {
                logger.warn("Unable to load a round video", e);
                if (!cancelled) setFailed(true);
            },
        );
        return () => {
            cancelled = true;
        };
    }, [loadSource, src, mediaEventHelper]);

    const owner = useRef<SoundOwner>({ stopSound: () => {} });
    owner.current.stopSound = (): void => {
        const video = videoRef.current;
        setSound(false);
        setPaused(false);
        setPositionMs(0);
        if (video) {
            video.pause();
            video.muted = true;
            video.loop = true;
            try {
                video.currentTime = 0;
            } catch {
                // not loaded yet
            }
        }
    };
    useEffect(() => {
        const o = owner.current;
        return () => RoundVideoSound.release(o);
    }, []);

    // Muted loop while on screen; stopped otherwise.
    useEffect(() => {
        const video = videoRef.current;
        if (!video || sound) return;
        video.muted = true;
        video.loop = true;
        if (autoplay && visible && src) {
            video.play()?.catch(() => {
                // autoplay refused: the poster stays
            });
        } else {
            video.pause();
        }
    }, [autoplay, visible, src, sound]);

    // The progress ring follows the playback.
    useEffect(() => {
        if (!sound || paused) return;
        let frame = 0;
        const tick = (): void => {
            const video = videoRef.current;
            if (video) setPositionMs(video.currentTime * 1000);
            frame = window.requestAnimationFrame(tick);
        };
        frame = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frame);
    }, [sound, paused]);

    const durationMs = (): number => {
        const d = videoRef.current?.duration;
        return d && Number.isFinite(d) ? d * 1000 : infoDurationMs;
    };

    const startSound = useCallback((): void => {
        const video = videoRef.current;
        RoundVideoSound.claim(owner.current);
        setSound(true);
        setPaused(false);
        setPositionMs(0);
        if (!video || !video.src) {
            playOnLoad.current = true;
            setWantSource(true);
            return;
        }
        video.loop = false;
        video.muted = false;
        try {
            video.currentTime = 0;
        } catch {
            // not loaded yet
        }
        video.play()?.catch((e) => logger.warn("Unable to play a round video", e));
    }, []);

    const onClick = (ev: React.MouseEvent | React.KeyboardEvent): void => {
        if (inhibitInteraction) return;
        ev.stopPropagation();
        const video = videoRef.current;
        if (!sound) {
            startSound();
        } else if (video && !video.paused) {
            video.pause();
            setPaused(true);
        } else if (video) {
            RoundVideoSound.claim(owner.current);
            setPaused(false);
            video.play()?.catch((e) => logger.warn("Unable to play a round video", e));
        }
    };

    const onKeyDown = (ev: React.KeyboardEvent): void => {
        if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            onClick(ev);
        }
    };

    const onLoadedData = (): void => {
        if (!playOnLoad.current) return;
        playOnLoad.current = false;
        const video = videoRef.current;
        if (!video) return;
        video.loop = false;
        video.muted = false;
        video.currentTime = 0;
        video.play()?.catch((e) => logger.warn("Unable to play a round video", e));
    };

    const onEnded = (): void => {
        if (!sound) return;
        RoundVideoSound.release(owner.current);
        owner.current.stopSound();
    };

    const total = durationMs();
    const progress = sound && total ? Math.min(1, positionMs / total) : 0;
    const label = sound ? formatRoundDuration(Math.max(0, total - positionMs)) : formatRoundDuration(total);
    const ariaLabel = _t("timeline|m.video|round_label", { duration: formatRoundDuration(total) });

    return (
        <div
            ref={rootRef}
            className={classNames("mx_InsideRoundVideoBody", {
                mx_InsideRoundVideoBody_sound: sound,
                mx_InsideRoundVideoBody_paused: sound && paused,
            })}
            role="button"
            tabIndex={inhibitInteraction ? -1 : 0}
            aria-label={ariaLabel}
            aria-pressed={sound && !paused}
            onClick={onClick}
            onKeyDown={onKeyDown}
            data-testid="round-video"
        >
            <div className="mx_InsideRoundVideoBody_circle">
                {poster && !src && <img className="mx_InsideRoundVideoBody_poster" src={poster} alt="" />}
                {src && !failed && (
                    <video
                        ref={videoRef}
                        className="mx_InsideRoundVideoBody_video"
                        src={src}
                        poster={poster}
                        muted
                        loop
                        playsInline
                        preload={autoplay ? "auto" : "metadata"}
                        disablePictureInPicture
                        onLoadedData={onLoadedData}
                        onEnded={onEnded}
                        onPause={() => sound && setPaused(true)}
                        onPlay={() => sound && setPaused(false)}
                    />
                )}
                {sound && (
                    <svg className="mx_InsideRoundVideoBody_ring" viewBox="0 0 100 100" aria-hidden>
                        <circle
                            cx="50"
                            cy="50"
                            r={RING_R}
                            strokeDasharray={RING_C}
                            strokeDashoffset={RING_C * (1 - progress)}
                        />
                    </svg>
                )}
                {sound && paused && <div className="mx_InsideRoundVideoBody_play" aria-hidden />}
            </div>
            <span className="mx_InsideRoundVideoBody_duration">
                {label}
                {!sound && <VolumeOffSolidIcon className="mx_InsideRoundVideoBody_muted" aria-hidden />}
            </span>
        </div>
    );
}
