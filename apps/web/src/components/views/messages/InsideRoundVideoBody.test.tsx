/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "test-utils-rtl";
import { EventType, MatrixEvent } from "matrix-js-sdk/src/matrix";

import { RoundVideoCircle, RoundVideoSound } from "./InsideRoundVideoBody";
import { type MediaEventHelper } from "../../../utils/MediaEventHelper";
import SettingsStore from "../../../settings/SettingsStore";

function mkEvent(id: string): MatrixEvent {
    return new MatrixEvent({
        room_id: "!room:server",
        sender: "@user:server",
        type: EventType.RoomMessage,
        event_id: id,
        content: {
            "msgtype": "m.video",
            "body": "video_note.mp4",
            "url": "mxc://server/round",
            "info": { mimetype: "video/mp4", w: 384, h: 384, duration: 7000, size: 1000 },
            "estate.inside.lobby.video_note": true,
        },
    });
}

function mkHelper(): MediaEventHelper {
    return {
        media: { isEncrypted: false, hasThumbnail: true },
        thumbnailUrl: { value: Promise.resolve("https://server/poster.jpg") },
        sourceUrl: { value: Promise.resolve("https://server/round.mp4") },
    } as unknown as MediaEventHelper;
}

let observers: Array<(entries: Partial<IntersectionObserverEntry>[]) => void>;

function setOnScreen(onScreen: boolean): void {
    act(() => {
        observers.forEach((cb) => cb([{ isIntersecting: onScreen, intersectionRatio: onScreen ? 1 : 0 }]));
    });
}

describe("RoundVideoCircle", () => {
    let lowBandwidth: boolean;
    let play: ReturnType<typeof vi.spyOn>;
    let pause: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        lowBandwidth = false;
        observers = [];
        vi.stubGlobal(
            "IntersectionObserver",
            class {
                public constructor(cb: (entries: Partial<IntersectionObserverEntry>[]) => void) {
                    observers.push(cb);
                }
                public observe(): void {}
                public disconnect(): void {}
            },
        );
        const getValue = SettingsStore.getValue.bind(SettingsStore);
        vi.spyOn(SettingsStore, "getValue").mockImplementation(((name: string, ...rest: unknown[]) =>
            name === "lowBandwidth"
                ? lowBandwidth
                : name === "autoplayVideo"
                  ? false // round videos loop whatever this says
                  : (getValue as any)(name, ...rest)) as typeof SettingsStore.getValue);
        play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
            Object.defineProperty(this, "paused", { value: false, configurable: true });
            return Promise.resolve();
        });
        pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
            Object.defineProperty(this, "paused", { value: true, configurable: true });
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    const video = (container: HTMLElement): HTMLVideoElement => container.querySelector("video")!;

    it("is a circle with the duration and loops muted while on screen, even with autoplay videos off", async () => {
        const { container } = render(<RoundVideoCircle mxEvent={mkEvent("$a")} mediaEventHelper={mkHelper()} />);
        expect(screen.getByTestId("round-video")).toHaveAccessibleName("Video message, 0:07");
        expect(container.querySelector(".mx_InsideRoundVideoBody_duration")).toHaveTextContent("0:07");

        setOnScreen(true);
        await waitFor(() => expect(video(container)).toBeTruthy());
        await waitFor(() => expect(play).toHaveBeenCalled());
        expect(video(container).muted).toBe(true);
        expect(video(container).loop).toBe(true);
        expect(container.querySelector(".mx_InsideRoundVideoBody_ring")).toBeNull();

        setOnScreen(false);
        expect(pause).toHaveBeenCalled();
    });

    it.each([
        ["low bandwidth", () => (lowBandwidth = true)],
        [
            "reduced motion",
            () =>
                vi.stubGlobal(
                    "matchMedia",
                    vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
                ),
        ],
        ["Save-Data", () => vi.stubGlobal("navigator", { ...navigator, connection: { saveData: true } })],
    ])("shows the first frame and does not play with %s", async (_name, setUp) => {
        setUp();
        const { container } = render(<RoundVideoCircle mxEvent={mkEvent("$a")} mediaEventHelper={mkHelper()} />);
        setOnScreen(true);
        await waitFor(() =>
            expect(container.querySelector(".mx_InsideRoundVideoBody_poster")).toHaveAttribute(
                "src",
                "https://server/poster.jpg",
            ),
        );
        expect(video(container)).toBeNull();
        expect(play).not.toHaveBeenCalled();
    });

    it("plays with sound from the start on a click, pauses on the next, and loops muted after the end", async () => {
        const { container } = render(<RoundVideoCircle mxEvent={mkEvent("$a")} mediaEventHelper={mkHelper()} />);
        setOnScreen(true);
        await waitFor(() => expect(video(container)).toBeTruthy());
        const v = video(container);
        v.currentTime = 3;

        fireEvent.click(screen.getByTestId("round-video"));
        expect(v.muted).toBe(false);
        expect(v.loop).toBe(false);
        expect(v.currentTime).toBe(0);
        expect(screen.getByTestId("round-video")).toHaveAttribute("aria-pressed", "true");
        expect(container.querySelector(".mx_InsideRoundVideoBody_ring")).not.toBeNull();

        fireEvent.click(screen.getByTestId("round-video"));
        expect(v.paused).toBe(true);
        expect(container.querySelector(".mx_InsideRoundVideoBody_play")).not.toBeNull();

        fireEvent.click(screen.getByTestId("round-video"));
        expect(v.paused).toBe(false);

        fireEvent.ended(v);
        await waitFor(() => expect(v.muted).toBe(true));
        expect(v.loop).toBe(true);
        expect(container.querySelector(".mx_InsideRoundVideoBody_ring")).toBeNull();
        expect(RoundVideoSound.current).toBeNull();
    });

    it("plays only one round video with sound at a time", async () => {
        const { container } = render(
            <>
                <RoundVideoCircle mxEvent={mkEvent("$a")} mediaEventHelper={mkHelper()} />
                <RoundVideoCircle mxEvent={mkEvent("$b")} mediaEventHelper={mkHelper()} />
            </>,
        );
        setOnScreen(true);
        await waitFor(() => expect(container.querySelectorAll("video")).toHaveLength(2));
        const [first, second] = screen.getAllByTestId("round-video");
        const [v1, v2] = Array.from(container.querySelectorAll("video"));

        fireEvent.click(first);
        expect(v1.muted).toBe(false);
        fireEvent.click(second);
        expect(v2.muted).toBe(false);
        expect(v1.muted).toBe(true);
        expect(first).toHaveAttribute("aria-pressed", "false");
        expect(second).toHaveAttribute("aria-pressed", "true");
    });

    it("loads the video on a click when it does not autoplay, then plays it with sound", async () => {
        lowBandwidth = true;
        const { container } = render(<RoundVideoCircle mxEvent={mkEvent("$a")} mediaEventHelper={mkHelper()} />);
        fireEvent.click(screen.getByTestId("round-video"));
        await waitFor(() => expect(video(container)).toBeTruthy());
        fireEvent.loadedData(video(container));
        expect(video(container).muted).toBe(false);
        expect(play).toHaveBeenCalled();
    });
});
