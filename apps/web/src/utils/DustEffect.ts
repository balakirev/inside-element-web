/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Inside: Telegram-style "dust" effect for a deleted message (the "Thanos snap").
 *
 * 1. Synchronously, before the redaction is sent (the local echo re-renders the tile at once):
 *    the bubble is copied into a fixed overlay at the same place (a clone with its computed styles
 *    inlined, so it looks the same outside the timeline), its images/videos/canvases are snapshotted,
 *    and the real bubble is hidden. The tile's height is locked, so nothing moves yet.
 * 2. On the first frame the copy is painted into a small canvas (backgrounds with their rounded
 *    corners, borders, media, every word with its own font and colour) and cut into square
 *    particles of ~2 CSS px (whole device pixels), each with the colour of its pixel.
 * 3. A diagonal front sweeps over the bubble from its outer side (left for others' bubbles, right for
 *    own ones). Behind it the copy is masked away and the particles fly off: away from the front and
 *    up, accelerating, with a random spread and a wobble, shrinking and fading out.
 * 4. Meanwhile the tile's height animates to what the timeline now shows there ("Message deleted",
 *    or nothing: then a spacer takes the tile's place and shrinks to zero), so nothing jumps.
 *
 * All running effects share one full-window canvas and one animation frame loop: WebGL (one draw call
 * per bubble, tens of thousands of particles) or Canvas2D with fewer, bigger particles. The canvas,
 * GL buffers and context are released when the last effect ends. With prefers-reduced-motion the copy
 * just fades out and the space collapses.
 *
 * Everything is fire-and-forget: the caller does not wait, nothing throws, the DOM is always restored
 * (a timer finishes the effect even when no frame runs, e.g. in a background tab), and nothing
 * happens when the tile is not on screen.
 */

/** Class name of the overlay holding the copy of the bubble (for the skin and for tests). */
export const DUST_OVERLAY_CLASS = "mx_InsideDustOverlay";
/** Class name of the shared particle canvas. */
export const DUST_CANVAS_CLASS = "mx_InsideDustCanvas";
/** Class name of the spacer that stands in for a tile the timeline removed. */
export const DUST_SPACER_CLASS = "mx_InsideDustSpacer";

/** Time for the front to cross the bubble, ms. */
export const SWEEP_MS = 420;
/** Random delay of a particle after the front passed it, ms (a ragged edge). */
const JITTER_MS = 70;
/** Lifetime of a particle, ms (random in this range). */
const LIFE_MIN_MS = 380;
const LIFE_MAX_MS = 560;
/** When the space of the tile starts to close, and for how long, ms. */
export const COLLAPSE_DELAY_MS = 260;
export const COLLAPSE_MS = 340;
/** Fade-in of what the timeline shows in place of the message ("Message deleted"), ms. */
const REVEAL_MS = 180;
/** End of the effect, ms after its start. */
export const DUST_TOTAL_MS = Math.max(SWEEP_MS + JITTER_MS + LIFE_MAX_MS, COLLAPSE_DELAY_MS + COLLAPSE_MS + REVEAL_MS);

/** Reduced motion: the copy fades out, then the space closes. */
const REDUCED_FADE_MS = 160;
const REDUCED_COLLAPSE_DELAY_MS = 100;
const REDUCED_COLLAPSE_MS = 200;
const REDUCED_TOTAL_MS = REDUCED_COLLAPSE_DELAY_MS + REDUCED_COLLAPSE_MS + REVEAL_MS;

/** Share of the start time that goes with the position across / down the bubble (a diagonal front). */
const ACROSS = 0.82;
const DOWN = 0.18;

/** Size of a particle, CSS px; it grows for big bubbles to stay under the cap of the renderer. */
const PARTICLE_CSS_PX = 2;
export const MAX_PARTICLES_WEBGL = 60000;
export const MAX_PARTICLES_2D = 6000;

/** Upper bounds of the work done synchronously before the redaction request and on the first frame. */
const MAX_CLONED_ELEMENTS = 400;
const MAX_PAINTED_ELEMENTS = 300;
const MAX_PAINTED_WORDS = 1500;
const MAX_MEDIA = 6;
const MAX_MEDIA_SNAPSHOT_PX = 640;
/** At most this many tiles per call (a thread root shows in two places; bulk deletes many). */
const MAX_TARGETS = 40;

export type DustRenderer = "webgl" | "2d" | "none";

/** Frame timing of the last run of the shared loop, for the test harness. */
export interface DustStats {
    renderer: DustRenderer;
    frames: number;
    particles: number;
    /** Time between animation frames, ms. */
    avgFrameMs: number;
    maxFrameMs: number;
    /** Time spent in our frame callback (JS + GL/2D command submission), ms. */
    avgWorkMs: number;
    maxWorkMs: number;
}

/** Particles of one bubble, laid out as the WebGL attributes. Times are relative to the bubble's start. */
export interface ParticleSet {
    count: number;
    /** x, y: CSS px in the window. */
    pos: Float32Array;
    /** vx, vy (px/s), ax, ay (px/s²). */
    motion: Float32Array;
    /** start (ms), life (ms), seed (0..1), size (device px). */
    time: Float32Array;
    /** r, g, b, a. */
    color: Uint8Array;
}

interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export function prefersReducedMotion(): boolean {
    try {
        return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    } catch {
        return false;
    }
}

function now(): number {
    return performance.now();
}

function isTransparent(colour: string): boolean {
    if (!colour || colour === "transparent") return true;
    const m = colour.match(/rgba?\(([^)]+)\)/);
    if (!m) return false;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length >= 4 && parseFloat(parts[3]) === 0;
}

function windowBox(): Box {
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
}

function intersect(a: Box, b: Box): Box {
    return {
        left: Math.max(a.left, b.left),
        top: Math.max(a.top, b.top),
        right: Math.min(a.right, b.right),
        bottom: Math.min(a.bottom, b.bottom),
    };
}

function isEmpty(b: Box): boolean {
    return b.right <= b.left || b.bottom <= b.top;
}

/** The part of the window where the element can be seen: inside its scrolling ancestors. */
function visibleBox(el: HTMLElement): Box {
    let box = windowBox();
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const { overflowY, overflowX } = getComputedStyle(node);
        if (/(auto|scroll|hidden|clip)/.test(overflowY + overflowX)) box = intersect(box, node.getBoundingClientRect());
    }
    return box;
}

function isVisible(el: Element): boolean {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !isEmpty(intersect(r, windowBox()));
}

interface Target {
    /** The element that turns to dust: the bubble, or the whole tile when it has none. */
    bubble: HTMLElement;
    /** The tile (timeline row) whose height closes. */
    tile: HTMLElement;
    /** +1: the front goes left to right (others' bubbles); -1: right to left (own bubbles, on the right). */
    dir: 1 | -1;
}

/** The tiles of the events currently on screen (a thread root may be in two places). */
function findTargets(eventIds: ReadonlySet<string>): Target[] {
    // Compared as attributes rather than in a selector: event ids may hold any character.
    const tiles = Array.from(document.querySelectorAll<HTMLElement>(".mx_EventTile[data-event-id]")).filter((tile) =>
        eventIds.has(tile.getAttribute("data-event-id") ?? ""),
    );
    const targets: Target[] = [];
    for (const tile of tiles) {
        if (tile.closest(`.${DUST_OVERLAY_CLASS}`)) continue;
        const line = tile.querySelector<HTMLElement>(".mx_EventTile_line");
        const bubble = line && isVisible(line) ? line : tile;
        if (!isVisible(bubble)) continue;
        const own = /stateOwnEvent/.test(tile.className) || tile.getAttribute("data-self") === "true";
        targets.push({ bubble, tile, dir: own ? -1 : 1 });
    }
    return targets.slice(0, MAX_TARGETS);
}

/* ---------------------------------------------------------------------------------------------- */
/* Copy of the bubble                                                                             */
/* ---------------------------------------------------------------------------------------------- */

function copyStyle(from: CSSStyleDeclaration, to: CSSStyleDeclaration): void {
    for (let i = 0; i < from.length; i++) {
        const name = from[i];
        // Custom properties (hundreds of --cpd-*/--inside-* tokens, inherited by every element)
        // are skipped: computed values already have var() resolved, and copying them would be
        // about two thirds of the work.
        if (name.startsWith("--")) continue;
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

/**
 * Pixels of the images, videos and canvases of the bubble, taken now (the timeline is about to
 * replace them), as drawn on screen (object-fit cover/contain). Null where the browser does not let
 * us read them (cross-origin) or they are not loaded: the particles there take the colours under them.
 */
function snapshotMedia(bubble: HTMLElement): (HTMLCanvasElement | null)[] {
    const media = Array.from(bubble.querySelectorAll<HTMLElement>("img, video, canvas"));
    return media.map((el, i) => {
        if (i >= MAX_MEDIA) return null;
        try {
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return null;
            let sw: number, sh: number;
            if (el instanceof HTMLImageElement) {
                if (!el.complete) return null;
                [sw, sh] = [el.naturalWidth, el.naturalHeight];
            } else if (el instanceof HTMLVideoElement) {
                [sw, sh] = [el.videoWidth, el.videoHeight];
            } else {
                [sw, sh] = [(el as HTMLCanvasElement).width, (el as HTMLCanvasElement).height];
            }
            if (!sw || !sh) return null;
            const scale = Math.min(1, MAX_MEDIA_SNAPSHOT_PX / Math.max(r.width, r.height));
            const c = document.createElement("canvas");
            c.width = Math.max(1, Math.round(r.width * scale));
            c.height = Math.max(1, Math.round(r.height * scale));
            const ctx = c.getContext("2d");
            if (!ctx) return null;
            const fit = getComputedStyle(el).objectFit;
            let [sx, sy, sWidth, sHeight] = [0, 0, sw, sh];
            let [dx, dy, dWidth, dHeight] = [0, 0, c.width, c.height];
            if (fit === "cover") {
                const k = Math.max(c.width / sw, c.height / sh);
                sWidth = c.width / k;
                sHeight = c.height / k;
                sx = (sw - sWidth) / 2;
                sy = (sh - sHeight) / 2;
            } else if (fit === "contain" || el instanceof HTMLVideoElement) {
                const k = Math.min(c.width / sw, c.height / sh);
                dWidth = sw * k;
                dHeight = sh * k;
                dx = (c.width - dWidth) / 2;
                dy = (c.height - dHeight) / 2;
            }
            ctx.drawImage(el as CanvasImageSource, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight);
            ctx.getImageData(0, 0, 1, 1); // throws if tainted
            return c;
        } catch {
            return null;
        }
    });
}

/* ---------------------------------------------------------------------------------------------- */
/* Painting the copy into pixels                                                                  */
/* ---------------------------------------------------------------------------------------------- */

function px(value: string, of: number): number {
    if (value.endsWith("%")) return (parseFloat(value) / 100) * of;
    return parseFloat(value) || 0;
}

function radii(cs: CSSStyleDeclaration, r: DOMRect): number[] {
    const one = (v: string, of: number): number => px(v.split(" ")[0] ?? "0", of);
    const m = Math.min(r.width, r.height) / 2;
    return [
        Math.min(m, one(cs.borderTopLeftRadius, r.width)),
        Math.min(m, one(cs.borderTopRightRadius, r.width)),
        Math.min(m, one(cs.borderBottomRightRadius, r.width)),
        Math.min(m, one(cs.borderBottomLeftRadius, r.width)),
    ];
}

function roundedPath(ctx: CanvasRenderingContext2D, r: DOMRect, rad: number[]): void {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
        ctx.roundRect(r.left, r.top, r.width, r.height, rad);
    } else {
        ctx.rect(r.left, r.top, r.width, r.height);
    }
}

function fontOf(cs: CSSStyleDeclaration): string {
    return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
}

/** Paints the copy of the bubble at 1 CSS px per pixel into an image of `rect`'s size. */
function paintBubble(root: HTMLElement, rect: DOMRect, media: (HTMLCanvasElement | null)[]): ImageData | null {
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, -rect.left, -rect.top);

    const rootStyle = getComputedStyle(root);
    roundedPath(ctx, rect, radii(rootStyle, rect));
    ctx.clip();

    // Backgrounds, borders and media, parents first (document order).
    const mediaEls = Array.from(root.querySelectorAll<HTMLElement>("img, video, canvas"));
    const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))].slice(0, MAX_PAINTED_ELEMENTS);
    for (const el of elements) {
        const cs = el === root ? rootStyle : getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.opacity === "0") continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const rad = radii(cs, r);
        ctx.globalAlpha = Math.min(1, parseFloat(cs.opacity) || 1);
        if (!isTransparent(cs.backgroundColor)) {
            ctx.fillStyle = cs.backgroundColor;
            roundedPath(ctx, r, rad);
            ctx.fill();
        }
        const bw = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map((v) =>
            px(v, 0),
        );
        const bc = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor];
        if (bw.some((v, i) => v > 0 && !isTransparent(bc[i]))) {
            if (bw.every((v) => v === bw[0]) && bc.every((c) => c === bc[0])) {
                ctx.strokeStyle = bc[0];
                ctx.lineWidth = bw[0];
                const inset = new DOMRect(r.left + bw[0] / 2, r.top + bw[0] / 2, r.width - bw[0], r.height - bw[0]);
                roundedPath(
                    ctx,
                    inset,
                    rad.map((v) => Math.max(0, v - bw[0] / 2)),
                );
                ctx.stroke();
            } else {
                const strips = [
                    [r.left, r.top, r.width, bw[0]],
                    [r.right - bw[1], r.top, bw[1], r.height],
                    [r.left, r.bottom - bw[2], r.width, bw[2]],
                    [r.left, r.top, bw[3], r.height],
                ];
                strips.forEach(([x, y, sw, sh], i) => {
                    if (bw[i] <= 0 || isTransparent(bc[i])) return;
                    ctx.fillStyle = bc[i];
                    ctx.fillRect(x, y, sw, sh);
                });
            }
        }
        const mediaIndex = mediaEls.indexOf(el);
        const snapshot = mediaIndex >= 0 ? media[mediaIndex] : null;
        if (snapshot) {
            ctx.save();
            roundedPath(ctx, r, rad);
            ctx.clip();
            ctx.drawImage(snapshot, r.left, r.top, r.width, r.height);
            ctx.restore();
        }
    }

    // Text, word by word, in its own font and colour.
    ctx.textBaseline = "alphabetic";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const metrics = new Map<string, { ascent: number; descent: number }>();
    let words = 0;
    let node: Node | null;
    while ((node = walker.nextNode()) && words < MAX_PAINTED_WORDS) {
        const text = node.textContent ?? "";
        const parent = node.parentElement;
        if (!text.trim() || !parent) continue;
        const cs = getComputedStyle(parent);
        if (cs.visibility === "hidden" || isTransparent(cs.color)) continue;
        const font = fontOf(cs);
        ctx.font = font;
        ctx.fillStyle = cs.color;
        let m = metrics.get(font);
        if (!m) {
            const tm = ctx.measureText("Hg");
            const size = parseFloat(cs.fontSize) || 14;
            m = {
                ascent: tm.fontBoundingBoxAscent ?? size * 0.8,
                descent: tm.fontBoundingBoxDescent ?? size * 0.2,
            };
            metrics.set(font, m);
        }
        for (const match of text.matchAll(/\S+/g)) {
            if (words++ >= MAX_PAINTED_WORDS) break;
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            const rects = range.getClientRects?.();
            if (!rects || rects.length !== 1) continue;
            const r = rects[0];
            if (r.width <= 0 || r.height <= 0 || r.right < rect.left || r.left > rect.right) continue;
            const baseline = r.top + (r.height - (m.ascent + m.descent)) / 2 + m.ascent;
            ctx.fillText(match[0], r.left, baseline, r.width + 1);
        }
    }
    range.detach?.();

    try {
        return ctx.getImageData(0, 0, w, h);
    } catch {
        return null;
    }
}

/* ---------------------------------------------------------------------------------------------- */
/* Particles                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

export interface ParticleOptions {
    /** Where the image sits in the window, CSS px (1 image pixel = 1 CSS px). */
    left: number;
    top: number;
    /** Only this part of the window gets particles (what is visible of the bubble). */
    clip: Box;
    dir: 1 | -1;
    dpr: number;
    maxParticles: number;
    random?: () => number;
}

/** Cell size, CSS px: ~2 px, a whole number of device pixels, bigger when the bubble is huge. */
export function particleCell(area: number, dpr: number, maxParticles: number): number {
    const css = Math.max(PARTICLE_CSS_PX, Math.sqrt(area / maxParticles));
    return Math.max(1, Math.round(css * dpr)) / dpr;
}

/** Cuts an image of the bubble into particles with the colour of their pixel and their own motion. */
export function particlesFromImage(image: Pick<ImageData, "data" | "width" | "height">, o: ParticleOptions): ParticleSet {
    const random = o.random ?? Math.random;
    const { width: w, height: h, data } = image;
    const cell = particleCell(w * h, o.dpr, o.maxParticles);
    const cols = Math.ceil(w / cell);
    const rows = Math.ceil(h / cell);
    const capacity = Math.min(cols * rows, Math.ceil(o.maxParticles * 1.2));
    const pos = new Float32Array(capacity * 2);
    const motion = new Float32Array(capacity * 4);
    const time = new Float32Array(capacity * 4);
    const color = new Uint8Array(capacity * 4);
    const size = cell * o.dpr;
    let n = 0;
    for (let row = 0; row < rows && n < capacity; row++) {
        const cy = row * cell + cell / 2;
        const y = o.top + cy;
        if (y < o.clip.top || y > o.clip.bottom) continue;
        const py = Math.min(h - 1, Math.floor(cy));
        for (let col = 0; col < cols && n < capacity; col++) {
            const cx = col * cell + cell / 2;
            const x = o.left + cx;
            if (x < o.clip.left || x > o.clip.right) continue;
            const i = (py * w + Math.min(w - 1, Math.floor(cx))) * 4;
            const a = data[i + 3];
            if (a < 24) continue;
            const across = o.dir > 0 ? cx / w : 1 - cx / w;
            pos[n * 2] = x;
            pos[n * 2 + 1] = y;
            // Away from the front and up, faster and faster, with some spread.
            motion[n * 4] = o.dir * (18 + random() * 90) + (random() - 0.5) * 50;
            motion[n * 4 + 1] = -(24 + random() * 100) + (random() - 0.5) * 30;
            motion[n * 4 + 2] = o.dir * (30 + random() * 90);
            motion[n * 4 + 3] = -(50 + random() * 130);
            time[n * 4] = SWEEP_MS * (ACROSS * across + DOWN * (cy / h)) + random() * JITTER_MS;
            time[n * 4 + 1] = LIFE_MIN_MS + random() * (LIFE_MAX_MS - LIFE_MIN_MS);
            time[n * 4 + 2] = random();
            time[n * 4 + 3] = size;
            color[n * 4] = data[i];
            color[n * 4 + 1] = data[i + 1];
            color[n * 4 + 2] = data[i + 2];
            color[n * 4 + 3] = a;
            n++;
        }
    }
    return { count: n, pos, motion, time, color };
}

/**
 * The mask that hides the copy behind the front at time `t` (ms): a gradient across the diagonal on
 * which particles start together, put where the last of them (with the most jitter) have left.
 */
export function sweepMask(t: number, width: number, height: number, dir: 1 | -1): string {
    const ux = (ACROSS / Math.max(1, width)) * dir;
    const uy = DOWN / Math.max(1, height);
    const n = Math.hypot(ux, uy);
    const angle = (Math.atan2(ux, -uy) * 180) / Math.PI;
    const along = (t - JITTER_MS) / SWEEP_MS; // 0..1 across the bubble
    const at = along / n; // px along the gradient line
    return `linear-gradient(${angle.toFixed(2)}deg, transparent ${(at - 4).toFixed(1)}px, #000 ${(at + 4).toFixed(1)}px)`;
}

/** Where a particle is at `age` ms, for the Canvas2D renderer (the WebGL shader does the same). */
function particleState(set: ParticleSet, i: number, age: number, out: Float32Array): boolean {
    const life = set.time[i * 4 + 1];
    if (age < 0 || age >= life) return false;
    const k = age / life;
    const s = age / 1000;
    const w = set.time[i * 4 + 2] * Math.PI * 2;
    out[0] =
        set.pos[i * 2] + set.motion[i * 4] * s + 0.5 * set.motion[i * 4 + 2] * s * s + Math.sin(w + s * 9) * 3 * k;
    out[1] =
        set.pos[i * 2 + 1] +
        set.motion[i * 4 + 1] * s +
        0.5 * set.motion[i * 4 + 3] * s * s +
        Math.cos(w * 1.3 + s * 7) * 3 * k;
    out[2] = 1 - k ** 1.4; // alpha
    out[3] = 1 - 0.55 * k; // scale
    return true;
}

/* ---------------------------------------------------------------------------------------------- */
/* Renderers                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

interface Renderer {
    kind: DustRenderer;
    maxParticles: number;
    /** Uploads a bubble's particles; `offset` is the bubble's start in the loop's clock. */
    add(set: ParticleSet, offset: number): unknown;
    remove(handle: unknown): void;
    /** Draws every bubble at `t` ms of the loop's clock. */
    draw(t: number, width: number, height: number, dpr: number): void;
    dispose(): void;
}

const VERTEX_SHADER = `
attribute vec2 a_pos;
attribute vec4 a_motion;
attribute vec4 a_time;
attribute vec4 a_color;
uniform float u_now;
uniform vec2 u_view;
varying vec4 v_color;
void main() {
    float age = u_now - a_time.x;
    float k = age / a_time.y;
    if (age < 0.0 || k >= 1.0) {
        gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
        gl_PointSize = 0.0;
        v_color = vec4(0.0);
        return;
    }
    float s = age / 1000.0;
    float w = a_time.z * 6.2831853;
    vec2 p = a_pos + a_motion.xy * s + 0.5 * a_motion.zw * s * s
        + vec2(sin(w + s * 9.0), cos(w * 1.3 + s * 7.0)) * (3.0 * k);
    vec2 clip = p / u_view * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    gl_PointSize = max(1.0, a_time.w * (1.0 - 0.55 * k));
    float alpha = (1.0 - pow(k, 1.4)) * a_color.a;
    v_color = vec4(a_color.rgb * alpha, alpha);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec4 v_color;
void main() {
    gl_FragColor = v_color;
}`;

interface GlHandle {
    count: number;
    offset: number;
    buffers: WebGLBuffer[];
}

function createWebGlRenderer(canvas: HTMLCanvasElement): Renderer | null {
    let gl: WebGLRenderingContext | null = null;
    try {
        gl = canvas.getContext("webgl", {
            alpha: true,
            premultipliedAlpha: true,
            antialias: false,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: false,
        }) as WebGLRenderingContext | null;
    } catch {
        gl = null;
    }
    if (!gl || typeof gl.createShader !== "function") return null;

    const compile = (type: number, source: string): WebGLShader | null => {
        const shader = gl!.createShader(type);
        if (!shader) return null;
        gl!.shaderSource(shader, source);
        gl!.compileShader(shader);
        return gl!.getShaderParameter(shader, gl!.COMPILE_STATUS) ? shader : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

    const attr = {
        pos: gl.getAttribLocation(program, "a_pos"),
        motion: gl.getAttribLocation(program, "a_motion"),
        time: gl.getAttribLocation(program, "a_time"),
        color: gl.getAttribLocation(program, "a_color"),
    };
    const uNow = gl.getUniformLocation(program, "u_now");
    const uView = gl.getUniformLocation(program, "u_view");
    const handles = new Set<GlHandle>();

    const upload = (data: Float32Array | Uint8Array): WebGLBuffer => {
        const buffer = gl!.createBuffer()!;
        gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
        gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW);
        return buffer;
    };

    return {
        kind: "webgl",
        maxParticles: MAX_PARTICLES_WEBGL,
        add(set, offset) {
            const n = set.count;
            const handle: GlHandle = {
                count: n,
                offset,
                buffers: [
                    upload(set.pos.subarray(0, n * 2)),
                    upload(set.motion.subarray(0, n * 4)),
                    upload(set.time.subarray(0, n * 4)),
                    upload(set.color.subarray(0, n * 4)),
                ],
            };
            handles.add(handle);
            return handle;
        },
        remove(handle) {
            const h = handle as GlHandle;
            if (!handles.delete(h)) return;
            for (const b of h.buffers) gl!.deleteBuffer(b);
        },
        draw(t, width, height, dpr) {
            const g = gl!;
            g.viewport(0, 0, Math.round(width * dpr), Math.round(height * dpr));
            g.clearColor(0, 0, 0, 0);
            g.clear(g.COLOR_BUFFER_BIT);
            if (!handles.size) return;
            g.useProgram(program);
            g.enable(g.BLEND);
            g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
            g.uniform2f(uView, width, height);
            const bind = (buffer: WebGLBuffer, loc: number, size: number, type: number, normalized: boolean): void => {
                if (loc < 0) return;
                g.bindBuffer(g.ARRAY_BUFFER, buffer);
                g.enableVertexAttribArray(loc);
                g.vertexAttribPointer(loc, size, type, normalized, 0, 0);
            };
            for (const h of handles) {
                g.uniform1f(uNow, t - h.offset);
                bind(h.buffers[0], attr.pos, 2, g.FLOAT, false);
                bind(h.buffers[1], attr.motion, 4, g.FLOAT, false);
                bind(h.buffers[2], attr.time, 4, g.FLOAT, false);
                bind(h.buffers[3], attr.color, 4, g.UNSIGNED_BYTE, true);
                g.drawArrays(g.POINTS, 0, h.count);
            }
        },
        dispose() {
            for (const h of Array.from(handles)) this.remove(h);
            gl!.deleteProgram(program);
            gl!.deleteShader(vs);
            gl!.deleteShader(fs);
            gl!.getExtension("WEBGL_lose_context")?.loseContext();
        },
    };
}

interface CanvasHandle {
    set: ParticleSet;
    offset: number;
    styles: string[];
}

function create2dRenderer(canvas: HTMLCanvasElement): Renderer | null {
    let ctx: CanvasRenderingContext2D | null = null;
    try {
        ctx = canvas.getContext("2d");
    } catch {
        ctx = null;
    }
    if (!ctx) return null;
    const handles = new Set<CanvasHandle>();
    const state = new Float32Array(4);
    return {
        kind: "2d",
        maxParticles: MAX_PARTICLES_2D,
        add(set, offset) {
            const styles: string[] = [];
            for (let i = 0; i < set.count; i++) {
                styles.push(`rgb(${set.color[i * 4]},${set.color[i * 4 + 1]},${set.color[i * 4 + 2]})`);
            }
            const handle: CanvasHandle = { set, offset, styles };
            handles.add(handle);
            return handle;
        },
        remove(handle) {
            handles.delete(handle as CanvasHandle);
        },
        draw(t, width, height, dpr) {
            const c = ctx!;
            c.setTransform(dpr, 0, 0, dpr, 0, 0);
            c.clearRect(0, 0, width, height);
            for (const h of handles) {
                const { set } = h;
                const at = t - h.offset;
                for (let i = 0; i < set.count; i++) {
                    if (!particleState(set, i, at - set.time[i * 4], state)) continue;
                    const size = (set.time[i * 4 + 3] / dpr) * state[3];
                    c.globalAlpha = state[2] * (set.color[i * 4 + 3] / 255);
                    c.fillStyle = h.styles[i];
                    c.fillRect(state[0] - size / 2, state[1] - size / 2, size, size);
                }
            }
            c.globalAlpha = 1;
        },
        dispose() {
            handles.clear();
            canvas.width = 0;
            canvas.height = 0;
        },
    };
}

/* ---------------------------------------------------------------------------------------------- */
/* The shared loop                                                                                */
/* ---------------------------------------------------------------------------------------------- */

interface Effect {
    /** Called every frame with ms since the effect's start; returns false once done. */
    step(t: number): boolean;
    /** Puts the DOM back; called once, at the end or when cut short. */
    finish(): void;
    start: number;
    end: number;
}

let lastStats: DustStats = {
    renderer: "none",
    frames: 0,
    particles: 0,
    avgFrameMs: 0,
    maxFrameMs: 0,
    avgWorkMs: 0,
    maxWorkMs: 0,
};

/** Frame timing of the last (or current) run, for the test harness. */
export function getDustStats(): DustStats {
    return { ...lastStats };
}

/** Override of the renderer choice, for the test harness ("2d" to measure the fallback). */
let forcedRenderer: DustRenderer | undefined;
export function setDustRenderer(kind: DustRenderer | undefined): void {
    forcedRenderer = kind;
}

class DustLoop {
    private static current: DustLoop | null = null;

    public static get(): DustLoop {
        if (!DustLoop.current) DustLoop.current = new DustLoop();
        return DustLoop.current;
    }

    /** Ends every running effect at once (tests, page teardown). */
    public static stopAll(): void {
        DustLoop.current?.dispose();
    }

    private readonly epoch = now();
    private effects = new Set<Effect>();
    private canvas: HTMLCanvasElement | null = null;
    private renderer: Renderer | null = null;
    private rendererTried = false;
    private frame = 0;
    private safety = 0;
    private lastFrame = 0;
    private frameSum = 0;
    private workSum = 0;
    private particles = 0;
    private dpr = Math.min(2, window.devicePixelRatio || 1);
    private width = 0;
    private height = 0;

    public get devicePixelRatio(): number {
        return this.dpr;
    }

    public get maxParticles(): number {
        return this.getRenderer()?.maxParticles ?? 0;
    }

    public clock(): number {
        return now() - this.epoch;
    }

    public add(effect: Effect): void {
        this.effects.add(effect);
        this.armSafety();
        if (!this.frame && typeof requestAnimationFrame === "function") {
            this.lastFrame = 0;
            this.frame = requestAnimationFrame(this.tick);
        }
    }

    /** The renderer, created with the canvas on first use; null when the browser has neither. */
    public getRenderer(): Renderer | null {
        if (this.rendererTried) return this.renderer;
        this.rendererTried = true;
        if (forcedRenderer === "none") return null;
        const canvas = document.createElement("canvas");
        canvas.className = DUST_CANVAS_CLASS;
        canvas.setAttribute("aria-hidden", "true");
        Object.assign(canvas.style, {
            position: "fixed",
            left: "0",
            top: "0",
            width: "100vw",
            height: "100vh",
            pointerEvents: "none",
            zIndex: "5001",
        });
        this.canvas = canvas;
        this.resize();
        this.renderer =
            (forcedRenderer !== "2d" ? createWebGlRenderer(canvas) : null) ?? create2dRenderer(canvas) ?? null;
        if (this.renderer) {
            document.body.appendChild(canvas);
            lastStats = { ...lastStats, renderer: this.renderer.kind, frames: 0, particles: 0 };
        } else {
            this.canvas = null;
        }
        return this.renderer;
    }

    public addParticles(set: ParticleSet, start: number): unknown {
        this.particles += set.count;
        return this.renderer?.add(set, start);
    }

    public removeParticles(handle: unknown): void {
        if (handle) this.renderer?.remove(handle);
    }

    private resize(): void {
        if (!this.canvas) return;
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = Math.max(1, Math.round(this.width * this.dpr));
        this.canvas.height = Math.max(1, Math.round(this.height * this.dpr));
    }

    private armSafety(): void {
        window.clearTimeout(this.safety);
        const end = Math.max(...Array.from(this.effects, (e) => e.end));
        // Background tabs get no animation frames; the timer puts the DOM back all the same.
        this.safety = window.setTimeout(() => this.dispose(), Math.max(0, end - this.clock()) + 300);
    }

    private readonly tick = (frameTime: number): void => {
        this.frame = 0;
        const workStart = now();
        const t = this.clock();
        for (const effect of Array.from(this.effects)) {
            let alive = false;
            try {
                alive = t < effect.end && effect.step(t - effect.start);
            } catch {
                alive = false;
            }
            if (!alive) {
                this.effects.delete(effect);
                effect.finish();
            }
        }
        if (this.renderer) {
            if (window.innerWidth !== this.width || window.innerHeight !== this.height) this.resize();
            this.renderer.draw(t, this.width, this.height, this.dpr);
        }
        const work = now() - workStart;
        const frames = lastStats.frames + 1;
        const delta = this.lastFrame ? frameTime - this.lastFrame : 0;
        this.lastFrame = frameTime;
        this.workSum += work;
        if (delta) this.frameSum += delta;
        lastStats = {
            renderer: this.renderer?.kind ?? "none",
            frames,
            particles: this.particles,
            avgFrameMs: frames > 1 ? this.frameSum / (frames - 1) : 0,
            maxFrameMs: Math.max(lastStats.frames ? lastStats.maxFrameMs : 0, delta),
            avgWorkMs: this.workSum / frames,
            maxWorkMs: Math.max(lastStats.frames ? lastStats.maxWorkMs : 0, work),
        };
        if (this.effects.size) {
            this.frame = requestAnimationFrame(this.tick);
        } else {
            this.dispose();
        }
    };

    private dispose(): void {
        if (this.frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.frame);
        this.frame = 0;
        window.clearTimeout(this.safety);
        const effects = Array.from(this.effects);
        this.effects.clear();
        for (const effect of effects) {
            try {
                effect.finish();
            } catch {
                /* keep going */
            }
        }
        this.renderer?.dispose();
        this.renderer = null;
        this.canvas?.remove();
        this.canvas = null;
        if (DustLoop.current === this) DustLoop.current = null;
    }
}

/** Ends every running effect now and puts the DOM back (tests; leaving the page). */
export function stopDustEffects(): void {
    DustLoop.stopAll();
}

/* ---------------------------------------------------------------------------------------------- */
/* One tile                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

function easeInOutCubic(x: number): number {
    const k = Math.min(1, Math.max(0, x));
    return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
}

/**
 * Closes the tile's height smoothly from what it was to what the timeline now shows there. If the
 * timeline removes the tile, a spacer of its height takes its place and closes instead.
 */
class Collapse {
    private readonly from: number;
    private to: number | null = null;
    private spacer: HTMLElement | null = null;
    private readonly observer: MutationObserver | null = null;
    private readonly saved: Record<string, string>;
    private released = false;

    public constructor(private readonly tile: HTMLElement) {
        this.from = tile.getBoundingClientRect().height;
        const s = tile.style;
        this.saved = { height: s.height, overflow: s.overflow, boxSizing: s.boxSizing, minHeight: s.minHeight };
        Object.assign(s, { height: `${this.from}px`, overflow: "hidden", boxSizing: "border-box", minHeight: "0" });

        const parent = tile.parentNode;
        if (parent && typeof MutationObserver === "function") {
            this.observer = new MutationObserver((records) => {
                for (const record of records) {
                    if (!Array.from(record.removedNodes).includes(tile)) continue;
                    this.replaceWithSpacer(parent, record.nextSibling);
                }
            });
            this.observer.observe(parent, { childList: true });
        }
    }

    private get current(): HTMLElement {
        return this.spacer ?? this.tile;
    }

    private replaceWithSpacer(parent: Node, next: Node | null): void {
        if (this.spacer || this.released) return;
        if (next && next.parentNode !== parent) next = null;
        const spacer = document.createElement(this.tile.tagName.toLowerCase() === "li" ? "li" : "div");
        spacer.className = DUST_SPACER_CLASS;
        spacer.setAttribute("aria-hidden", "true");
        Object.assign(spacer.style, {
            height: this.tile.style.height,
            margin: "0",
            padding: "0",
            border: "0",
            listStyle: "none",
            pointerEvents: "none",
        });
        try {
            parent.insertBefore(spacer, next);
        } catch {
            return;
        }
        this.spacer = spacer;
        this.to = 0;
    }

    /** `k`: 0..1 progress of the collapse. */
    public step(k: number): void {
        if (this.released) return;
        if (this.to === null) {
            if (!this.tile.isConnected) {
                this.to = 0;
            } else {
                // The natural height of what the tile shows now (the redaction has re-rendered it).
                this.tile.style.height = this.saved.height;
                this.to = Math.min(this.from, this.tile.getBoundingClientRect().height);
                this.tile.style.height = `${this.from}px`;
            }
        }
        const h = this.from + (this.to - this.from) * easeInOutCubic(k);
        this.current.style.height = `${h.toFixed(2)}px`;
    }

    public release(): void {
        if (this.released) return;
        this.released = true;
        this.observer?.disconnect();
        this.spacer?.remove();
        this.spacer = null;
        Object.assign(this.tile.style, this.saved);
    }
}

function dissolve(target: Target, loop: DustLoop, reduced: boolean, delay: number): Effect {
    const { bubble, tile, dir } = target;
    const rect = bubble.getBoundingClientRect();
    const clip = intersect(visibleBox(bubble), windowBox());

    const overlay = document.createElement("div");
    overlay.className = DUST_OVERLAY_CLASS;
    overlay.setAttribute("aria-hidden", "true");
    Object.assign(overlay.style, {
        position: "fixed",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        pointerEvents: "none",
        zIndex: "5000",
        overflow: "visible",
        contain: "layout style",
        // What is under the header or the composer stays hidden there.
        clipPath: `inset(${Math.max(0, clip.top - rect.top)}px ${Math.max(0, rect.right - clip.right)}px ${Math.max(
            0,
            rect.bottom - clip.bottom,
        )}px ${Math.max(0, clip.left - rect.left)}px)`,
    });

    let clone: HTMLElement | null = null;
    let media: (HTMLCanvasElement | null)[] = [];
    try {
        if (!reduced) media = snapshotMedia(bubble);
        clone = styledClone(bubble);
        Object.assign(clone.style, {
            position: "absolute",
            left: "0",
            top: "0",
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            minWidth: "0",
            maxWidth: "none",
            minHeight: "0",
            maxHeight: "none",
            margin: "0",
            transform: "none",
            boxSizing: "border-box",
            visibility: "visible",
            opacity: "1",
            pointerEvents: "none",
        });
        clone.setAttribute("inert", "");
        overlay.appendChild(clone);
    } catch {
        clone = null; // without a copy the bubble simply disappears
    }

    const previousVisibility = bubble.style.visibility;
    const previousOpacity = bubble.style.opacity;
    bubble.style.visibility = "hidden";
    document.body.appendChild(overlay);
    const collapse = new Collapse(tile);

    const collapseDelay = (reduced ? REDUCED_COLLAPSE_DELAY_MS : COLLAPSE_DELAY_MS) + delay;
    const collapseMs = reduced ? REDUCED_COLLAPSE_MS : COLLAPSE_MS;
    const total = (reduced ? REDUCED_TOTAL_MS : DUST_TOTAL_MS) + delay;
    let painted = reduced;
    let particles: unknown = null;
    let revealed = false;
    const start = loop.clock();

    const reveal = (k: number): void => {
        if (!revealed) {
            revealed = true;
            collapse.release();
            bubble.style.visibility = previousVisibility;
        }
        bubble.style.opacity = k >= 1 ? previousOpacity : String(Math.max(0, k).toFixed(3));
    };

    return {
        start,
        end: start + total,
        step(t) {
            if (!painted) {
                painted = true;
                const renderer = loop.getRenderer();
                const image = renderer && clone ? paintBubble(clone, rect, media) : null;
                media = [];
                if (renderer && image) {
                    const set = particlesFromImage(image, {
                        left: rect.left,
                        top: rect.top,
                        clip,
                        dir,
                        dpr: loop.devicePixelRatio,
                        maxParticles: Math.max(1000, Math.floor(renderer.maxParticles / 2)),
                    });
                    particles = loop.addParticles(set, start + delay);
                }
            }
            const local = t - delay;
            if (clone) {
                if (reduced) {
                    overlay.style.opacity = String(Math.max(0, 1 - local / REDUCED_FADE_MS).toFixed(3));
                } else if (local >= SWEEP_MS + JITTER_MS + 40) {
                    clone.remove();
                    clone = null;
                } else {
                    const mask = sweepMask(local, rect.width, rect.height, dir);
                    clone.style.setProperty("mask-image", mask);
                    clone.style.setProperty("-webkit-mask-image", mask);
                }
            }
            const collapseEnd = collapseDelay + collapseMs;
            if (t >= collapseDelay && t < collapseEnd) collapse.step((t - collapseDelay) / collapseMs);
            if (t >= collapseEnd) reveal((t - collapseEnd) / REVEAL_MS);
            return t < total;
        },
        finish() {
            loop.removeParticles(particles);
            particles = null;
            overlay.remove();
            collapse.release();
            bubble.style.visibility = previousVisibility;
            bubble.style.opacity = previousOpacity;
        },
    };
}

export interface DustOptions {
    /** Delay between the bubbles when several are deleted at once, ms (a cascade). */
    staggerMs?: number;
}

/**
 * Plays the dust effect over the tile(s) of the events and closes the space they took. Returns
 * whether an effect started. Call it before sending the redaction, so the tiles still show the
 * original content; do not wait for it.
 */
export function playDustEffect(eventIds: string | undefined | readonly (string | undefined)[], options: DustOptions = {}): boolean {
    try {
        const ids = new Set((Array.isArray(eventIds) ? eventIds : [eventIds]).filter((id): id is string => !!id));
        if (!ids.size || typeof document === "undefined") return false;
        const targets = findTargets(ids);
        if (!targets.length) return false;
        const reduced = prefersReducedMotion();
        const loop = DustLoop.get();
        // Top to bottom, so a cascade reads in order.
        targets.sort((a, b) => a.bubble.getBoundingClientRect().top - b.bubble.getBoundingClientRect().top);
        const stagger = targets.length > 1 ? (options.staggerMs ?? 35) : 0;
        targets.forEach((target, i) => {
            try {
                loop.add(dissolve(target, loop, reduced, reduced ? 0 : i * stagger));
            } catch {
                /* this tile stays as it is */
            }
        });
        return true;
    } catch {
        return false;
    }
}
