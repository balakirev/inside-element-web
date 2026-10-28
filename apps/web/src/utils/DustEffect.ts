/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Inside: Telegram-style "dust" effect for a deleted message.
 *
 * The bubble of the message (or the whole tile when it has no bubble) is copied into a fixed
 * overlay at the same place: a clone with its computed styles inlined, so it looks the same
 * outside the timeline. A front sweeps over the copy from left to right; behind the front the
 * copy is masked away and turns into 1–2 px particles of the bubble's colours (background,
 * text, media pixels) that drift up and to the right with some turbulence and fade out.
 * Meanwhile the real tile is hidden; when the overlay is removed the timeline shows whatever
 * the redaction left (nothing or "Message deleted").
 *
 * Everything is fire-and-forget: the caller does not wait, nothing throws, the overlay is always
 * removed, and nothing happens under prefers-reduced-motion or when the tile is not on screen.
 */

import UIStore from "../stores/UIStore";

/** Class name of the overlay element (for the skin and for tests). */
export const DUST_OVERLAY_CLASS = "mx_InsideDustOverlay";

/** Time for the front to cross the bubble, ms. */
const SWEEP_MS = 320;
/** Lifetime of a particle, ms (random in this range). */
const LIFE_MIN_MS = 260;
const LIFE_MAX_MS = 460;
/** The overlay is removed after this at the latest, even if no frame ran. */
export const DUST_TOTAL_MS = SWEEP_MS + LIFE_MAX_MS + 120;

/** Room around the bubble for the particles to fly into, CSS px. */
const PAD_LEFT = 24;
const PAD_RIGHT = 140;
const PAD_TOP = 120;
const PAD_BOTTOM = 24;

/** Upper bound of particles per bubble; the sampling step grows for big bubbles. */
const MAX_PARTICLES = 9000;
/** Upper bound of elements whose styles are copied into the clone. */
const MAX_CLONED_ELEMENTS = 800;

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    start: number;
    life: number;
    size: number;
    phase: number;
    freq: number;
    amp: number;
    color: string;
}

interface ColourRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    colour: string;
}

interface MediaSample {
    rect: DOMRect;
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

export function prefersReducedMotion(): boolean {
    try {
        return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    } catch {
        return false;
    }
}

function isTransparent(colour: string): boolean {
    if (!colour || colour === "transparent") return true;
    const m = colour.match(/rgba?\(([^)]+)\)/);
    if (!m) return false;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length >= 4 && parseFloat(parts[3]) === 0;
}

function isVisible(el: Element): boolean {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const { windowWidth, windowHeight } = UIStore.instance;
    return r.bottom > 0 && r.right > 0 && r.top < windowHeight && r.left < windowWidth;
}

/** The tiles of the event currently on screen (the thread root may be in two places). */
function findTargets(eventId: string): HTMLElement[] {
    // Compared as attributes rather than in a selector: event ids may hold any character.
    const tiles = Array.from(document.querySelectorAll<HTMLElement>(".mx_EventTile[data-event-id]")).filter(
        (tile) => tile.getAttribute("data-event-id") === eventId,
    );
    const targets: HTMLElement[] = [];
    for (const tile of tiles) {
        if (tile.closest(`.${DUST_OVERLAY_CLASS}`)) continue;
        const line = tile.querySelector<HTMLElement>(".mx_EventTile_line");
        const target = line && isVisible(line) ? line : tile;
        if (isVisible(target)) targets.push(target);
    }
    return targets.slice(0, 2);
}

function copyStyle(from: CSSStyleDeclaration, to: CSSStyleDeclaration): void {
    for (let i = 0; i < from.length; i++) {
        const name = from[i];
        to.setProperty(name, from.getPropertyValue(name), from.getPropertyPriority(name));
    }
}

function pseudoCopy(el: Element, which: "::before" | "::after"): HTMLElement | null {
    const cs = getComputedStyle(el, which);
    if (!cs || !cs.content || cs.content === "none" || cs.content === "normal") return null;
    const span = document.createElement("span");
    copyStyle(cs, span.style);
    // The text of `content` is not copied (it is usually empty for decorations).
    span.style.setProperty("content", "normal");
    return span;
}

/** Deep clone of `src` with every element's computed style inlined (ids removed). */
function styledClone(src: HTMLElement): HTMLElement {
    let budget = MAX_CLONED_ELEMENTS;
    const walk = (from: Element, to: Element): void => {
        if (budget-- <= 0) return;
        to.removeAttribute("id");
        const toEl = to as HTMLElement;
        if (toEl.style) copyStyle(getComputedStyle(from), toEl.style);
        if (from instanceof HTMLCanvasElement && to instanceof HTMLCanvasElement) {
            try {
                to.getContext("2d")?.drawImage(from, 0, 0);
            } catch {
                /* tainted or no context */
            }
        }
        const before = pseudoCopy(from, "::before");
        const after = pseudoCopy(from, "::after");
        const fromKids = from.children;
        const toKids = to.children;
        for (let i = 0; i < fromKids.length && i < toKids.length; i++) walk(fromKids[i], toKids[i]);
        if (before) to.insertBefore(before, to.firstChild);
        if (after) to.appendChild(after);
    };
    const clone = src.cloneNode(true) as HTMLElement;
    walk(src, clone);
    return clone;
}

/** Rectangles of text with their colour, to colour the particles over the letters. */
function textRects(target: HTMLElement): ColourRect[] {
    const rects: ColourRect[] = [];
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let node: Node | null;
    while ((node = walker.nextNode()) && rects.length < 400) {
        if (!node.textContent?.trim() || !node.parentElement) continue;
        const colour = getComputedStyle(node.parentElement).color;
        range.selectNodeContents(node);
        for (const r of Array.from(range.getClientRects?.() ?? [])) {
            rects.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, colour });
        }
    }
    return rects;
}

/** Pixels of images/canvases in the bubble, when the browser lets us read them. */
function mediaSamples(target: HTMLElement): MediaSample[] {
    const samples: MediaSample[] = [];
    const media = target.querySelectorAll<HTMLImageElement | HTMLCanvasElement | HTMLVideoElement>(
        "img, canvas, video",
    );
    for (const el of Array.from(media).slice(0, 6)) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) continue;
        const width = Math.min(160, Math.ceil(rect.width / 2));
        const height = Math.min(160, Math.ceil(rect.height / 2));
        try {
            const c = document.createElement("canvas");
            c.width = width;
            c.height = height;
            const ctx = c.getContext("2d");
            if (!ctx) continue;
            ctx.drawImage(el, 0, 0, width, height);
            samples.push({ rect, width, height, data: ctx.getImageData(0, 0, width, height).data });
        } catch {
            /* cross-origin or not loaded: the particles there take the bubble colour */
        }
    }
    return samples;
}

function colourAt(
    x: number,
    y: number,
    background: string | null,
    texts: ColourRect[],
    media: MediaSample[],
): string | null {
    for (const m of media) {
        const r = m.rect;
        if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
            const px = Math.min(m.width - 1, Math.floor(((x - r.left) / r.width) * m.width));
            const py = Math.min(m.height - 1, Math.floor(((y - r.top) / r.height) * m.height));
            const i = (py * m.width + px) * 4;
            if (m.data[i + 3] < 16) break;
            return `rgb(${m.data[i]},${m.data[i + 1]},${m.data[i + 2]})`;
        }
    }
    for (const t of texts) {
        if (x >= t.left && x < t.right && y >= t.top && y < t.bottom && Math.random() < 0.22) return t.colour;
    }
    return background;
}

function buildParticles(target: HTMLElement, rect: DOMRect): Particle[] {
    const style = getComputedStyle(target);
    const background = isTransparent(style.backgroundColor) ? null : style.backgroundColor;
    const texts = textRects(target);
    const media = mediaSamples(target);

    const area = rect.width * rect.height;
    const step = Math.max(2, Math.ceil(Math.sqrt(area / MAX_PARTICLES)));
    const particles: Particle[] = [];
    for (let y = 0; y < rect.height; y += step) {
        for (let x = 0; x < rect.width; x += step) {
            const colour = colourAt(rect.left + x, rect.top + y, background, texts, media);
            if (!colour) continue;
            // The front crosses left to right, slightly ahead at the top: a diagonal like Telegram.
            const along = x / rect.width;
            const start = SWEEP_MS * (0.85 * along + 0.15 * (1 - y / rect.height)) + Math.random() * 60;
            particles.push({
                x: x + PAD_LEFT + Math.random() * step,
                y: y + PAD_TOP + Math.random() * step,
                vx: 30 + Math.random() * 90,
                vy: -(60 + Math.random() * 150),
                start,
                life: LIFE_MIN_MS + Math.random() * (LIFE_MAX_MS - LIFE_MIN_MS),
                size: Math.random() < 0.6 ? 1 : 2,
                phase: Math.random() * Math.PI * 2,
                freq: 8 + Math.random() * 14,
                amp: 2 + Math.random() * 6,
                color: colour,
            });
        }
    }
    return particles;
}

function dissolve(target: HTMLElement): void {
    const rect = target.getBoundingClientRect();

    const overlay = document.createElement("div");
    overlay.className = DUST_OVERLAY_CLASS;
    overlay.setAttribute("aria-hidden", "true");
    Object.assign(overlay.style, {
        position: "fixed",
        left: `${rect.left - PAD_LEFT}px`,
        top: `${rect.top - PAD_TOP}px`,
        width: `${rect.width + PAD_LEFT + PAD_RIGHT}px`,
        height: `${rect.height + PAD_TOP + PAD_BOTTOM}px`,
        pointerEvents: "none",
        zIndex: "5000",
        overflow: "visible",
        contain: "layout style",
    });

    let clone: HTMLElement | null = null;
    let particles: Particle[] = [];
    try {
        clone = styledClone(target);
        Object.assign(clone.style, {
            position: "absolute",
            left: `${PAD_LEFT}px`,
            top: `${PAD_TOP}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            margin: "0",
            transform: "none",
            boxSizing: "border-box",
            visibility: "visible",
            pointerEvents: "none",
        });
        clone.setAttribute("inert", "");
        overlay.appendChild(clone);
        particles = buildParticles(target, rect);
    } catch {
        /* without a copy or particles the bubble simply disappears */
    }

    const canvas = document.createElement("canvas");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = rect.width + PAD_LEFT + PAD_RIGHT;
    const ch = rect.height + PAD_TOP + PAD_BOTTOM;
    canvas.width = Math.ceil(cw * dpr);
    canvas.height = Math.ceil(ch * dpr);
    Object.assign(canvas.style, { position: "absolute", left: "0", top: "0", width: `${cw}px`, height: `${ch}px` });
    overlay.appendChild(canvas);
    let ctx: CanvasRenderingContext2D | null = null;
    try {
        ctx = canvas.getContext("2d");
    } catch {
        ctx = null;
    }

    const previousVisibility = target.style.visibility;
    target.style.visibility = "hidden";
    document.body.appendChild(overlay);

    let done = false;
    let frame = 0;
    const finish = (): void => {
        if (done) return;
        done = true;
        if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
        overlay.remove();
        target.style.visibility = previousVisibility;
    };
    const safety = window.setTimeout(finish, DUST_TOTAL_MS + 200);

    if (typeof requestAnimationFrame !== "function") return;
    const t0 = performance.now();
    const tick = (now: number): void => {
        if (done) return;
        const t = now - t0;
        if (t >= DUST_TOTAL_MS) {
            window.clearTimeout(safety);
            finish();
            return;
        }
        if (clone) {
            // Mask the copy behind the front (a soft edge hides the seam under the particles).
            const front = (t / SWEEP_MS) * rect.width * 1.15 - 0.15 * rect.width;
            const mask =
                t >= SWEEP_MS + 60
                    ? "linear-gradient(transparent, transparent)"
                    : `linear-gradient(to right, transparent ${front - 6}px, #000 ${front + 10}px)`;
            clone.style.setProperty("mask-image", mask);
            clone.style.setProperty("-webkit-mask-image", mask);
        }
        if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, cw, ch);
            for (const p of particles) {
                const age = t - p.start;
                if (age < 0 || age > p.life) continue;
                const k = age / p.life;
                const s = age / 1000;
                // Drift up-right, speeding up, with a wobble across the path.
                const x = p.x + p.vx * s * (1 + k) + Math.sin(p.phase + s * p.freq) * p.amp * k;
                const y = p.y + p.vy * s * (1 + 0.6 * k) + Math.cos(p.phase + s * p.freq * 0.7) * p.amp * k;
                ctx.globalAlpha = Math.max(0, 1 - k * k);
                ctx.fillStyle = p.color;
                ctx.fillRect(x, y, p.size, p.size);
            }
            ctx.globalAlpha = 1;
        }
        frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
}

/**
 * Plays the dust effect over the tile(s) of the event. Returns whether an effect started.
 * Call it before sending the redaction, so the tile still shows the original content.
 */
export function playDustEffect(eventId: string | undefined): boolean {
    try {
        if (!eventId || typeof document === "undefined" || prefersReducedMotion()) return false;
        const targets = findTargets(eventId);
        for (const target of targets) dissolve(target);
        return targets.length > 0;
    } catch {
        return false;
    }
}
