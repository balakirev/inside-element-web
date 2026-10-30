/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { TypedEventEmitter } from "matrix-js-sdk/src/matrix";

import dis from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import type { ActionPayload } from "../../dispatcher/payloads";
import type {
    AssistantSession,
    ClientConversation,
    ClientTemplate,
    ClientTimelineItem,
    DeliveryState,
    LeadCard,
    WaitingQueue,
} from "./model";
import {
    makeClientConversations,
    makeClientTemplates,
    makeLeadCards,
    makeQueuedConversations,
    makeWaitingQueue,
} from "./fixtures-clients";
import { makeAssistantSessions } from "./fixtures-assistant";

export enum InsisStoreEvent {
    /** Anything changed: data, the open item or the assistant folder. */
    Changed = "inside_insis_changed",
}

type HandlerMap = {
    [InsisStoreEvent.Changed]: () => void;
};

/** What the main area shows instead of a Matrix room. */
export type InsisOpenTarget = { kind: "client"; id: string } | { kind: "assistant"; id: string };

/**
 * Inside: the INSIS side of Lobby in one place — client conversations, lead cards, assistant sessions, what is open
 * in the main area and whether the "Помощник" folder is active. On test data for now (`isInsisPreviewUser`); when
 * INSIS publishes its API this store loads the same shapes from `/v1` and the screens stay as they are.
 *
 * Opening a Matrix room (Action.ViewRoom) closes whatever INSIS item was open, so the main area always shows the
 * last thing the user picked.
 */
export class InsisPreviewStore extends TypedEventEmitter<InsisStoreEvent, HandlerMap> {
    private static internalInstance?: InsisPreviewStore;

    public static get instance(): InsisPreviewStore {
        InsisPreviewStore.internalInstance ??= new InsisPreviewStore();
        return InsisPreviewStore.internalInstance;
    }

    /** Replace the singleton — tests only. */
    public static resetInstance(): void {
        InsisPreviewStore.internalInstance?.dispose();
        InsisPreviewStore.internalInstance = undefined;
    }

    private conversations: ClientConversation[];
    private leadCards: Record<string, LeadCard>;
    private sessions: AssistantSession[];
    private target: InsisOpenTarget | null = null;
    private assistantFolder = false;
    /** Bumped on every change, so hooks can use it as a snapshot. */
    private revision = 0;
    private readonly dispatcherRef: string;
    private queuedConversations: ClientConversation[];
    private queue: WaitingQueue;
    private readonly templates: ClientTemplate[];
    private readonly timers = new Set<ReturnType<typeof setTimeout>>();

    public constructor(now = Date.now()) {
        super();
        this.conversations = makeClientConversations(now);
        this.leadCards = makeLeadCards(now);
        this.queuedConversations = makeQueuedConversations(now);
        this.queue = makeWaitingQueue(now);
        this.templates = makeClientTemplates();
        this.sessions = makeAssistantSessions(now);
        this.dispatcherRef = dis.register(this.onAction);
    }

    public dispose(): void {
        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
        dis.unregister(this.dispatcherRef);
        this.removeAllListeners();
    }

    private onAction = (payload: ActionPayload): void => {
        if (payload.action === Action.ViewRoom && this.target) {
            this.target = null;
            this.changed();
        }
    };

    private changed(): void {
        this.revision++;
        this.emit(InsisStoreEvent.Changed);
    }

    public get version(): number {
        return this.revision;
    }

    // --- What is open -------------------------------------------------------------------------------------------

    public get openTarget(): InsisOpenTarget | null {
        return this.target;
    }

    public open(target: InsisOpenTarget | null): void {
        if (this.target?.kind === target?.kind && this.target?.id === target?.id) return;
        this.target = target;
        if (target?.kind === "client") this.markRead(target.id);
        this.changed();
    }

    /** The "Помощник" folder of the space panel is active: the room list column shows the assistant's sessions. */
    public get isAssistantFolderActive(): boolean {
        return this.assistantFolder;
    }

    public setAssistantFolderActive(active: boolean): void {
        if (this.assistantFolder === active) return;
        this.assistantFolder = active;
        this.changed();
    }

    // --- Client conversations -----------------------------------------------------------------------------------

    public get clientConversations(): readonly ClientConversation[] {
        return this.conversations;
    }

    public getConversation(id: string): ClientConversation | undefined {
        return this.conversations.find((c) => c.id === id);
    }

    public getLeadCard(conversationId: string): LeadCard | undefined {
        return this.leadCards[conversationId];
    }

    public updateConversation(id: string, update: (c: ClientConversation) => ClientConversation): void {
        this.conversations = this.conversations.map((c) => (c.id === id ? update(c) : c));
        this.changed();
    }

    private markRead(id: string): void {
        this.conversations = this.conversations.map((c) => (c.id === id && c.unread ? { ...c, unread: 0 } : c));
    }

    /** "Ждут приёма · N": leads assigned to the viewer and not accepted yet — only their number and age. */
    public get waitingQueue(): WaitingQueue {
        return this.queue;
    }

    /** Approved templates of the channel, for sending outside the service window. */
    public get clientTemplates(): readonly ClientTemplate[] {
        return this.templates;
    }

    /**
     * "Принять следующий" (iter-58 `accept-next`): the next lead of the queue becomes the viewer's conversation and
     * opens. Returns the conversation, or undefined when the queue is empty.
     */
    public acceptNext(now = Date.now()): ClientConversation | undefined {
        if (this.queue.count <= 0) return undefined;
        const [next, ...rest] = this.queuedConversations;
        const count = this.queue.count - 1;
        this.queue = { count, oldestSince: count > 0 ? this.queue.oldestSince : undefined };
        this.queuedConversations = rest;
        if (!next) {
            this.changed();
            return undefined;
        }
        const accepted: ClientConversation = {
            ...next,
            queue: "accepted",
            lastActivityTs: Math.min(next.lastActivityTs, now),
        };
        this.conversations = [accepted, ...this.conversations.filter((c) => c.id !== accepted.id)];
        this.target = { kind: "client", id: accepted.id };
        this.markRead(accepted.id);
        this.changed();
        return accepted;
    }

    /** "Принять" on a lead assigned to the viewer. */
    public acceptConversation(id: string): void {
        this.updateConversation(id, (c) => ({ ...c, queue: "accepted" }));
    }

    /** "Вернуть в очередь": the conversation leaves the viewer's list and the queue grows by one. */
    public returnToQueue(id: string, now = Date.now()): void {
        const conversation = this.getConversation(id);
        if (!conversation) return;
        this.conversations = this.conversations.filter((c) => c.id !== id);
        this.queuedConversations = [{ ...conversation, queue: undefined }, ...this.queuedConversations];
        this.queue = { count: this.queue.count + 1, oldestSince: Math.min(this.queue.oldestSince ?? now, now) };
        if (this.target?.kind === "client" && this.target.id === id) this.target = null;
        this.changed();
    }

    /**
     * Send a message to the client — locally only on test data: it is appended with "sending" and goes on to "sent"
     * and "delivered", as `comm` statuses would come.
     */
    public sendClientMessage(
        conversationId: string,
        text: string,
        options: { templateName?: string } = {},
        now = Date.now(),
    ): string | undefined {
        const body = text.trim();
        if (!body || !this.getConversation(conversationId)) return undefined;
        const id = `local-${now}-${Math.random().toString(36).slice(2, 8)}`;
        const item: ClientTimelineItem = {
            kind: "message",
            id,
            ts: now,
            author: { kind: "me" },
            text: body,
            delivery: "sending",
            templateName: options.templateName,
        };
        this.updateConversation(conversationId, (c) => ({
            ...c,
            timeline: [...c.timeline, item],
            lastActivityTs: Math.max(c.lastActivityTs, now),
        }));
        this.later(600, () => this.setDelivery(conversationId, id, "sent"));
        this.later(1800, () => this.setDelivery(conversationId, id, "delivered"));
        return id;
    }

    private setDelivery(conversationId: string, messageId: string, delivery: DeliveryState): void {
        this.updateConversation(conversationId, (c) => ({
            ...c,
            timeline: c.timeline.map((item) =>
                item.kind === "message" && item.id === messageId ? { ...item, delivery } : item,
            ),
        }));
    }

    private later(ms: number, fn: () => void): void {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            fn();
        }, ms);
        this.timers.add(timer);
    }

    // --- Assistant sessions -------------------------------------------------------------------------------------

    public get assistantSessions(): readonly AssistantSession[] {
        return this.sessions;
    }

    public getSession(id: string): AssistantSession | undefined {
        return this.sessions.find((s) => s.id === id);
    }

    /** Add a session at the top, or replace the one with the same id. */
    public putSession(session: AssistantSession): void {
        const rest = this.sessions.filter((s) => s.id !== session.id);
        this.sessions = [session, ...rest];
        this.changed();
    }

    public updateSession(id: string, update: (s: AssistantSession) => AssistantSession): void {
        this.sessions = this.sessions.map((s) => (s.id === id ? update(s) : s));
        this.changed();
    }

    /**
     * "Спросить помощника" from a client's lead card: open the assistant folder on the client's session — the latest
     * one about this client, or a new empty one with the client in its context.
     */
    public openAssistantForClient(conversationId: string, now = Date.now()): AssistantSession {
        const conversation = this.getConversation(conversationId);
        let session = this.sessions.find((s) => s.clientConversationId === conversationId);
        if (!session) {
            session = {
                id: `client-${conversationId}-${now}`,
                title: conversation ? `Что по клиенту: ${conversation.displayName}` : "Что по клиенту",
                context: conversation?.displayName ?? "",
                clientConversationId: conversationId,
                preview: "",
                lastActivityTs: now,
                messages: [],
            };
            this.sessions = [session, ...this.sessions];
        }
        this.assistantFolder = true;
        this.target = { kind: "assistant", id: session.id };
        this.changed();
        return session;
    }

    /**
     * A suggestion of the lead card ("Помощник предлагает"): open the assistant on the client's session and put the
     * suggestion's prompt into it as the broker's message.
     */
    public askAssistantForClient(conversationId: string, prompt: string, now = Date.now()): AssistantSession {
        const session = this.openAssistantForClient(conversationId, now);
        const text = prompt.trim();
        if (!text) return session;
        this.updateSession(session.id, (s) => ({
            ...s,
            preview: text,
            lastActivityTs: now,
            messages: [...s.messages, { kind: "user", id: `ask-${now}`, ts: now, text }],
        }));
        return this.getSession(session.id) ?? session;
    }

    public deleteSession(id: string): void {
        this.sessions = this.sessions.filter((s) => s.id !== id);
        if (this.target?.kind === "assistant" && this.target.id === id) this.target = null;
        this.changed();
    }
}
