/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Inside: the data Lobby shows from INSIS — client conversations (`comm`), the lead card of a client, and the
 * sessions of the INSIS Copilot ("Помощник"). None of it lives in Matrix (ADR-069 К-1): it comes from the INSIS
 * API `/v1` with the viewer's token and is kept in memory only.
 *
 * PREVIEW MODEL. INSIS has not published its OpenAPI yet (`openapi/v1.json`), so these types follow the screens
 * of the mockup (`docs/prototypes/lobby/variants/` in balakirev/insis), not the API. When the OpenAPI is out, the
 * client is generated from it and these types become a thin mapping of the generated ones; field names here are
 * deliberately plain and are not a contract.
 */

/** Messenger channel of a client conversation, as `comm` names them. */
export type ClientChannel = "whatsapp" | "telegram" | "instagram";

/** Who wrote a message of a client conversation. */
export type ClientMessageAuthor =
    | { kind: "client" }
    /** The viewer. */
    | { kind: "me"; fromPhone?: boolean }
    /** A colleague — the previous assignee or another member of the team. */
    | { kind: "colleague"; displayName: string; fromPhone?: boolean }
    | { kind: "ai_agent" }
    | { kind: "automation" };

export type DeliveryState = "sending" | "sent" | "delivered" | "read" | "failed";

export interface ClientMessageAttachment {
    kind: "file" | "image" | "listing";
    title: string;
    subtitle?: string;
    /** For a listing link — the site the card comes from, e.g. "insiderealty.ae". */
    site?: string;
}

export type ClientTimelineItem =
    | {
          kind: "message";
          id: string;
          ts: number;
          author: ClientMessageAuthor;
          text?: string;
          attachment?: ClientMessageAttachment;
          /** Reply to an earlier message: the author's name and the start of its text. */
          replyTo?: { author: string; text: string };
          reactions?: { key: string; count: number }[];
          delivery?: DeliveryState;
          /** Reason shown under a failed message. */
          failReason?: string;
          /** Sent as an approved template of the channel (outside the service window): its name. */
          templateName?: string;
      }
    /** "Передано: Анна Петрова → вам · 14 окт"; `to` is "me" when the viewer got the conversation. */
    | { kind: "assignment_changed"; id: string; ts: number; from: string; to: string }
    /** A system line, e.g. "Амир создал показ в Insis · чт, 30 окт, 16:30". */
    | { kind: "system"; id: string; ts: number; text: string; icon?: "calendar" | "info" | "lead" };

export interface ClientConversation {
    id: string;
    displayName: string;
    initials: string;
    /** Avatar colour, a CSS colour. */
    avatarColor: string;
    online?: boolean;
    channel: ClientChannel;
    phone: string;
    /** "в сети · брокер Амир Х." under the name in the chat header. */
    subtitle: string;
    /** Stage chip of the request, e.g. "Показ назначен". */
    stage: string;
    unread: number;
    muted?: boolean;
    /** Last activity, ms since epoch; the "All" folder merges conversations and rooms by it. */
    lastActivityTs: number;
    /** The service window of the channel (WABA 24 h) closes at this time; absent — the channel has none. */
    serviceWindowUntil?: number;
    /** The client's local time zone, IANA name: "у клиента сейчас 18:40". */
    clientTimeZone?: string;
    leadId: string;
    timeline: ClientTimelineItem[];
    /**
     * The lead came through "Ждут приёма": "pending" — assigned to the viewer but not accepted yet ("Принять" and
     * "Вернуть в очередь" in the card); "accepted" — just accepted, can still go back to the queue. Absent — neither.
     */
    queue?: "pending" | "accepted";
}

/** An approved template of the channel, the only thing that can be sent outside the service window. */
export interface ClientTemplate {
    id: string;
    name: string;
    /** Language of the template, e.g. "ru", "en". */
    language: string;
    /** Body with `{{name}}` for the client's first name. */
    body: string;
}

/** The queue of leads assigned to the viewer and not accepted yet ("Ждут приёма · N"): only the number and the age. */
export interface WaitingQueue {
    count: number;
    /** When the oldest of them was assigned, ms since epoch. */
    oldestSince?: number;
}

/** A next step the assistant suggests for a lead, with why. */
export interface AssistantSuggestion {
    id: string;
    title: string;
    reason: string;
    /** Text sent to the assistant when the broker picks the suggestion. */
    prompt: string;
}

export interface LeadListing {
    id: string;
    title: string;
    subtitle: string;
    price: string;
    /** "Понравился", "Отправлен", "Показ чт 16:30". */
    status?: string;
    /** Status chips: "key" — filled, "signal" — red outline (the client liked it). */
    tags?: { label: string; tone?: "key" | "signal" }[];
    /** Thumbnail background, a CSS background value. */
    thumb?: string;
}

export interface LeadJourneyStep {
    id: string;
    ts: number;
    title: string;
    detail?: string;
    done: boolean;
}

export interface LeadFile {
    id: string;
    name: string;
    size: string;
    ts: number;
    /** Seconds the client spent on each page of a tracked PDF; the longest is highlighted. */
    pageSeconds?: number[];
    /** "Просмотрено 3 мин · дольше всего стр. 3 (Collective 2.0)". */
    viewSummary?: string;
}

/** The lead card of a client conversation — read only (ADR-069 Amendment 2026-10-30, iter-68 ЛБ-8). */
export interface LeadCard {
    conversationId: string;
    leadId: string;
    /** Stage of the request and its position: "Показ назначен", 3 of 5. */
    stage: string;
    stageIndex: number;
    stageCount: number;
    budget: string;
    source: string;
    campaign?: string;
    broker: string;
    wants: string[];
    nextStep?: { title: string; when: string };
    suggestions: AssistantSuggestion[];
    listings: LeadListing[];
    journey: LeadJourneyStep[];
    files: LeadFile[];
    /** Deep link into INSIS. */
    insisUrl: string;
}

/** Copilot artifact types Lobby draws natively; anything else is shown as its portable Markdown. */
export type ArtifactType = "listing_draft" | "deal_draft" | "contact" | "task" | "confirmation";

export type ArtifactState = "draft" | "finalized" | "discarded";

export interface ArtifactField {
    label: string;
    value: string;
    /** Where the value came from: "голос", "справочник". */
    source?: string;
}

export interface Artifact {
    id: string;
    /** A type Lobby does not know is drawn from `portableMarkdown`. */
    type: ArtifactType | string;
    title: string;
    subtitle?: string;
    state: ArtifactState;
    fields: ArtifactField[];
    /** "Не хватает: этаж, номер разрешения". */
    missing?: string[];
    /** Label of the finalize button: "Создать черновик", "Отправить", "Подтвердить". */
    finalizeLabel: string;
    /** A critical action needs a human confirmation (ADR-034 artifact gate). */
    critical?: boolean;
    portableMarkdown: string;
    insisUrl: string;
}

export type AssistantMessage =
    | { kind: "user"; id: string; ts: number; text: string; voice?: { durationSec: number } }
    | { kind: "assistant"; id: string; ts: number; text: string; artifact?: Artifact; streaming?: boolean };

export interface AssistantSession {
    id: string;
    title: string;
    /** "без клиента", "Алина Касымова". */
    context: string;
    clientConversationId?: string;
    preview: string;
    /** A small grey chip at the right of the row: "создано", "черновик". */
    chip?: string;
    lastActivityTs: number;
    pinned?: boolean;
    /** An artifact of the session waits for the broker's confirmation (red dot, pinned row in "All chats"). */
    awaitingConfirmation?: boolean;
    messages: AssistantMessage[];
}
