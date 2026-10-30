/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import classNames from "classnames";

import { _t } from "../../../../languageHandler";
import dis from "../../../../dispatcher/dispatcher";
import { Action } from "../../../../dispatcher/actions";
import { useInsideLayout, prefersReducedMotion } from "../../../../utils/InsideLayout";
import { INSIDE_COLUMN_TRANSITION_MS, LEAVING_CLASS } from "../../../../utils/InsideMobileNavigation";
import { useInsisStore } from "../../useInsis";
import type { ClientTimelineItem } from "../../model";
import { ClientAvatar } from "./ClientAvatar";
import { ClientTimeline } from "./ClientTimeline";
import { ClientComposer } from "./ClientComposer";
import { LeadCardPanel, type LeadCardTab } from "./LeadCardPanel";
import { InsisIcon } from "./icons";
import { useNow } from "./useNow";
import UIStore from "../../../../stores/UIStore";

/** Distance from the bottom, px, from which "Вниз" shows. */
const JUMP_THRESHOLD = 160;
const NOTICE_MS = 4000;
/** From this window width the card stays open next to the chat, as in the mockup; narrower it lies over it. */
const WIDE_WINDOW = 1400;

/** Whether the card was open in the last client chat: it stays so in the next one. */
let rememberedCardOpen: boolean | undefined;

function matches(item: ClientTimelineItem, query: string): boolean {
    if (item.kind !== "message") return false;
    const text = [item.text, item.attachment?.title, item.attachment?.subtitle].filter(Boolean).join(" ");
    return text.toLocaleLowerCase().includes(query);
}

interface Props {
    conversationId: string;
    /** Tests: a fixed "now". */
    now?: number;
    /** Tests and screenshots: the card open on this tab. */
    initialCardTab?: LeadCardTab;
    initialCardOpen?: boolean;
}

/**
 * Inside: a client conversation of INSIS in the main area (ADR-069 § 3): the header capsule as in rooms, the
 * timeline with the bubbles of the skin, the composer by the rules of the channel and the lead card — a right
 * panel, or a bottom sheet on a phone. Test data only (`isInsisPreviewUser`); nothing goes to Matrix (К-1).
 */
export function ClientChatView({ conversationId, now: fixedNow, initialCardTab, initialCardOpen }: Props): JSX.Element {
    const store = useInsisStore();
    const conversation = store.getConversation(conversationId);
    const card = store.getLeadCard(conversationId);
    const now = useNow(30 * 1000, fixedNow);
    const mobile = useInsideLayout() === "mobile";

    const [cardOpen, setCardOpenState] = useState<boolean>(
        () => initialCardOpen ?? (mobile ? false : (rememberedCardOpen ?? UIStore.instance.windowWidth >= WIDE_WINDOW)),
    );
    const setCardOpen = useCallback((open: boolean) => {
        rememberedCardOpen = open;
        setCardOpenState(open);
    }, []);
    const [searching, setSearching] = useState(false);
    const [query, setQuery] = useState("");
    const [menu, setMenu] = useState(false);
    const [notice, setNotice] = useState<string | undefined>();
    const [jump, setJump] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const atBottom = useRef(true);

    const timeline = conversation?.timeline ?? [];
    const q = query.trim().toLocaleLowerCase();
    const items = searching && q ? timeline.filter((item) => matches(item, q)) : timeline;

    const scrollToBottom = useCallback((smooth = false) => {
        const el = scrollRef.current;
        if (!el) return;
        if (smooth && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        else el.scrollTop = el.scrollHeight;
    }, []);

    // Open at the bottom; stay there when a message comes while at the bottom.
    useLayoutEffect(() => {
        if (atBottom.current) scrollToBottom();
    }, [timeline.length, scrollToBottom]);

    useEffect(() => {
        if (!notice) return;
        const timer = setTimeout(() => setNotice(undefined), NOTICE_MS);
        return () => clearTimeout(timer);
    }, [notice]);

    const onScroll = (): void => {
        const el = scrollRef.current;
        if (!el) return;
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        atBottom.current = distance < 40;
        setJump(distance > JUMP_THRESHOLD);
    };

    if (!conversation) {
        return (
            <div className="mx_InsisClientChat mx_InsisClientChat_gone">
                <div className="mx_InsisPill">{_t("inside_clients|conversation_gone")}</div>
            </div>
        );
    }

    const openInInsis = (): void => {
        if (card?.insisUrl) window.open(card.insisUrl, "_blank", "noopener,noreferrer");
        setMenu(false);
    };
    const call = (): void => {
        setNotice(_t("inside_clients|calls_later"));
        setMenu(false);
    };
    const back = (): void => {
        const done = (): void => {
            store.open(null);
            dis.dispatch({ action: Action.ViewHomePage });
        };
        const column = rootRef.current?.closest(".mx_RoomView_wrapper");
        if (!column || prefersReducedMotion()) {
            done();
            return;
        }
        column.classList.add(LEAVING_CLASS);
        window.setTimeout(() => {
            done();
            window.setTimeout(() => column.classList.remove(LEAVING_CLASS), 150);
        }, INSIDE_COLUMN_TRANSITION_MS);
    };

    const cardActions = {
        onClose: () => setCardOpen(false),
        onCall: call,
        onSuggestion: (prompt: string) => store.askAssistantForClient(conversation.id, prompt),
        onAskAssistant: () => store.openAssistantForClient(conversation.id),
        onOpenInInsis: openInInsis,
        onAccept: () => store.acceptConversation(conversation.id),
        onReturnToQueue: () => store.returnToQueue(conversation.id),
    };

    return (
        <div
            ref={rootRef}
            className={classNames("mx_InsisClientChat", {
                mx_InsisClientChat_withCard: cardOpen && !mobile,
                mx_InsisClientChat_mobile: mobile,
            })}
        >
            <section
                className="mx_InsisClientChat_main"
                aria-label={_t("inside_clients|chat_with", { name: conversation.displayName })}
            >
                <header className="mx_InsisClientChat_header">
                    <div className="mx_InsisClientChat_capsule mx_InsisGlass">
                        {mobile && (
                            <button
                                type="button"
                                className="mx_InsisIconButton mx_InsisClientChat_back"
                                aria-label={_t("inside_clients|back")}
                                onClick={back}
                            >
                                <InsisIcon name="back" />
                            </button>
                        )}
                        {searching ? (
                            <input
                                className="mx_InsisClientChat_search"
                                autoFocus
                                value={query}
                                placeholder={_t("inside_clients|search_placeholder")}
                                aria-label={_t("inside_clients|search_placeholder")}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Escape") {
                                        setSearching(false);
                                        setQuery("");
                                    }
                                }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="mx_InsisClientChat_who"
                                aria-expanded={cardOpen}
                                data-testid="insis-chat-who"
                                onClick={() => setCardOpen(!cardOpen)}
                            >
                                <ClientAvatar
                                    initials={conversation.initials}
                                    color={conversation.avatarColor}
                                    online={conversation.online}
                                />
                                <span className="mx_InsisClientChat_whoText">
                                    <b>
                                        <span className="mx_InsisClientChat_name">{conversation.displayName}</span>
                                        <span className="mx_RoomListItemView_inside_chip">
                                            {_t("inside_clients|chip_client")}
                                        </span>
                                    </b>
                                    <span>{conversation.subtitle}</span>
                                </span>
                            </button>
                        )}
                    </div>
                    <div className="mx_InsisClientChat_buttons mx_InsisGlass">
                        {!mobile && (
                            <button
                                type="button"
                                className={classNames("mx_InsisIconButton", { mx_InsisIconButton_on: searching })}
                                aria-label={_t("inside_clients|search")}
                                aria-pressed={searching}
                                onClick={() => {
                                    setSearching(!searching);
                                    setQuery("");
                                }}
                            >
                                <InsisIcon name={searching ? "x" : "search"} />
                            </button>
                        )}
                        {!mobile && (
                            <button
                                type="button"
                                className={classNames("mx_InsisIconButton", { mx_InsisIconButton_on: cardOpen })}
                                aria-label={_t("inside_clients|card_toggle")}
                                aria-pressed={cardOpen}
                                onClick={() => setCardOpen(!cardOpen)}
                            >
                                <InsisIcon name="panel" />
                            </button>
                        )}
                        <button
                            type="button"
                            className="mx_InsisIconButton"
                            aria-label={_t("inside_clients|more")}
                            aria-expanded={menu}
                            onClick={() => setMenu(!menu)}
                        >
                            <InsisIcon name="more" />
                        </button>
                    </div>
                    {menu && (
                        <div className="mx_InsisMenu" role="menu">
                            {mobile && (
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                        setMenu(false);
                                        setSearching(true);
                                    }}
                                >
                                    <InsisIcon name="search" />
                                    {_t("inside_clients|search")}
                                </button>
                            )}
                            <button type="button" role="menuitem" onClick={call}>
                                <InsisIcon name="phone" />
                                {_t("inside_clients|call")}
                            </button>
                            <button type="button" role="menuitem" onClick={openInInsis}>
                                <InsisIcon name="ext" />
                                {_t("inside_clients|open_in_insis")}
                            </button>
                        </div>
                    )}
                </header>
                {notice && (
                    <div className="mx_InsisClientChat_notice" role="status">
                        <InsisIcon name="info" />
                        {notice}
                    </div>
                )}
                <div
                    className="mx_InsisClientChat_timeline"
                    ref={scrollRef}
                    onScroll={onScroll}
                    data-testid="insis-timeline"
                >
                    <ClientTimeline items={items} now={now} />
                    {searching && q && items.length === 0 && (
                        <div className="mx_InsisPill">{_t("inside_clients|search_nothing")}</div>
                    )}
                </div>
                {jump && (
                    <button
                        type="button"
                        className="mx_InsisClientChat_jump mx_InsisGlass"
                        aria-label={_t("inside_clients|jump_to_bottom")}
                        onClick={() => scrollToBottom(true)}
                    >
                        <InsisIcon name="down" />
                    </button>
                )}
                <ClientComposer
                    conversation={conversation}
                    templates={store.clientTemplates}
                    now={now}
                    onSend={(text, templateName) => {
                        atBottom.current = true;
                        store.sendClientMessage(conversation.id, text, { templateName });
                    }}
                    onUnavailable={(what) =>
                        setNotice(
                            what === "attach" ? _t("inside_clients|attach_later") : _t("inside_clients|voice_later"),
                        )
                    }
                />
            </section>
            {cardOpen && !mobile && (
                <LeadCardPanel
                    conversation={conversation}
                    card={card}
                    now={now}
                    initialTab={initialCardTab}
                    {...cardActions}
                />
            )}
            {cardOpen && mobile && (
                <div
                    className="mx_InsisLead_backdrop"
                    data-testid="insis-sheet-backdrop"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setCardOpen(false);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") setCardOpen(false);
                    }}
                >
                    <div className="mx_InsisLead_sheetWrap">
                        <LeadCardPanel
                            conversation={conversation}
                            card={card}
                            now={now}
                            variant="sheet"
                            initialTab={initialCardTab}
                            {...cardActions}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
