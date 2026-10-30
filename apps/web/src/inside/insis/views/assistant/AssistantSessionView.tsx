/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import classNames from "classnames";

import { _t } from "../../../../languageHandler";
import { formatTime } from "../../../../DateUtils";
import { ChevronFace, aboveLeftOf, type MenuProps } from "../../../../components/structures/ContextMenu";
import { useInsideLayout } from "../../../../utils/InsideLayout";
import { useInsisStore } from "../../useInsis";
import type { AssistantMessage, AssistantSession } from "../../model";
import {
    QUICK_STARTS,
    closeAssistantSession,
    createAssistantSession,
    isSessionAwaiting,
    quickStartLabel,
    renameAssistantSession,
    sendToAssistant,
    type QuickStart,
} from "../../assistant";
import { AssistantIcon, type AssistantIconName } from "./icons";
import { AssistantArtifactCard, AssistantSuggestionsCard } from "./AssistantArtifactCard";
import { AssistantComposer, type AssistantComposerHandle } from "./AssistantComposer";
import { AssistantSessionMenu } from "./AssistantSessionList";
import { formatSessionDay, formatVoiceDuration, isSameDay, useNow } from "./time";

const QUICK_ICONS: Record<QuickStart, AssistantIconName> = {
    listing: "mic",
    deal: "case",
    client: "user",
    task: "tick",
    client_q: "search",
};

/** Bars of a voice message, as the mockup draws them: a fixed pseudo-random shape, the last third not played. */
function waveBars(bars: number, seed: number): { id: string; height: number; rest: boolean }[] {
    let s = seed;
    const r = (): number => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
    };
    return Array.from({ length: bars }, (_, i) => ({
        id: `bar-${i}`,
        height: Math.round(5 + r() * 19),
        rest: i > bars * 0.62,
    }));
}

const WAVE = waveBars(34, 7);

function Waveform(): JSX.Element {
    return (
        <span className="mx_InsisVoice_wave" aria-hidden="true">
            {WAVE.map((b) => (
                <i key={b.id} className={b.rest ? "mx_InsisVoice_wave_rest" : undefined} style={{ height: b.height }} />
            ))}
        </span>
    );
}

function Meta({ ts, own }: { ts: number; own: boolean }): JSX.Element {
    return (
        <span className="mx_InsisBubble_meta">
            {formatTime(new Date(ts))}
            {own && <AssistantIcon name="ticks" />}
        </span>
    );
}

function UserBubble({
    message,
    tail,
}: {
    message: Extract<AssistantMessage, { kind: "user" }>;
    tail: boolean;
}): JSX.Element {
    const cls = classNames("mx_InsisBubble mx_InsisBubble_out", { mx_InsisBubble_tail: tail });
    if (message.voice) {
        return (
            <div className={cls}>
                <span className="mx_InsisVoice">
                    <span className="mx_InsisVoice_play" aria-hidden="true">
                        <AssistantIcon name="play" />
                    </span>
                    <Waveform />
                    <em>{formatVoiceDuration(message.voice.durationSec)}</em>
                </span>
                <span className="mx_InsisVoice_transcript">
                    <small>{_t("insis_assistant|transcript")}</small>
                    {message.text}
                </span>
                <Meta ts={message.ts} own />
            </div>
        );
    }
    if (message.file) {
        return (
            <div className={cls}>
                <div className="mx_InsisFile">
                    <span className="mx_InsisFile_icon" aria-hidden="true">
                        <AssistantIcon name="doc" />
                    </span>
                    <div>
                        <b>{message.file.name}</b>
                        <span>{message.file.size}</span>
                    </div>
                </div>
                {message.text && <div className="mx_InsisBubble_text">{message.text}</div>}
                <Meta ts={message.ts} own />
            </div>
        );
    }
    return (
        <div className={cls}>
            <span className="mx_InsisBubble_text">{message.text}</span>
            <Meta ts={message.ts} own />
        </div>
    );
}

function AssistantTurn({
    session,
    message,
    onEdit,
}: {
    session: AssistantSession;
    message: Extract<AssistantMessage, { kind: "assistant" }>;
    onEdit: (text: string) => void;
}): JSX.Element {
    return (
        <>
            <div className="mx_InsisSender">
                <AssistantIcon name="spark" />
                {message.canned ? _t("insis_assistant|sender_canned") : _t("insis_assistant|sender")}
            </div>
            {message.text && (
                <div
                    className={classNames("mx_InsisBubble mx_InsisBubble_in", {
                        mx_InsisBubble_tail: !message.artifact && !message.suggestions,
                        mx_InsisBubble_streaming: message.streaming,
                    })}
                    aria-busy={message.streaming || undefined}
                >
                    <span className="mx_InsisBubble_text">{message.text}</span>
                    {!message.streaming && <Meta ts={message.ts} own={false} />}
                </div>
            )}
            {message.artifact && (
                <AssistantArtifactCard sessionId={session.id} artifact={message.artifact} onEdit={onEdit} />
            )}
            {message.suggestions && message.suggestions.length > 0 && (
                <AssistantSuggestionsCard sessionId={session.id} suggestions={message.suggestions} />
            )}
        </>
    );
}

function Feed({
    session,
    query,
    onEdit,
}: {
    session: AssistantSession;
    query: string;
    onEdit: (text: string) => void;
}): JSX.Element {
    const now = useNow();
    const q = query.trim().toLocaleLowerCase();
    const messages = q
        ? session.messages.filter(
              (m) =>
                  m.text.toLocaleLowerCase().includes(q) ||
                  (m.kind === "assistant" && m.artifact?.title.toLocaleLowerCase().includes(q)),
          )
        : session.messages;
    if (q && messages.length === 0) {
        return <div className="mx_InsisFeed_nothing">{_t("insis_assistant|nothing_found")}</div>;
    }
    const out: JSX.Element[] = [];
    messages.forEach((m, i) => {
        const prev = messages[i - 1];
        const next = messages[i + 1];
        if (!prev || !isSameDay(prev.ts, m.ts)) {
            out.push(
                <div key={`day-${m.id}`} className="mx_InsisFeed_day" role="separator">
                    {formatSessionDay(m.ts, now)}
                </div>,
            );
        }
        if (m.kind === "user") {
            const tail = !next || next.kind !== "user" || !isSameDay(next.ts, m.ts);
            out.push(<UserBubble key={m.id} message={m} tail={tail} />);
        } else {
            out.push(<AssistantTurn key={m.id} session={session} message={m} onEdit={onEdit} />);
        }
    });
    return <>{out}</>;
}

/** An empty session: "Чем помочь?" and the quick starts. */
function Hello({ sessionId }: { sessionId: string }): JSX.Element {
    return (
        <div className="mx_InsisHello">
            <span className="mx_InsisAssistant_avatar mx_InsisHello_avatar" aria-hidden="true">
                <AssistantIcon name="spark" />
            </span>
            <h3>{_t("insis_assistant|hello_title")}</h3>
            <p>{_t("insis_assistant|hello_body")}</p>
            <div className="mx_InsisHello_quick">
                {QUICK_STARTS.map((q) => (
                    <button key={q} type="button" onClick={() => sendToAssistant(sessionId, quickStartLabel(q))}>
                        <AssistantIcon name={QUICK_ICONS[q]} />
                        {quickStartLabel(q)}
                    </button>
                ))}
            </div>
        </div>
    );
}

function HeaderTitle({
    session,
    renaming,
    onRenamed,
}: {
    session: AssistantSession;
    renaming: boolean;
    onRenamed: () => void;
}): JSX.Element {
    const [value, setValue] = useState(session.title);
    const done = useRef(false);
    useEffect(() => {
        setValue(session.title);
        done.current = false;
    }, [renaming, session.title]);
    if (!renaming) return <b className="mx_InsisHeader_title">{session.title}</b>;
    const finish = (save: boolean): void => {
        if (done.current) return;
        done.current = true;
        if (save) renameAssistantSession(session.id, value);
        onRenamed();
    };
    return (
        <input
            className="mx_InsisHeader_rename"
            aria-label={_t("insis_assistant|rename")}
            value={value}
            autoFocus
            onFocus={(e) => e.target.select()}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === "Enter") finish(true);
                if (e.key === "Escape") {
                    e.stopPropagation();
                    finish(false);
                }
            }}
            onBlur={() => finish(true)}
        />
    );
}

/**
 * Inside: an assistant session on the whole main area, as a chat — the header capsule (spark, title, the context:
 * "без клиента" or the client, "ждёт подтверждения"), the feed on the chat wallpaper with day separators, the
 * broker's messages as own bubbles, the assistant's with a small "✨ Помощник" over them and its artifacts as native
 * cards, and the composer. Nothing of it is a Matrix room.
 */
export function AssistantSessionView({ sessionId }: { sessionId: string }): JSX.Element {
    const store = useInsisStore();
    const session = store.getSession(sessionId);
    const layout = useInsideLayout();
    const mobile = layout === "mobile";
    const composer = useRef<AssistantComposerHandle>(null);
    const feed = useRef<HTMLDivElement>(null);
    const moreRef = useRef<HTMLButtonElement>(null);
    const [menu, setMenu] = useState<MenuProps | null>(null);
    const [renaming, setRenaming] = useState(false);
    const [searching, setSearching] = useState(false);
    const [query, setQuery] = useState("");

    // Keep the end of the feed in view as messages come and the reply types out.
    const lastText = session?.messages.at(-1)?.text;
    const count = session?.messages.length ?? 0;
    useLayoutEffect(() => {
        if (feed.current && !query) feed.current.scrollTop = feed.current.scrollHeight;
    }, [count, lastText, query]);

    if (!session) return <AssistantEmptyView />;

    const awaiting = isSessionAwaiting(session);
    const context = session.context || _t("insis_assistant|no_client");
    const subtitle = awaiting ? _t("insis_assistant|subtitle_awaiting", { context }) : context;
    const empty = session.messages.length === 0;

    return (
        <main className="mx_InsisAssistant" aria-label={_t("insis_assistant|session_label", { title: session.title })}>
            <div className="mx_InsisHeader">
                <div className="mx_InsisHeader_capsule">
                    {mobile && (
                        <button
                            type="button"
                            className="mx_InsisHeader_back"
                            aria-label={_t("action|back")}
                            onClick={() => closeAssistantSession(true)}
                        >
                            <AssistantIcon name="back" />
                        </button>
                    )}
                    <span className="mx_InsisAssistant_avatar mx_InsisHeader_avatar" aria-hidden="true">
                        <AssistantIcon name="spark" />
                    </span>
                    {searching ? (
                        <input
                            className="mx_InsisHeader_search"
                            type="search"
                            value={query}
                            autoFocus
                            placeholder={_t("insis_assistant|search_in_session")}
                            aria-label={_t("insis_assistant|search_in_session")}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                    e.stopPropagation();
                                    setSearching(false);
                                    setQuery("");
                                }
                            }}
                        />
                    ) : (
                        <div className="mx_InsisHeader_who">
                            <HeaderTitle session={session} renaming={renaming} onRenamed={() => setRenaming(false)} />
                            <span className="mx_InsisHeader_subtitle">{subtitle}</span>
                        </div>
                    )}
                </div>
                <div className="mx_InsisHeader_buttons">
                    {!mobile && (
                        <button
                            type="button"
                            className={classNames("mx_InsisHeader_button", { mx_InsisHeader_button_on: searching })}
                            aria-label={_t("insis_assistant|search_in_session")}
                            aria-pressed={searching}
                            onClick={() => {
                                setSearching(!searching);
                                setQuery("");
                            }}
                        >
                            <AssistantIcon name="search" />
                        </button>
                    )}
                    <button
                        ref={moreRef}
                        type="button"
                        className="mx_InsisHeader_button"
                        aria-label={_t("insis_assistant|session_menu")}
                        aria-haspopup="menu"
                        aria-expanded={Boolean(menu)}
                        onClick={() => {
                            const rect = moreRef.current?.getBoundingClientRect();
                            if (rect) setMenu(aboveLeftOf(rect, ChevronFace.None, 6));
                        }}
                    >
                        <AssistantIcon name="more" />
                    </button>
                </div>
                {menu && (
                    <AssistantSessionMenu
                        {...menu}
                        session={session}
                        openNextOnDelete={!mobile}
                        onRename={() => setRenaming(true)}
                        onFinished={() => setMenu(null)}
                    />
                )}
            </div>

            <div className="mx_InsisFeed" ref={feed}>
                <div className={classNames("mx_InsisFeed_inner", { mx_InsisFeed_inner_empty: empty })}>
                    {empty ? (
                        <Hello sessionId={session.id} />
                    ) : (
                        <Feed session={session} query={query} onEdit={(t) => composer.current?.setText(t)} />
                    )}
                </div>
            </div>

            <AssistantComposer handleRef={composer} sessionId={session.id} />
        </main>
    );
}

/** The folder is active and no session is open: what the assistant is, and "Новый чат". */
export function AssistantEmptyView(): JSX.Element {
    return (
        <main className="mx_InsisAssistant mx_InsisAssistant_empty" aria-label={_t("insis_assistant|title")}>
            <div className="mx_InsisHello">
                <span className="mx_InsisAssistant_avatar mx_InsisHello_avatar" aria-hidden="true">
                    <AssistantIcon name="spark" />
                </span>
                <h3>{_t("insis_assistant|title")}</h3>
                <p>{_t("insis_assistant|empty_body")}</p>
                <div className="mx_InsisHello_quick">
                    <button type="button" className="mx_InsisHello_primary" onClick={() => createAssistantSession()}>
                        <AssistantIcon name="plus" />
                        {_t("insis_assistant|new_chat")}
                    </button>
                </div>
            </div>
        </main>
    );
}
