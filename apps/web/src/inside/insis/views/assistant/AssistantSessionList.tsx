/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useEffect, useRef, useState, useSyncExternalStore, type JSX } from "react";
import classNames from "classnames";
import {
    DeleteIcon,
    EditIcon,
    FilterIcon,
    PinIcon,
    PlusIcon,
    UnpinIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t } from "../../../../languageHandler";
import Modal from "../../../../Modal";
import QuestionDialog from "../../../../components/views/dialogs/QuestionDialog";
import { ChevronFace, aboveLeftOf, type MenuProps } from "../../../../components/structures/ContextMenu";
import IconizedContextMenu, {
    IconizedContextMenuCheckbox,
    IconizedContextMenuOption,
    IconizedContextMenuOptionList,
} from "../../../../components/views/context_menus/IconizedContextMenu";
import { useInsisStore } from "../../useInsis";
import type { AssistantSession } from "../../model";
import {
    createAssistantSession,
    deleteAssistantSession,
    groupSessions,
    isSessionAwaiting,
    openAssistantSession,
    renameAssistantSession,
    sessionChip,
    togglePinAssistantSession,
    type SessionGroupKey,
} from "../../assistant";
import { AssistantIcon } from "./icons";
import { formatSessionTime, useNow } from "./time";

function groupLabel(key: SessionGroupKey): string {
    switch (key) {
        case "pinned":
            return _t("insis_assistant|group_pinned");
        case "today":
            return _t("insis_assistant|group_today");
        case "yesterday":
            return _t("insis_assistant|group_yesterday");
        case "earlier":
            return _t("insis_assistant|group_earlier");
    }
}

/** "Удалить сессию?" — the session's talk goes, what was created in INSIS stays. */
export async function confirmDeleteSession(session: AssistantSession, openNext: boolean): Promise<boolean> {
    const { finished } = Modal.createDialog(QuestionDialog, {
        title: _t("insis_assistant|delete_title"),
        description: _t("insis_assistant|delete_description", { title: session.title }),
        button: _t("insis_assistant|delete"),
        danger: true,
        className: "mx_InsisAssistant_deleteDialog",
    });
    const [ok] = await finished;
    if (ok) deleteAssistantSession(session.id, openNext);
    return Boolean(ok);
}

interface SessionMenuProps extends MenuProps {
    session: AssistantSession;
    openNextOnDelete: boolean;
    onRename: () => void;
    onFinished: () => void;
}

/** The menu of a session: rename, pin / unpin, delete (with a confirmation). */
export function AssistantSessionMenu({
    session,
    openNextOnDelete,
    onRename,
    onFinished,
    ...position
}: SessionMenuProps): JSX.Element {
    const run = (action: () => void) => (ev: React.SyntheticEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        onFinished();
        action();
    };
    return (
        <IconizedContextMenu
            {...position}
            chevronFace={ChevronFace.None}
            onFinished={onFinished}
            className="mx_InsisAssistant_menu"
            compact
        >
            <IconizedContextMenuOptionList first>
                <IconizedContextMenuOption
                    label={_t("insis_assistant|rename")}
                    icon={<EditIcon />}
                    onClick={run(onRename)}
                />
                <IconizedContextMenuOption
                    label={session.pinned ? _t("insis_assistant|unpin") : _t("insis_assistant|pin")}
                    icon={session.pinned ? <UnpinIcon /> : <PinIcon />}
                    onClick={run(() => togglePinAssistantSession(session.id))}
                />
            </IconizedContextMenuOptionList>
            <IconizedContextMenuOptionList red>
                <IconizedContextMenuOption
                    label={_t("insis_assistant|delete")}
                    icon={<DeleteIcon />}
                    isDestructive
                    onClick={run(() => void confirmDeleteSession(session, openNextOnDelete))}
                />
            </IconizedContextMenuOptionList>
        </IconizedContextMenu>
    );
}

interface RowProps {
    session: AssistantSession;
    selected: boolean;
    now: number;
    openNextOnDelete: boolean;
}

function SessionRow({ session, selected, now, openNextOnDelete }: RowProps): JSX.Element {
    const [menu, setMenu] = useState<MenuProps | null>(null);
    const [renaming, setRenaming] = useState(false);
    const moreRef = useRef<HTMLButtonElement>(null);
    const mainRef = useRef<HTMLButtonElement>(null);
    const awaiting = isSessionAwaiting(session);
    const chip = sessionChip(session);

    const openMenuAtButton = (): void => {
        const rect = moreRef.current?.getBoundingClientRect();
        if (rect) setMenu(aboveLeftOf(rect, ChevronFace.None, 4));
    };
    const onContextMenu = (ev: React.MouseEvent): void => {
        ev.preventDefault();
        ev.stopPropagation();
        setMenu({ left: ev.clientX, top: ev.clientY });
    };
    const onKeyDown = (ev: React.KeyboardEvent): void => {
        // The menu key and Shift+F10 open the session menu, as the context menu of a room.
        if (ev.key === "ContextMenu" || (ev.key === "F10" && ev.shiftKey)) {
            ev.preventDefault();
            openMenuAtButton();
        }
    };

    return (
        <li
            className={classNames("mx_InsisAssistantRow", {
                mx_InsisAssistantRow_selected: selected,
                mx_InsisAssistantRow_menuOpen: Boolean(menu),
            })}
            onContextMenu={onContextMenu}
        >
            <button
                ref={mainRef}
                type="button"
                className="mx_InsisAssistantRow_main"
                aria-current={selected ? "page" : undefined}
                onClick={() => !renaming && openAssistantSession(session.id)}
                onKeyDown={onKeyDown}
            >
                <span className="mx_InsisAssistant_avatar" aria-hidden="true">
                    <AssistantIcon name="spark" />
                </span>
                <span className="mx_InsisAssistantRow_text">
                    <span className="mx_InsisAssistantRow_line1">
                        {renaming ? (
                            <span className="mx_InsisAssistantRow_name mx_InsisAssistantRow_nameEditing" />
                        ) : (
                            <span className="mx_InsisAssistantRow_name">{session.title}</span>
                        )}
                        {session.pinned && <AssistantIcon name="pin" className="mx_InsisAssistantRow_pin" />}
                        <span className="mx_InsisAssistantRow_time">
                            {formatSessionTime(session.lastActivityTs, now)}
                        </span>
                    </span>
                    <span className="mx_InsisAssistantRow_line2">
                        <span className="mx_InsisAssistantRow_preview">
                            {session.preview || _t("insis_assistant|empty_session")}
                        </span>
                        {awaiting && (
                            <span
                                className="mx_InsisAssistant_waitDot"
                                role="img"
                                aria-label={_t("insis_assistant|awaiting")}
                            />
                        )}
                        {chip && (
                            <span className="mx_InsisAssistantRow_chip">
                                {chip === "created"
                                    ? _t("insis_assistant|chip_created")
                                    : _t("insis_assistant|chip_draft")}
                            </span>
                        )}
                    </span>
                </span>
            </button>
            {renaming && (
                <RenameField
                    initial={session.title}
                    onDone={(title) => {
                        setRenaming(false);
                        if (title !== null) renameAssistantSession(session.id, title);
                        mainRef.current?.focus();
                    }}
                />
            )}
            <button
                ref={moreRef}
                type="button"
                className="mx_InsisAssistantRow_more"
                aria-label={_t("insis_assistant|session_menu")}
                aria-haspopup="menu"
                aria-expanded={Boolean(menu)}
                onClick={(ev) => {
                    ev.stopPropagation();
                    if (menu) setMenu(null);
                    else openMenuAtButton();
                }}
            >
                <AssistantIcon name="more" />
            </button>
            {menu && (
                <AssistantSessionMenu
                    {...menu}
                    session={session}
                    openNextOnDelete={openNextOnDelete}
                    onRename={() => setRenaming(true)}
                    onFinished={() => setMenu(null)}
                />
            )}
        </li>
    );
}

/** Inline rename: Enter saves, Escape cancels, leaving the field saves. */
function RenameField({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }): JSX.Element {
    const [value, setValue] = useState(initial);
    const ref = useRef<HTMLInputElement>(null);
    const done = useRef(false);
    useEffect(() => {
        ref.current?.focus();
        ref.current?.select();
    }, []);
    const finish = (title: string | null): void => {
        if (done.current) return;
        done.current = true;
        onDone(title);
    };
    return (
        <input
            ref={ref}
            className="mx_InsisAssistantRow_rename"
            aria-label={_t("insis_assistant|rename")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    finish(value);
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    finish(null);
                }
            }}
            onBlur={() => finish(value)}
        />
    );
}

// The search over the sessions is shared by the list and, in narrow windows, the panel's top bar.
let sessionQuery = "";
const queryListeners = new Set<() => void>();
function setSessionQuery(q: string): void {
    sessionQuery = q;
    queryListeners.forEach((l) => l());
}
function useSessionQuery(): string {
    return useSyncExternalStore(
        (cb) => {
            queryListeners.add(cb);
            return () => queryListeners.delete(cb);
        },
        () => sessionQuery,
    );
}

/** "Поиск по сессиям": filters the sessions by title and preview; Escape clears it. */
export function AssistantSessionSearch(): JSX.Element {
    const query = useSessionQuery();
    // A new visit to the folder starts with no filter.
    useEffect(() => () => setSessionQuery(""), []);
    return (
        <label className="mx_InsisAssistantList_search">
            <AssistantIcon name="search" />
            <input
                type="search"
                value={query}
                placeholder={_t("insis_assistant|search_placeholder")}
                aria-label={_t("insis_assistant|search_placeholder")}
                autoComplete="off"
                onChange={(e) => setSessionQuery(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Escape" && query) {
                        e.stopPropagation();
                        setSessionQuery("");
                    }
                }}
            />
        </label>
    );
}

/**
 * Inside: the middle column while the "Помощник" folder is active — the assistant's sessions as chats, as ChatGPT
 * and Claude list them: a header, "Поиск по сессиям", "＋ Новый чат", then "Закреплено · Сегодня · Вчера · Ранее".
 * In narrow windows the panel has no header, and the search sits in its top bar (`narrow`).
 */
export function AssistantSessionList({ narrow = false }: { narrow?: boolean }): JSX.Element {
    const store = useInsisStore();
    const query = useSessionQuery();
    const [onlyAwaiting, setOnlyAwaiting] = useState(false);
    const [menu, setMenu] = useState<MenuProps | null>(null);
    const moreRef = useRef<HTMLButtonElement>(null);
    const now = useNow();
    const groups = groupSessions(store.assistantSessions, now, query, onlyAwaiting);
    const target = store.openTarget;
    const selectedId = target?.kind === "assistant" ? target.id : undefined;

    return (
        <div className={classNames("mx_InsisAssistantList", { mx_InsisAssistantList_narrow: narrow })}>
            {!narrow && (
                <div className="mx_InsisAssistantList_header">
                    <button
                        ref={moreRef}
                        type="button"
                        className="mx_InsisAssistantList_iconButton"
                        aria-label={_t("insis_assistant|list_menu")}
                        aria-haspopup="menu"
                        aria-expanded={Boolean(menu)}
                        onClick={() => {
                            const rect = moreRef.current?.getBoundingClientRect();
                            if (rect) setMenu({ left: rect.left, top: rect.bottom + 4 });
                        }}
                    >
                        <AssistantIcon name="more" />
                    </button>
                    <h2>{_t("insis_assistant|title")}</h2>
                    <button
                        type="button"
                        className="mx_InsisAssistantList_iconButton"
                        aria-label={_t("insis_assistant|new_chat")}
                        onClick={() => createAssistantSession()}
                    >
                        <AssistantIcon name="edit" />
                    </button>
                </div>
            )}
            {!narrow && <AssistantSessionSearch />}
            <button type="button" className="mx_InsisAssistantList_new" onClick={() => createAssistantSession()}>
                <AssistantIcon name="plus" />
                {_t("insis_assistant|new_chat")}
            </button>
            <div className="mx_InsisAssistantList_scroll">
                {groups.length === 0 && (
                    <div className="mx_InsisAssistantList_empty">
                        {query || onlyAwaiting
                            ? _t("insis_assistant|nothing_found")
                            : _t("insis_assistant|no_sessions")}
                    </div>
                )}
                {groups.map((g) => (
                    <section key={g.key} className="mx_InsisAssistantList_group" aria-label={groupLabel(g.key)}>
                        <h3 className="mx_InsisAssistantList_groupTitle">{groupLabel(g.key)}</h3>
                        <ul className="mx_InsisAssistantList_rows">
                            {g.sessions.map((s) => (
                                <SessionRow
                                    key={s.id}
                                    session={s}
                                    selected={s.id === selectedId}
                                    now={now}
                                    openNextOnDelete={!narrow}
                                />
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
            {menu && (
                <IconizedContextMenu
                    {...menu}
                    chevronFace={ChevronFace.None}
                    onFinished={() => setMenu(null)}
                    className="mx_InsisAssistant_menu"
                    compact
                >
                    <IconizedContextMenuOptionList first>
                        <IconizedContextMenuOption
                            label={_t("insis_assistant|new_chat")}
                            icon={<PlusIcon />}
                            onClick={() => {
                                setMenu(null);
                                createAssistantSession();
                            }}
                        />
                        <IconizedContextMenuCheckbox
                            label={_t("insis_assistant|only_awaiting")}
                            icon={<FilterIcon />}
                            active={onlyAwaiting}
                            onClick={() => {
                                setMenu(null);
                                setOnlyAwaiting(!onlyAwaiting);
                            }}
                        />
                    </IconizedContextMenuOptionList>
                </IconizedContextMenu>
            )}
        </div>
    );
}
