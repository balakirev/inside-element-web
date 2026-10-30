/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { TypedEventEmitter } from "matrix-js-sdk/src/matrix";

import dis from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import type { ActionPayload } from "../../dispatcher/payloads";
import type { AssistantSession, ClientConversation, LeadCard } from "./model";
import { makeClientConversations, makeLeadCards } from "./fixtures-clients";
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

    public constructor(now = Date.now()) {
        super();
        this.conversations = makeClientConversations(now);
        this.leadCards = makeLeadCards(now);
        this.sessions = makeAssistantSessions(now);
        this.dispatcherRef = dis.register(this.onAction);
    }

    public dispose(): void {
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

    public deleteSession(id: string): void {
        this.sessions = this.sessions.filter((s) => s.id !== id);
        if (this.target?.kind === "assistant" && this.target.id === id) this.target = null;
        this.changed();
    }
}
