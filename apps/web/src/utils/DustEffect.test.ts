/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    DUST_CANVAS_CLASS,
    DUST_OVERLAY_CLASS,
    DUST_SPACER_CLASS,
    DUST_TOTAL_MS,
    dustDirection,
    getDustStats,
    particlesFromImage,
    playDustEffect,
    setDustRenderer,
    stopDustEffects,
} from "./DustEffect";

function mockMatchMedia(reduce: boolean): void {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: reduce && query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
    const r = { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
    return { ...r, toJSON: () => r } as DOMRect;
}

interface TestTile {
    tile: HTMLElement;
    line: HTMLElement;
    /** What the tile measures once its height is not locked (what the timeline shows there now). */
    setNaturalHeight(height: number): void;
}

/** A timeline row with a bubble, measured as the browser would (happy-dom does no layout). */
function addTile(eventId: string, { own = false, top = 200, parent = document.body } = {}): TestTile {
    const tile = document.createElement("li");
    tile.className = own ? "mx_EventTile _stateOwnEvent_jdebx_912" : "mx_EventTile";
    tile.setAttribute("data-event-id", eventId);
    const line = document.createElement("div");
    line.className = "mx_EventTile_line";
    line.style.backgroundColor = "rgb(255, 255, 255)";
    line.textContent = "Hello";
    tile.appendChild(line);
    parent.appendChild(tile);
    let natural = 40;
    line.getBoundingClientRect = () => rect(100, top, 200, 40);
    tile.getBoundingClientRect = () => rect(100, top, 200, parseFloat(tile.style.height) || natural);
    return { tile, line, setNaturalHeight: (h) => (natural = h) };
}

const overlays = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(`.${DUST_OVERLAY_CLASS}`));
const canvases = (): Element[] => Array.from(document.querySelectorAll(`.${DUST_CANVAS_CLASS}`));
const spacers = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(`.${DUST_SPACER_CLASS}`));

/** A Canvas2D context that draws nothing and reads back opaque white. */
function fake2dContext(): CanvasRenderingContext2D {
    const target = {
        measureText: () => ({ width: 10, fontBoundingBoxAscent: 12, fontBoundingBoxDescent: 3 }),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
            width: w,
            height: h,
            data: new Uint8ClampedArray(w * h * 4).fill(255),
        }),
    } as Record<string, unknown>;
    return new Proxy(target, {
        get: (t, key) => (key in t ? t[key as string] : typeof key === "string" ? vi.fn() : undefined),
        set: () => true,
    }) as unknown as CanvasRenderingContext2D;
}

/** A WebGL context that accepts every call, with a spy on losing the context. */
function fakeWebGlContext(loseContext: () => void): WebGLRenderingContext {
    const target = {
        createShader: () => ({}),
        createProgram: () => ({}),
        createBuffer: () => ({}),
        getShaderParameter: () => true,
        getProgramParameter: () => true,
        getAttribLocation: () => 0,
        getUniformLocation: () => ({}),
        getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext } : null),
    } as Record<string, unknown>;
    return new Proxy(target, {
        get: (t, key) => (key in t ? t[key as string] : typeof key === "string" ? vi.fn() : undefined),
    }) as unknown as WebGLRenderingContext;
}

describe("dustDirection", () => {
    it("starts the wave from the sender's side: own bubbles from the right, others' from the left", () => {
        const own = document.createElement("li");
        own.className = "mx_EventTile _stateOwnEvent_jdebx_912";
        const other = document.createElement("li");
        other.className = "mx_EventTile";
        expect(dustDirection(own)).toBe(-1);
        expect(dustDirection(other)).toBe(1);
    });
});

describe("particlesFromImage", () => {
    const W = 40;
    const H = 4;
    const image = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) };
    const options = {
        left: 10,
        top: 20,
        clip: { left: 0, top: 0, right: 1000, bottom: 1000 },
        dpr: 1,
        maxParticles: 10000,
        random: () => 0.5,
    };

    /** Start time of each particle of the first row, from left to right. */
    function firstRowStarts(dir: 1 | -1): number[] {
        const set = particlesFromImage(image, { ...options, dir });
        const starts: number[] = [];
        for (let i = 0; i < set.count; i++) {
            if (set.pos[i * 2 + 1] === set.pos[1]) starts.push(set.time[i * 4]);
        }
        return starts;
    }

    it("cuts the bubble into 2 px particles with the colours of their pixels", () => {
        const set = particlesFromImage(image, { ...options, dir: 1 });
        expect(set.count).toBe((W / 2) * (H / 2));
        expect(set.time[3]).toBe(2); // size in device px
        expect(Array.from(set.color.subarray(0, 4))).toEqual([255, 255, 255, 255]);
        expect([set.pos[0], set.pos[1]]).toEqual([11, 21]);
    });

    it("goes left to right over others' bubbles", () => {
        const starts = firstRowStarts(1);
        expect(starts.length).toBe(W / 2);
        for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThan(starts[i - 1]);
    });

    it("goes right to left over own bubbles", () => {
        const starts = firstRowStarts(-1);
        for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeLessThan(starts[i - 1]);
    });

    it("blows the particles away from the front and up", () => {
        for (const dir of [1, -1] as const) {
            const set = particlesFromImage(image, { ...options, dir, random: Math.random });
            for (let i = 0; i < set.count; i++) {
                expect(Math.sign(set.motion[i * 4 + 2])).toBe(dir); // ax
                expect(set.motion[i * 4 + 3]).toBeLessThan(0); // ay: up
            }
        }
    });

    it("leaves out transparent pixels and what is outside the visible part", () => {
        const data = new Uint8ClampedArray(W * H * 4).fill(255);
        // The first row of pixels is transparent (e.g. a rounded corner): no particles there.
        for (let x = 0; x < W * 2; x++) data[x * 4 + 3] = 0;
        const all = particlesFromImage({ width: W, height: H, data }, { ...options, dir: 1 }).count;
        expect(all).toBe((W / 2) * (H / 2 - 1));

        const clipped = particlesFromImage(image, {
            ...options,
            dir: 1,
            clip: { left: 0, top: 0, right: 10 + W / 2, bottom: 1000 },
        });
        expect(clipped.count).toBe((W / 4) * (H / 2));
    });
});

describe("playDustEffect", () => {
    const originalMatchMedia = window.matchMedia;
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    let getContext: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers({
            toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"],
        });
        mockMatchMedia(false);
        getContext = vi.fn((kind: string) => (kind === "2d" ? fake2dContext() : null));
        HTMLCanvasElement.prototype.getContext = getContext as unknown as typeof originalGetContext;
        setDustRenderer("2d");
    });

    afterEach(() => {
        stopDustEffects();
        setDustRenderer(undefined);
        HTMLCanvasElement.prototype.getContext = originalGetContext;
        vi.useRealTimers();
        window.matchMedia = originalMatchMedia;
        document.body.innerHTML = "";
    });

    it("puts a copy of the bubble over it, hides the bubble and locks the row's height", () => {
        const { tile, line } = addTile("$ev1");

        expect(playDustEffect("$ev1")).toBe(true);

        const [overlay] = overlays();
        expect(overlays()).toHaveLength(1);
        expect(overlay.style.position).toBe("fixed");
        expect(overlay.getAttribute("aria-hidden")).toBe("true");
        expect(overlay.style.pointerEvents).toBe("none");
        // A copy of the bubble with the same text, without the event id.
        expect(overlay.textContent).toContain("Hello");
        expect(overlay.querySelector("[data-event-id]")).toBeNull();
        expect(line.style.visibility).toBe("hidden");
        expect(tile.style.height).toBe("40px");
    });

    it("turns the bubble into particles on one shared canvas and releases everything at the end", async () => {
        const { tile, line } = addTile("$ev1");
        tile.style.height = "";

        playDustEffect("$ev1");
        await vi.advanceTimersByTimeAsync(20);

        expect(canvases()).toHaveLength(1);
        expect(getDustStats()).toMatchObject({ renderer: "2d" });
        expect(getDustStats().particles).toBeGreaterThan(0);

        await vi.advanceTimersByTimeAsync(DUST_TOTAL_MS + 100);

        expect(overlays()).toHaveLength(0);
        expect(canvases()).toHaveLength(0);
        expect(line.style.visibility).toBe("");
        expect(line.style.opacity).toBe("");
        expect(tile.style.height).toBe("");
        expect(tile.style.overflow).toBe("");
        // No frame or timer left behind.
        expect(vi.getTimerCount()).toBe(0);
    });

    it("closes the row's space smoothly when the timeline removes the tile", async () => {
        const { tile } = addTile("$gone");
        playDustEffect("$gone");
        tile.remove(); // the redaction, with hidden events off
        await vi.advanceTimersByTimeAsync(0);

        const [spacer] = spacers();
        expect(spacer).toBeDefined();
        expect(spacer.style.height).toBe("40px");

        const heights: number[] = [];
        for (let t = 0; t < 900; t += 50) {
            await vi.advanceTimersByTimeAsync(50);
            if (spacer.isConnected) heights.push(parseFloat(spacer.style.height));
        }
        // Down to nothing, never back up, in more than a couple of steps.
        expect(heights.at(-1)).toBe(0);
        expect(new Set(heights).size).toBeGreaterThan(3);
        for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeLessThanOrEqual(heights[i - 1]);

        // The space is closed, the last particles are still in the air.
        expect(canvases()).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(500);
        expect(spacers()).toHaveLength(0);
        expect(canvases()).toHaveLength(0);
    });

    it("shrinks the row to what the timeline shows in place of the message", async () => {
        const { tile, setNaturalHeight } = addTile("$placeholder");
        playDustEffect("$placeholder");
        setNaturalHeight(24); // "Message deleted"

        await vi.advanceTimersByTimeAsync(DUST_TOTAL_MS / 2);
        const midway = parseFloat(tile.style.height);
        expect(midway).toBeLessThan(40);
        expect(midway).toBeGreaterThanOrEqual(24);

        await vi.advanceTimersByTimeAsync(DUST_TOTAL_MS);
        expect(tile.style.height).toBe("");
    });

    describe("with reduced motion", () => {
        beforeEach(() => mockMatchMedia(true));

        it("fades the bubble out and closes the space, without particles", async () => {
            const { tile, line, setNaturalHeight } = addTile("$calm");

            expect(playDustEffect("$calm")).toBe(true);
            setNaturalHeight(0);
            const [overlay] = overlays();
            await vi.advanceTimersByTimeAsync(80);

            expect(parseFloat(overlay.style.opacity)).toBeLessThan(1);
            expect(canvases()).toHaveLength(0);
            expect(getContext).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(150);
            expect(parseFloat(tile.style.height)).toBeLessThan(40);

            await vi.advanceTimersByTimeAsync(600);
            expect(overlays()).toHaveLength(0);
            expect(line.style.visibility).toBe("");
            expect(tile.style.height).toBe("");
            expect(vi.getTimerCount()).toBe(0);
        });
    });

    it("cleans up at once when the room is switched in the middle", async () => {
        const list = document.createElement("ol");
        document.body.appendChild(list);
        const { line } = addTile("$switch", { parent: list });

        playDustEffect("$switch");
        await vi.advanceTimersByTimeAsync(100);
        expect(canvases()).toHaveLength(1);

        list.remove(); // the room view unmounts
        await vi.advanceTimersByTimeAsync(20);

        expect(overlays()).toHaveLength(0);
        expect(canvases()).toHaveLength(0);
        expect(spacers()).toHaveLength(0);
        expect(line.style.visibility).toBe("");
        expect(vi.getTimerCount()).toBe(0);
    });

    it("handles several messages at once and leaves a tile that is already going alone", async () => {
        addTile("$a", { top: 100 });
        addTile("$b", { top: 200, own: true });

        expect(playDustEffect(["$a", "$b"])).toBe(true);
        expect(overlays()).toHaveLength(2);
        expect(playDustEffect("$a")).toBe(false);
        expect(overlays()).toHaveLength(2);

        await vi.advanceTimersByTimeAsync(20);
        expect(canvases()).toHaveLength(1); // one canvas for all

        await vi.advanceTimersByTimeAsync(DUST_TOTAL_MS + 300);
        expect(overlays()).toHaveLength(0);
        expect(canvases()).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("lets go of the WebGL context when done", async () => {
        const loseContext = vi.fn();
        getContext.mockImplementation((kind: string) =>
            kind === "webgl" ? fakeWebGlContext(loseContext) : fake2dContext(),
        );
        setDustRenderer(undefined);
        addTile("$gl");

        playDustEffect("$gl");
        await vi.advanceTimersByTimeAsync(20);
        expect(getDustStats().renderer).toBe("webgl");

        stopDustEffects();

        expect(loseContext).toHaveBeenCalledTimes(1);
        expect(canvases()).toHaveLength(0);
        expect(overlays()).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("puts the DOM back even when no frame ever runs (a background tab)", () => {
        const { line, tile } = addTile("$bg");
        const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);

        playDustEffect("$bg");
        vi.advanceTimersByTime(DUST_TOTAL_MS + 400);

        expect(overlays()).toHaveLength(0);
        expect(line.style.visibility).toBe("");
        expect(tile.style.height).toBe("");
        raf.mockRestore();
    });

    it("does nothing when the tile is not on screen", () => {
        expect(playDustEffect("$missing")).toBe(false);
        expect(playDustEffect(undefined)).toBe(false);

        // A tile with no size (e.g. collapsed or in a hidden panel).
        const tile = document.createElement("li");
        tile.className = "mx_EventTile";
        tile.setAttribute("data-event-id", "$hidden");
        document.body.appendChild(tile);
        expect(playDustEffect("$hidden")).toBe(false);

        expect(overlays()).toHaveLength(0);
    });

    it("copes with event ids that need escaping in a selector", () => {
        addTile('$a"b]c');
        expect(playDustEffect('$a"b]c')).toBe(true);
        vi.advanceTimersByTime(DUST_TOTAL_MS + 500);
        expect(overlays()).toHaveLength(0);
    });

    it("inlines the computed styles of the bubble but not the custom properties", () => {
        addTile("$ev-css");
        const real = window.getComputedStyle.bind(window);
        const spy = vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
            const cs = real(el, pseudo);
            if (pseudo) return cs;
            const names = ["color", "--cpd-color-text-primary", "--inside-accent"];
            const fake: Record<string, unknown> = {
                ...names,
                length: names.length,
                getPropertyValue: (name: string) => (name === "color" ? "rgb(1, 2, 3)" : "#123456"),
                getPropertyPriority: () => "",
            };
            return new Proxy(cs, {
                get: (target, key) => {
                    if (typeof key === "string" && key in fake) return fake[key];
                    const value = Reflect.get(target, key, target);
                    return typeof value === "function" ? value.bind(target) : value;
                },
            });
        });

        try {
            expect(playDustEffect("$ev-css")).toBe(true);
        } finally {
            spy.mockRestore();
        }

        const clone = document.querySelector<HTMLElement>(`.${DUST_OVERLAY_CLASS} .mx_EventTile_line`)!;
        expect(clone.style.getPropertyValue("color")).toBe("rgb(1, 2, 3)");
        expect(clone.style.getPropertyValue("--cpd-color-text-primary")).toBe("");
        expect(clone.style.getPropertyValue("--inside-accent")).toBe("");
    });
});
