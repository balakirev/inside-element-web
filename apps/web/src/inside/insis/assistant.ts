/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { _t } from "../../languageHandler";
import dis from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { InsisPreviewStore } from "./InsisPreviewStore";
import type { Artifact, AssistantMessage, AssistantSession } from "./model";

/**
 * Inside: what the "Помощник" screens do with the assistant's sessions — on test data, in memory only. Nothing of
 * it goes to Matrix (ADR-069 К-1). When INSIS is connected, `finalize` / `discard` / sending become calls of the
 * `/v1` copilot with the same Idempotency-Key; the screens stay as they are.
 */

const DAY = 24 * 60 * 60 * 1000;

/** The session opened last in the folder — the folder opens on it again, as the mockup does. */
let lastOpenedSessionId: string | undefined;

function store(): InsisPreviewStore {
    return InsisPreviewStore.instance;
}

function startOfDay(ts: number): number {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function newId(prefix: string): string {
    return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

/** A fresh Idempotency-Key for one click of an artifact button. */
export function newIdempotencyKey(): string {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    // Not a secure context (plain http on a LAN address): a v4-shaped random key is enough for the preview.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = Math.floor(Math.random() * 16);
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
}

// --- Reading -------------------------------------------------------------------------------------------------------

/** The artifacts of a session, oldest first. */
export function sessionArtifacts(session: AssistantSession): Artifact[] {
    return session.messages.flatMap((m) => (m.kind === "assistant" && m.artifact ? [m.artifact] : []));
}

/** A draft of the session waits for the broker's confirmation. */
export function isSessionAwaiting(session: AssistantSession): boolean {
    return Boolean(session.awaitingConfirmation);
}

/** Whether any session waits for confirmation: the red dot on the folder. */
export function anySessionAwaiting(sessions: readonly AssistantSession[]): boolean {
    return sessions.some(isSessionAwaiting);
}

/** The grey chip at the right of a session row: what became of its latest artifact. */
export function sessionChip(session: AssistantSession): "created" | "draft" | undefined {
    if (isSessionAwaiting(session)) return undefined;
    const latest = sessionArtifacts(session).at(-1);
    if (!latest) return undefined;
    if (latest.state === "finalized") return "created";
    if (latest.state === "draft") return "draft";
    return undefined;
}

export type SessionGroupKey = "pinned" | "today" | "yesterday" | "earlier";

export interface SessionGroup {
    key: SessionGroupKey;
    sessions: AssistantSession[];
}

/** Pinned on top, then "Today · Yesterday · Earlier", newest first; `query` matches the title and the preview. */
export function groupSessions(
    sessions: readonly AssistantSession[],
    now: number,
    query = "",
    onlyAwaiting = false,
): SessionGroup[] {
    const q = query.trim().toLocaleLowerCase();
    const today = startOfDay(now);
    const yesterday = today - DAY;
    const groups: Record<SessionGroupKey, AssistantSession[]> = { pinned: [], today: [], yesterday: [], earlier: [] };
    const sorted = [...sessions].sort((a, b) => b.lastActivityTs - a.lastActivityTs);
    for (const s of sorted) {
        if (q && !`${s.title} ${s.preview}`.toLocaleLowerCase().includes(q)) continue;
        if (onlyAwaiting && !isSessionAwaiting(s)) continue;
        if (s.pinned) groups.pinned.push(s);
        else if (s.lastActivityTs >= today) groups.today.push(s);
        else if (s.lastActivityTs >= yesterday) groups.yesterday.push(s);
        else groups.earlier.push(s);
    }
    return (["pinned", "today", "yesterday", "earlier"] as const)
        .filter((key) => groups[key].length > 0)
        .map((key) => ({ key, sessions: groups[key] }));
}

/** The title of a new session: its first phrase, at most 40 characters. */
export function titleFromFirstPhrase(text: string): string {
    const clean = text.replace(/\s+/g, " ").trim();
    const phrase = clean.split(/(?<=[.!?…])\s/)[0].replace(/[.!…]+$/, "");
    if (phrase.length <= 42) return phrase;
    const cut = phrase.slice(0, 40);
    const space = cut.lastIndexOf(" ");
    return `${(space > 24 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// --- The folder and what is open -----------------------------------------------------------------------------------

/**
 * The "Помощник" folder was picked in the space panel or the folder tabs. With `openSession` (wide windows) the main
 * area opens the session the user had open, or the newest one, as the mockup does; on a phone the list comes first.
 */
export function enterAssistantFolder(openSession: boolean): void {
    const s = store();
    s.setAssistantFolderActive(true);
    if (!openSession) return;
    if (s.openTarget?.kind === "assistant" && s.getSession(s.openTarget.id)) return;
    const last = lastOpenedSessionId ? s.getSession(lastOpenedSessionId) : undefined;
    const first = last ?? groupSessions(s.assistantSessions, Date.now())[0]?.sessions[0];
    if (first) openAssistantSession(first.id);
}

/** Another folder, a space or a room was picked: the folder closes, and with it the open session. */
export function leaveAssistantFolder(): void {
    const s = store();
    if (s.openTarget?.kind === "assistant") s.open(null);
    s.setAssistantFolderActive(false);
}

export function openAssistantSession(id: string): void {
    lastOpenedSessionId = id;
    store().setAssistantFolderActive(true);
    store().open({ kind: "assistant", id });
}

/** Back from a session to the list (phone layout). */
export function closeAssistantSession(toHomePage: boolean): void {
    store().open(null);
    // On a phone the main column slides in over the list whenever it holds a page other than the home page.
    if (toHomePage) dis.dispatch({ action: Action.ViewHomePage });
}

/** Forget the session the folder reopens (tests). */
export function resetAssistantNavigation(): void {
    lastOpenedSessionId = undefined;
    cancelAllReplies();
}

// --- Sessions ------------------------------------------------------------------------------------------------------

/** "Новый чат": an empty session at the top; its title becomes the first phrase. */
export function createAssistantSession(now = Date.now()): AssistantSession {
    const session: AssistantSession = {
        id: newId("new"),
        title: _t("insis_assistant|new_chat"),
        context: "",
        preview: "",
        lastActivityTs: now,
        messages: [],
    };
    store().putSession(session);
    openAssistantSession(session.id);
    return session;
}

export function renameAssistantSession(id: string, title: string): void {
    const clean = title.replace(/\s+/g, " ").trim();
    if (!clean) return;
    store().updateSession(id, (s) => (s.title === clean ? s : { ...s, title: clean }));
}

export function togglePinAssistantSession(id: string): void {
    store().updateSession(id, (s) => ({ ...s, pinned: !s.pinned }));
}

/** Delete a session; when it was open, the next one of the list opens (wide windows) or nothing. */
export function deleteAssistantSession(id: string, openNext: boolean): void {
    const s = store();
    const wasOpen = s.openTarget?.kind === "assistant" && s.openTarget.id === id;
    const order = groupSessions(s.assistantSessions, Date.now()).flatMap((g) => g.sessions);
    const index = order.findIndex((x) => x.id === id);
    cancelReply(id);
    s.deleteSession(id);
    if (lastOpenedSessionId === id) lastOpenedSessionId = undefined;
    if (!wasOpen || !openNext) return;
    const rest = order.filter((x) => x.id !== id);
    const next = rest[Math.min(Math.max(index, 0), rest.length - 1)];
    if (next) openAssistantSession(next.id);
}

// --- Artifacts -----------------------------------------------------------------------------------------------------

function updateArtifact(sessionId: string, artifactId: string, update: (a: Artifact) => Artifact): void {
    store().updateSession(sessionId, (s) => {
        const messages = s.messages.map((m) =>
            m.kind === "assistant" && m.artifact?.id === artifactId ? { ...m, artifact: update(m.artifact) } : m,
        );
        const next = { ...s, messages };
        const awaiting = sessionArtifacts(next).some((a) => a.state === "draft" && a.awaiting);
        return { ...next, awaitingConfirmation: awaiting };
    });
}

/**
 * The finalize button of an artifact ("Создать черновик", "Отправить"): `draft → finalized`. Each click carries its
 * own Idempotency-Key, kept on the artifact — the real call is `POST …/artifacts/{id}/finalize` of the `/v1`
 * copilot with that header. Returns the key.
 */
export function finalizeArtifact(sessionId: string, artifactId: string, now = Date.now()): string {
    const key = newIdempotencyKey();
    let result = "";
    updateArtifact(sessionId, artifactId, (a) => {
        result = a.resultText ?? _t("insis_assistant|artifact_created");
        return { ...a, state: "finalized", idempotencyKey: key };
    });
    store().updateSession(sessionId, (s) => ({ ...s, preview: result, lastActivityTs: now }));
    return key;
}

/** The discard button: `draft → discarded`, with its own Idempotency-Key. Returns the key. */
export function discardArtifact(sessionId: string, artifactId: string, now = Date.now()): string {
    const key = newIdempotencyKey();
    updateArtifact(sessionId, artifactId, (a) => ({ ...a, state: "discarded", idempotencyKey: key }));
    store().updateSession(sessionId, (s) => ({
        ...s,
        preview: _t("insis_assistant|artifact_discarded_preview"),
        lastActivityTs: now,
    }));
    return key;
}

// --- Sending and the canned reply ----------------------------------------------------------------------------------

/** The quick starts of an empty session (ADR-067 `copilotIntents`), with the canned reply of each. */
export const QUICK_STARTS = ["listing", "deal", "client", "task", "client_q"] as const;
export type QuickStart = (typeof QUICK_STARTS)[number];

export function quickStartLabel(q: QuickStart): string {
    switch (q) {
        case "listing":
            return _t("insis_assistant|quick_listing");
        case "deal":
            return _t("insis_assistant|quick_deal");
        case "client":
            return _t("insis_assistant|quick_client");
        case "task":
            return _t("insis_assistant|quick_task");
        case "client_q":
            return _t("insis_assistant|quick_client_q");
    }
}

function cannedReplyFor(text: string): { text: string; artifact?: Artifact } {
    const quick = QUICK_STARTS.find((q) => quickStartLabel(q) === text);
    switch (quick) {
        case "listing":
            return { text: _t("insis_assistant|reply_listing") };
        case "deal":
            return { text: _t("insis_assistant|reply_deal") };
        case "client":
            return { text: _t("insis_assistant|reply_client") };
        case "task":
            return { text: _t("insis_assistant|reply_task") };
        case "client_q":
            return { text: _t("insis_assistant|reply_client_q") };
    }
    return { text: _t("insis_assistant|reply_default") };
}

/** The canned reply to a suggestion: a draft of the action that waits for confirmation. */
function cannedActionReply(title: string, context: string): { text: string; artifact: Artifact } {
    return {
        text: _t("insis_assistant|reply_action"),
        artifact: {
            id: newId("art"),
            type: "confirmation",
            title,
            subtitle: context || _t("insis_assistant|no_client"),
            state: "draft",
            awaiting: true,
            fields: [],
            finalizeLabel: _t("insis_assistant|action_confirm"),
            secondaryLabel: _t("insis_assistant|action_edit"),
            portableMarkdown: `**${title}**`,
            insisUrl: "",
        },
    };
}

/** Timers of replies being typed out, by session. */
const replies = new Map<string, ReturnType<typeof setTimeout>[]>();

function cancelReply(sessionId: string): void {
    for (const t of replies.get(sessionId) ?? []) clearTimeout(t);
    replies.delete(sessionId);
}

function cancelAllReplies(): void {
    for (const id of Array.from(replies.keys())) cancelReply(id);
}

/** How long the canned reply takes to type out. */
export const REPLY_TYPING_MS = 1000;
const REPLY_DELAY_MS = 250;
const REPLY_STEPS = 20;

function streamReply(sessionId: string, reply: { text: string; artifact?: Artifact }): void {
    cancelReply(sessionId);
    const id = newId("a");
    const timers: ReturnType<typeof setTimeout>[] = [];
    const ts = Date.now();
    const write = (shown: string, done: boolean): void => {
        store().updateSession(sessionId, (s) => {
            const message: AssistantMessage = {
                kind: "assistant",
                id,
                ts,
                text: shown,
                streaming: !done,
                canned: true,
                ...(done && reply.artifact ? { artifact: reply.artifact } : {}),
            };
            const exists = s.messages.some((m) => m.id === id);
            const messages = exists ? s.messages.map((m) => (m.id === id ? message : m)) : [...s.messages, message];
            const next: AssistantSession = { ...s, messages };
            if (done && reply.artifact) {
                next.awaitingConfirmation = Boolean(reply.artifact.awaiting) || s.awaitingConfirmation;
                next.preview = _t("insis_assistant|preview_awaiting");
            } else if (done) {
                next.preview = reply.text;
            }
            return next;
        });
    };
    for (let i = 1; i <= REPLY_STEPS; i++) {
        const shown = reply.text.slice(0, Math.ceil((reply.text.length * i) / REPLY_STEPS));
        timers.push(
            setTimeout(() => write(shown, i === REPLY_STEPS), REPLY_DELAY_MS + (REPLY_TYPING_MS * i) / REPLY_STEPS),
        );
    }
    timers.push(setTimeout(() => replies.delete(sessionId), REPLY_DELAY_MS + REPLY_TYPING_MS + 1));
    replies.set(sessionId, timers);
}

/**
 * Send the broker's text (typed, or the transcript of a voice message) to the session, then type out a canned reply
 * over about a second. The first phrase of an empty session becomes its title.
 */
export function sendToAssistant(
    sessionId: string,
    text: string,
    opts: { voiceDurationSec?: number; file?: { name: string; size: string }; now?: number } = {},
): void {
    const clean = text.trim();
    if (!clean && !opts.file) return;
    const now = opts.now ?? Date.now();
    const s = store().getSession(sessionId);
    if (!s) return;
    const message: AssistantMessage = {
        kind: "user",
        id: newId("u"),
        ts: now,
        text: clean,
        ...(opts.voiceDurationSec !== undefined ? { voice: { durationSec: opts.voiceDurationSec } } : {}),
        ...(opts.file ? { file: opts.file } : {}),
    };
    const first = s.messages.length === 0 && Boolean(clean);
    store().updateSession(sessionId, (x) => ({
        ...x,
        title: first ? titleFromFirstPhrase(clean) : x.title,
        preview: clean || opts.file!.name,
        lastActivityTs: now,
        messages: [...x.messages, message],
    }));
    streamReply(sessionId, clean ? cannedReplyFor(clean) : { text: _t("insis_assistant|reply_file") });
}

/** A suggestion of "Помощник предлагает" was picked: its prompt is sent, the reply is a draft to confirm. */
export function pickSuggestion(sessionId: string, title: string, prompt: string, now = Date.now()): void {
    const s = store().getSession(sessionId);
    if (!s) return;
    store().updateSession(sessionId, (x) => ({
        ...x,
        preview: prompt,
        lastActivityTs: now,
        messages: [...x.messages, { kind: "user", id: newId("u"), ts: now, text: prompt }],
    }));
    streamReply(sessionId, cannedActionReply(title, s.context));
}
