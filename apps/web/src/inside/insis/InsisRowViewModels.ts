/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    BaseViewModel,
    RoomNotifState,
    type RoomListItemViewActions,
    type RoomListItemViewSnapshot,
} from "@element-hq/web-shared-components";

import { _t } from "../../languageHandler";
import { formatFullDate, formatRoomListTimestamp } from "../../DateUtils";
import SettingsStore from "../../settings/SettingsStore";
import { InsisPreviewStore, InsisStoreEvent } from "./InsisPreviewStore";
import type { AssistantSession, ClientConversation, ClientMessageAuthor, ClientTimelineItem } from "./model";
import { assistantRowId, clientRowId } from "./roomListRows";

/** Inside: what the room list draws as the avatar of an INSIS row, in place of a Matrix `Room`. */
export class InsisRowAvatar {
    public constructor(
        public readonly kind: "client" | "assistant",
        public readonly initials: string = "",
        public readonly color?: string,
        public readonly online = false,
    ) {}
}

const NO_NOTIFICATION: RoomListItemViewSnapshot["notification"] = {
    hasAnyNotificationOrActivity: false,
    isUnsentMessage: false,
    invited: false,
    isMention: false,
    isActivityNotification: false,
    isNotification: false,
    hasUnreadCount: false,
    count: 0,
    muted: false,
};

/** Fields of a row snapshot that INSIS rows do not use: no menus, no sections. */
const STATIC_FIELDS = {
    showMoreOptionsMenu: false,
    showNotificationMenu: false,
    isFavourite: false,
    isLowPriority: false,
    isDm: true,
    canInvite: false,
    canCopyRoomLink: false,
    canMarkAsRead: false,
    canMarkAsUnread: false,
    roomNotifState: RoomNotifState.AllMessages,
    sections: [],
    areSectionsEnabled: false,
    canChangeSection: false,
} satisfies Partial<RoomListItemViewSnapshot>;

function timestamps(ts: number): Pick<RoomListItemViewSnapshot, "timestamp" | "timestampTitle"> {
    if (!ts) return {};
    const showTwelveHour = SettingsStore.getValue("showTwelveHourTimestamps");
    return {
        timestamp: formatRoomListTimestamp(new Date(ts), showTwelveHour),
        timestampTitle: formatFullDate(new Date(ts), showTwelveHour),
    };
}

/** Who wrote a message, for the preview line of the row and the label over others' outgoing messages. */
export function authorLabel(author: ClientMessageAuthor): string | undefined {
    switch (author.kind) {
        case "client":
            return undefined;
        case "me":
            return _t("inside_clients|author_you");
        case "colleague":
            return author.displayName;
        case "ai_agent":
            return _t("inside_clients|author_ai_agent");
        case "automation":
            return _t("inside_clients|author_automation");
    }
}

/** The text of a timeline item for previews: its text, else its attachment, else the system line. */
export function previewOf(item: ClientTimelineItem): string {
    switch (item.kind) {
        case "message":
            return item.text || item.attachment?.title || "";
        case "system":
            return item.text;
        case "assignment_changed":
            return _t("inside_clients|transferred", {
                from: item.from,
                to: item.to === "me" ? _t("inside_clients|transferred_to_you") : item.to,
            });
    }
}

/** The snapshot of the row of a client conversation. */
export function clientRowSnapshot(conversation: ClientConversation): RoomListItemViewSnapshot {
    const last =
        [...conversation.timeline].reverse().find((item) => item.kind === "message") ?? conversation.timeline.at(-1);
    const lastMessage = last?.kind === "message" ? last : undefined;
    const ownSide = lastMessage && lastMessage.author.kind !== "client";
    const unread = conversation.unread;
    const failed = lastMessage?.delivery === "failed";
    let lastMessageStatus: RoomListItemViewSnapshot["lastMessageStatus"];
    if (ownSide && lastMessage?.delivery && !failed) {
        lastMessageStatus = lastMessage.delivery === "read" || lastMessage.delivery === "delivered" ? "read" : "sent";
    }
    return {
        ...STATIC_FIELDS,
        id: clientRowId(conversation.id),
        room: new InsisRowAvatar("client", conversation.initials, conversation.avatarColor, !!conversation.online),
        name: conversation.displayName,
        insideChip: _t("inside_clients|chip_client"),
        isBold: unread > 0,
        messagePreview: last ? previewOf(last) : undefined,
        messagePreviewSender: ownSide && lastMessage ? authorLabel(lastMessage.author) : undefined,
        ...timestamps(conversation.lastActivityTs),
        lastMessageStatus,
        notification:
            unread > 0 || failed
                ? {
                      ...NO_NOTIFICATION,
                      hasAnyNotificationOrActivity: true,
                      isUnsentMessage: failed,
                      isNotification: unread > 0,
                      hasUnreadCount: unread > 0,
                      count: unread,
                  }
                : NO_NOTIFICATION,
    };
}

/** The snapshot of the pinned row of an assistant session that waits for a confirmation. */
export function assistantRowSnapshot(session: AssistantSession): RoomListItemViewSnapshot {
    const listingDraft = session.messages.some(
        (m) => m.kind === "assistant" && m.artifact?.type === "listing_draft" && m.artifact.state === "draft",
    );
    const preview = listingDraft
        ? _t("inside_clients|assistant_listing_awaiting")
        : _t("inside_clients|assistant_awaiting");
    return {
        ...STATIC_FIELDS,
        isDm: false,
        id: assistantRowId(session.id),
        room: new InsisRowAvatar("assistant"),
        name: session.title,
        isBold: true,
        messagePreview: preview,
        ...timestamps(session.lastActivityTs),
        notification: { ...NO_NOTIFICATION, hasAnyNotificationOrActivity: true, isNotification: true },
    };
}

abstract class InsisRowViewModel
    extends BaseViewModel<RoomListItemViewSnapshot, { id: string }>
    implements RoomListItemViewActions
{
    protected constructor(id: string, snapshot: RoomListItemViewSnapshot) {
        super({ id }, snapshot);
        const store = InsisPreviewStore.instance;
        this.disposables.trackListener(store, InsisStoreEvent.Changed, this.update);
    }

    /** The id of the row in the room list. */
    public get roomId(): string {
        return this.snapshot.current.id;
    }

    protected abstract makeSnapshot(): RoomListItemViewSnapshot | undefined;

    private readonly update = (): void => {
        const next = this.makeSnapshot();
        if (next) this.snapshot.set(next);
    };

    public abstract onOpenRoom: () => void;

    // INSIS rows have no menus.
    public onMarkAsRead = (): void => {};
    public onMarkAsUnread = (): void => {};
    public onToggleFavorite = (): void => {};
    public onToggleLowPriority = (): void => {};
    public onInvite = (): void => {};
    public onCopyRoomLink = (): void => {};
    public onLeaveRoom = (): void => {};
    public onSetRoomNotifState = (): void => {};
    public onCreateSection = (): void => {};
    public onToggleSection = (): void => {};
    public onRemoveFromSection = (): void => {};
}

/** Inside: the room list row of a client conversation; opening it shows the client chat in the main area. */
export class ClientRowViewModel extends InsisRowViewModel {
    public constructor(private readonly conversationId: string) {
        super(clientRowId(conversationId), ClientRowViewModel.snapshotOf(conversationId));
    }

    private static snapshotOf(conversationId: string): RoomListItemViewSnapshot {
        const conversation = InsisPreviewStore.instance.getConversation(conversationId);
        if (!conversation) throw new Error(`No client conversation ${conversationId}`);
        return clientRowSnapshot(conversation);
    }

    protected makeSnapshot(): RoomListItemViewSnapshot | undefined {
        const conversation = InsisPreviewStore.instance.getConversation(this.conversationId);
        return conversation && clientRowSnapshot(conversation);
    }

    public onOpenRoom = (): void => {
        InsisPreviewStore.instance.open({ kind: "client", id: this.conversationId });
    };
}

/** Inside: the pinned row of an assistant session waiting for a confirmation; opens it in the "Помощник" folder. */
export class AssistantRowViewModel extends InsisRowViewModel {
    public constructor(private readonly sessionId: string) {
        super(assistantRowId(sessionId), AssistantRowViewModel.snapshotOf(sessionId));
    }

    private static snapshotOf(sessionId: string): RoomListItemViewSnapshot {
        const session = InsisPreviewStore.instance.getSession(sessionId);
        if (!session) throw new Error(`No assistant session ${sessionId}`);
        return assistantRowSnapshot(session);
    }

    protected makeSnapshot(): RoomListItemViewSnapshot | undefined {
        const session = InsisPreviewStore.instance.getSession(this.sessionId);
        return session && assistantRowSnapshot(session);
    }

    public onOpenRoom = (): void => {
        const store = InsisPreviewStore.instance;
        store.setAssistantFolderActive(true);
        store.open({ kind: "assistant", id: this.sessionId });
    };
}
