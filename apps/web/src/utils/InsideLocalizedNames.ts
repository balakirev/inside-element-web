/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    ClientEvent,
    EventTimeline,
    MatrixError,
    Method,
    type MatrixClient,
    type MatrixEvent,
    Room,
    RoomMember,
    RoomMemberEvent,
    type RoomState,
    RoomStateEvent,
    SyncState,
    User,
    UserEvent,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { getCurrentLanguage } from "../languageHandler";

/**
 * Inside: people and system rooms in the language of the interface (docs/LANGUAGES.md §2a of the
 * inside-chat repository). An English interface shows a person's Latin name, the profile field
 * `is.ins.name.en`, instead of their Matrix display name ("Pavel Sidorov", not "Павел Сидоров"), and a
 * system room's English name and topic from the `is.ins.room.name_i18n` / `is.ins.room.topic_i18n` state
 * events ({"ru": "Общий", "en": "General"}). A Russian interface shows everything as before.
 *
 * The swap is made once, in the js-sdk models: `RoomMember.name` / `rawDisplayName` (every member,
 * including the "sentinel" members that are `event.sender` / `event.target`), `User.displayName` and
 * `Room.name` (its `calculateRoomName`, so DMs named after the other person follow too). Every screen
 * that reads those (room list, header, bubbles, service messages, summaries, pills, typing, receipts,
 * threads, notifications, the tab title) gets the right name without changes of its own.
 *
 * Latin names come from `GET /profile/{userId}` of the people the client meets as room members, a few
 * requests at a time, and are kept in memory and in localStorage for a day; a member event that changes
 * the display name asks again. Until a name is known the display name is shown, and nothing changes on
 * rerender. They are loaded in both languages, so that search finds people by either spelling.
 */

/** Profile field with the person's name in Latin letters. */
export const NAME_EN_FIELD = "is.ins.name.en";
/** State event (state key "") with a system room's name per language. */
export const ROOM_NAME_I18N_EVENT = "is.ins.room.name_i18n";
/** State event (state key "") with a system room's topic per language. */
export const ROOM_TOPIC_I18N_EVENT = "is.ins.room.topic_i18n";

/** localStorage key of the Latin name cache. */
export const NAMES_CACHE_KEY = "mx_inside_names_en";
/** How long a loaded name (or "has none") is trusted before it is asked again. */
export const NAME_TTL_MS = 24 * 60 * 60 * 1000;
/** Pause before asking again after a failed request. */
export const NAME_RETRY_MS = 10 * 60 * 1000;
/** Parallel profile requests. */
export const NAME_CONCURRENCY = 4;
/** Entries not seen for this long are dropped from the stored cache. */
const NAME_FORGET_MS = 30 * 24 * 60 * 60 * 1000;

export type NamesLanguage = "ru" | "en";

/** The interface language for names: Russian, or English for every other language (as the UI does). */
export function getNamesLanguage(): NamesLanguage {
    return (getCurrentLanguage() ?? "").toLowerCase().startsWith("ru") ? "ru" : "en";
}

/** The language the models show names in. */
function currentNamesLanguage(): NamesLanguage {
    return activeNames?.language ?? getNamesLanguage();
}

/** The rule: an English interface shows the Latin name when the person has one, otherwise the name as is. */
export function chooseUserName(lang: NamesLanguage, latinName: string | null | undefined, name: string): string {
    return lang === "en" && latinName ? latinName : name;
}

/** The value for `lang` in an `is.ins.room.*_i18n` content, if it is a non-empty string. */
export function pickI18n(content: unknown, lang: NamesLanguage): string | undefined {
    if (!content || typeof content !== "object") return undefined;
    const value = (content as Record<string, unknown>)[lang];
    if (typeof value !== "string") return undefined;
    return value.trim() || undefined;
}

/** A usable `is.ins.name.en` value, or null. */
export function cleanLatinName(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const name = value.trim();
    return name && name.length <= 256 ? name : null;
}

/** The room's name in `lang` from `is.ins.room.name_i18n`, if it is a system room that has one. */
export function getRoomI18nName(room: Room, lang: NamesLanguage = currentNamesLanguage()): string | undefined {
    return pickI18n(room.currentState?.getStateEvents(ROOM_NAME_I18N_EVENT, "")?.getContent(), lang);
}

/** The room's topic in `lang` from `is.ins.room.topic_i18n`, if it is a system room that has one. */
export function getRoomI18nTopic(room: Room, lang: NamesLanguage = currentNamesLanguage()): string | undefined {
    return pickI18n(room.currentState?.getStateEvents(ROOM_TOPIC_I18N_EVENT, "")?.getContent(), lang);
}

/**
 * The page (or test environment) is still there. A timer of a client that a test assigned and never
 * stopped can fire after the environment is torn down ("window is not defined", CI shard failure on
 * build -31): such a timer does nothing.
 */
function environmentAlive(): boolean {
    return typeof window !== "undefined";
}

function getLocalStorage(): Storage | undefined {
    try {
        return typeof window !== "undefined" ? window.localStorage : undefined;
    } catch {
        return undefined;
    }
}

interface CacheEntry {
    /** The Latin name, or null when the person has none. */
    name: string | null;
    /** When it was loaded. */
    at: number;
}

/** Latin names by user ID, in memory and in localStorage. */
export class LatinNameCache {
    private entries = new Map<string, CacheEntry>();
    private saveTimer: ReturnType<typeof setTimeout> | undefined;

    public constructor(
        private readonly storage: Storage | undefined = getLocalStorage(),
        private readonly now: () => number = Date.now,
    ) {
        this.load();
    }

    /** The Latin name; null if the person has none, undefined if not loaded yet. */
    public get(userId: string): string | null | undefined {
        return this.entries.get(userId)?.name;
    }

    /** When the name was loaded, if it was. */
    public loadedAt(userId: string): number | undefined {
        return this.entries.get(userId)?.at;
    }

    public isFresh(userId: string): boolean {
        const entry = this.entries.get(userId);
        return !!entry && this.now() - entry.at < NAME_TTL_MS;
    }

    /** Marks the name as to be asked again, keeping it for display meanwhile. */
    public markStale(userId: string): void {
        const entry = this.entries.get(userId);
        if (entry) entry.at = 0;
    }

    /** Stores a loaded name; returns whether the shown name changes. */
    public set(userId: string, name: string | null): boolean {
        const old = this.entries.get(userId);
        this.entries.set(userId, { name, at: this.now() });
        this.scheduleSave();
        return (old?.name ?? null) !== name;
    }

    public staleUserIds(): string[] {
        return [...this.entries.keys()].filter((userId) => !this.isFresh(userId));
    }

    public clear(): void {
        this.entries.clear();
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = undefined;
        try {
            this.storage?.removeItem(NAMES_CACHE_KEY);
        } catch {
            // storage unavailable
        }
    }

    private load(): void {
        try {
            const raw = this.storage?.getItem(NAMES_CACHE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as { v?: number; e?: Record<string, [string | null, number]> };
            if (parsed?.v !== 1 || !parsed.e) return;
            const now = this.now();
            for (const [userId, value] of Object.entries(parsed.e)) {
                if (!Array.isArray(value) || typeof value[1] !== "number") continue;
                if (now - value[1] > NAME_FORGET_MS) continue;
                this.entries.set(userId, { name: cleanLatinName(value[0]), at: value[1] });
            }
        } catch (e) {
            logger.warn("Inside names: could not read the cache", e);
        }
    }

    private scheduleSave(): void {
        if (!this.storage || this.saveTimer) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = undefined;
            if (!environmentAlive()) return;
            this.save();
        }, 1000);
    }

    public save(): void {
        if (!this.storage) return;
        const e: Record<string, [string | null, number]> = {};
        for (const [userId, entry] of this.entries) e[userId] = [entry.name, entry.at];
        try {
            this.storage.setItem(NAMES_CACHE_KEY, JSON.stringify({ v: 1, e }));
        } catch (err) {
            logger.warn("Inside names: could not store the cache", err);
        }
    }
}

/**
 * Loads Latin names a few at a time. Requests for names that are fresh, already queued or failed a moment
 * ago are dropped; loaded names that change what is shown are reported in batches.
 */
export class LatinNameLoader {
    private queue: string[] = [];
    private queued = new Set<string>();
    private failedAt = new Map<string, number>();
    private active = 0;
    private enabled = false;
    private changed = new Set<string>();
    private flushTimer: ReturnType<typeof setTimeout> | undefined;

    public constructor(
        private readonly cache: LatinNameCache,
        private readonly fetchName: (userId: string) => Promise<string | null>,
        private readonly onChanged: (userIds: string[]) => void,
        private readonly concurrency = NAME_CONCURRENCY,
        private readonly now: () => number = Date.now,
        private readonly flushDelayMs = 250,
    ) {}

    /** Starts (or pauses) sending the queued requests. */
    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (enabled) this.pump();
    }

    public request(userId: string): void {
        if (!userId || this.queued.has(userId) || this.cache.isFresh(userId)) return;
        const failed = this.failedAt.get(userId);
        if (failed !== undefined && this.now() - failed < NAME_RETRY_MS) return;
        this.queued.add(userId);
        this.queue.push(userId);
        this.pump();
    }

    public get pending(): number {
        return this.queue.length + this.active;
    }

    public stop(): void {
        this.enabled = false;
        this.queue = [];
        this.queued.clear();
        if (this.flushTimer) clearTimeout(this.flushTimer);
        this.flushTimer = undefined;
        this.changed.clear();
    }

    private pump(): void {
        while (this.enabled && this.active < this.concurrency && this.queue.length) {
            const userId = this.queue.shift()!;
            this.active++;
            this.fetchName(userId)
                .then((name) => {
                    this.failedAt.delete(userId);
                    if (this.cache.set(userId, name)) this.changed.add(userId);
                })
                .catch((e) => {
                    this.failedAt.set(userId, this.now());
                    logger.debug(`Inside names: no profile for ${userId}`, e);
                })
                .finally(() => {
                    this.active--;
                    this.queued.delete(userId);
                    this.scheduleFlush();
                    this.pump();
                });
        }
    }

    private scheduleFlush(): void {
        if (this.flushTimer || !this.changed.size) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            if (!environmentAlive()) return;
            const userIds = [...this.changed];
            this.changed.clear();
            if (userIds.length) this.onChanged(userIds);
        }, this.flushDelayMs);
    }
}

/** The person's Latin name from their profile; null if they have none. */
export async function fetchLatinName(client: MatrixClient, userId: string): Promise<string | null> {
    try {
        const profile = await client.http.authedRequest<Record<string, unknown>>(
            Method.Get,
            `/profile/${encodeURIComponent(userId)}`,
        );
        return cleanLatinName(profile?.[NAME_EN_FIELD]);
    } catch (e) {
        // No profile: nothing to wait for. Anything else (403 without a shared room, network) is asked later.
        if (e instanceof MatrixError && e.httpStatus === 404) return null;
        throw e;
    }
}

const BASE_NAMES = Symbol("insideBaseNames");

interface MemberBase {
    name: string;
    rawDisplayName: string;
}
interface UserBase {
    displayName?: string;
    rawDisplayName?: string;
}
type Emitter = { emit: (...args: unknown[]) => boolean };
type PatchedMember = RoomMember & { [BASE_NAMES]?: MemberBase };

/** `RoomMember.updateModifiedTime` is private; the js-sdk calls it before announcing a new name. */
function touch(member: RoomMember): void {
    (member as unknown as { updateModifiedTime?: () => void }).updateModifiedTime?.();
}
type PatchedUser = User & { [BASE_NAMES]?: UserBase };

/** Runs `run` with the object's events held back, then `after`, then sends the held events. */
function withHeldEvents<T>(obj: object, run: () => T, after: (held: unknown[][]) => unknown[][]): T {
    const target = obj as Emitter;
    const hadOwn = Object.prototype.hasOwnProperty.call(target, "emit");
    const ownEmit = target.emit;
    const held: unknown[][] = [];
    target.emit = (...args: unknown[]): boolean => {
        held.push(args);
        return true;
    };
    let result: T;
    try {
        result = run();
    } finally {
        if (hadOwn) target.emit = ownEmit;
        else delete (target as Partial<Emitter>).emit;
    }
    for (const args of after(held)) target.emit(...args);
    return result;
}

export class InsideLocalizedNames {
    private static internalInstance: InsideLocalizedNames | undefined;

    public static get instance(): InsideLocalizedNames {
        if (!this.internalInstance) this.internalInstance = new InsideLocalizedNames();
        return this.internalInstance;
    }

    public readonly cache: LatinNameCache;
    public readonly loader: LatinNameLoader;
    private client: MatrixClient | null = null;
    private refreshTimer: ReturnType<typeof setInterval> | undefined;
    /** Language override, for tests. */
    public languageOverride: NamesLanguage | undefined;

    public constructor(cache = new LatinNameCache()) {
        this.cache = cache;
        this.loader = new LatinNameLoader(
            cache,
            (userId) => (this.client ? fetchLatinName(this.client, userId) : Promise.reject(new Error("no client"))),
            (userIds) => this.refreshUsers(userIds),
        );
    }

    public get language(): NamesLanguage {
        return this.languageOverride ?? getNamesLanguage();
    }

    /** The Latin name to show for `userId` in the current language, if it replaces the display name. */
    public getShownLatinName(userId: string): string | undefined {
        return this.language === "en" ? (this.cache.get(userId) ?? undefined) : undefined;
    }

    /** `name` as the current language shows it for `userId`. */
    public localizeUserName(userId: string, name: string): string {
        return chooseUserName(this.language, this.cache.get(userId), name);
    }

    /** Every spelling of a person's name, for search: the shown name, the display name, the Latin name. */
    public getNameSpellings(userId: string, ...names: Array<string | undefined | null>): string[] {
        const all = [...names, this.cache.get(userId)];
        return [...new Set(all.filter((n): n is string => !!n))];
    }

    /** Whether a lower-case `query` is in any spelling of the person's name. */
    public nameMatches(query: string, userId: string, ...names: Array<string | undefined | null>): boolean {
        return this.getNameSpellings(userId, ...names).some((name) => name.toLowerCase().includes(query));
    }

    /** The spellings of a room member's name, for search. */
    public getMemberSpellings(member: RoomMember): string[] {
        const base = (member as PatchedMember)[BASE_NAMES];
        return this.getNameSpellings(member.userId, member.name, member.rawDisplayName, base?.rawDisplayName);
    }

    /** The spellings of a room's name, for search: the shown one and every language of a system room. */
    public getRoomNameSpellings(room: Room): string[] {
        const content = room.currentState?.getStateEvents(ROOM_NAME_I18N_EVENT, "")?.getContent();
        const plain = room.currentState?.getStateEvents("m.room.name", "")?.getContent()?.name;
        const all = [room.name, pickI18n(content, "en"), pickI18n(content, "ru"), plain];
        return [...new Set(all.filter((n): n is string => typeof n === "string" && !!n))];
    }

    /** Takes a Latin name from a profile loaded elsewhere (user info, pills). */
    public noteProfile(userId: string, profile: Record<string, unknown> | undefined | null): void {
        if (!profile || this.cache.isFresh(userId)) return;
        if (this.cache.set(userId, cleanLatinName(profile[NAME_EN_FIELD]))) this.refreshUsers([userId]);
    }

    /** Patches the js-sdk models (once) and starts loading names for `client`. */
    public start(client: MatrixClient): void {
        this.install();
        if (this.client === client) return;
        this.stop();
        this.client = client;
        const onSync = (state: SyncState): void => {
            if (state === SyncState.Prepared || state === SyncState.Syncing) {
                this.loader.setEnabled(true);
                client.off(ClientEvent.Sync, onSync);
            }
        };
        if (client.isInitialSyncComplete()) this.loader.setEnabled(true);
        else client.on(ClientEvent.Sync, onSync);
        // Once a day per name: ask again for the stale ones of people the client knows.
        this.refreshTimer = setInterval(
            () => {
                if (!environmentAlive()) return;
                for (const userId of this.cache.staleUserIds()) this.loader.request(userId);
            },
            60 * 60 * 1000,
        );
    }

    public stop(): void {
        this.loader.stop();
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.refreshTimer = undefined;
        this.client = null;
    }

    /** A member got (or recalculated) their member event: localize the name, load the Latin one if needed. */
    private onMember(member: RoomMember, event?: MatrixEvent): void {
        const userId = member.userId;
        if (event && this.client) {
            const content = event.getContent();
            const prev = event.getPrevContent();
            const loadedAt = this.cache.loadedAt(userId);
            // A newer display name change than the loaded name: the Latin one may have changed too.
            if (
                loadedAt !== undefined &&
                content.displayname !== prev.displayname &&
                prev.membership !== undefined &&
                event.getTs() > loadedAt
            ) {
                this.cache.markStale(userId);
            }
        }
        this.loader.request(userId);
    }

    /** The member's names for the current language from their js-sdk names. */
    private applyMember(member: PatchedMember): boolean {
        const base = member[BASE_NAMES];
        if (!base) return false;
        let name = base.name;
        let rawDisplayName = base.rawDisplayName;
        const latin = this.getShownLatinName(member.userId);
        if (latin) {
            const suffix = ` (${member.userId})`;
            name = member.disambiguate && base.name.endsWith(suffix) ? latin + suffix : latin;
            rawDisplayName = latin;
        }
        if (member.name === name && member.rawDisplayName === rawDisplayName) return false;
        member.name = name;
        member.rawDisplayName = rawDisplayName;
        return true;
    }

    private applyUser(user: PatchedUser): boolean {
        const base = user[BASE_NAMES];
        if (!base) return false;
        const latin = this.getShownLatinName(user.userId);
        const displayName = latin ?? base.displayName;
        const rawDisplayName = latin ?? base.rawDisplayName;
        if (user.displayName === displayName && user.rawDisplayName === rawDisplayName) return false;
        user.displayName = displayName;
        user.rawDisplayName = rawDisplayName;
        return true;
    }

    /** Runs a js-sdk member method that sets the name, then puts the localized one in its place. */
    /** @internal */
    public runMember<T>(member: PatchedMember, run: () => T, event?: MatrixEvent): T {
        const oldName = member.name;
        return withHeldEvents(member, run, (held) => {
            member[BASE_NAMES] = { name: member.name, rawDisplayName: member.rawDisplayName };
            this.applyMember(member);
            this.onMember(member, event);
            // The js-sdk compared its own name; announce a change only if the shown name changed.
            const out = held.filter((args) => args[0] !== RoomMemberEvent.Name);
            if (member.name !== oldName && member.events.member) {
                touch(member);
                out.push([RoomMemberEvent.Name, member.events.member, member, oldName]);
            }
            return out;
        });
    }

    /** @internal */
    public runUser<T>(user: PatchedUser, run: () => T): T {
        const base = user[BASE_NAMES];
        // The js-sdk keeps the current name when an update has none, and compares with it: give it its own.
        if (base) {
            user.displayName = base.displayName;
            user.rawDisplayName = base.rawDisplayName;
        }
        return withHeldEvents(user, run, (held) => {
            user[BASE_NAMES] = { displayName: user.displayName, rawDisplayName: user.rawDisplayName };
            this.applyUser(user);
            this.loader.request(user.userId);
            return held;
        });
    }

    /** Re-applies names after Latin names arrived: members of every loaded state, users, room names. */
    public refreshUsers(userIds: Iterable<string>): void {
        const ids = new Set(userIds);
        const client = this.client;
        if (!client || !ids.size) return;
        for (const room of client.getRooms()) {
            let touched = false;
            for (const state of statesOf(room)) {
                const sentinels = (state as unknown as { sentinels?: Record<string, RoomMember> }).sentinels ?? {};
                for (const userId of ids) {
                    const member = state.members[userId];
                    if (member && this.refreshMember(member)) {
                        touched = true;
                        if (member.events.member) {
                            state.emit(RoomStateEvent.Members, member.events.member, state, member);
                        }
                    }
                    const sentinel = sentinels[userId];
                    if (sentinel && this.refreshMember(sentinel)) touched = true;
                }
            }
            // Senders and targets of loaded events keep the member objects of their time.
            for (const event of eventsOf(room)) {
                for (const member of [event.sender, event.target]) {
                    if (member && ids.has(member.userId) && this.refreshMember(member)) touched = true;
                }
            }
            // DMs are named after the other person.
            if (touched) room.recalculate();
        }
        for (const userId of ids) {
            const user = client.getUser(userId);
            if (user && this.applyUser(user)) user.emit(UserEvent.DisplayName, user.events.presence ?? undefined, user);
        }
        for (const listener of this.listeners) listener(ids);
    }

    private listeners = new Set<(userIds: Set<string>) => void>();

    /** Calls `listener` after names of people changed (texts made from them, like previews, are stale). */
    public onNamesChanged(listener: (userIds: Set<string>) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private refreshMember(member: PatchedMember): boolean {
        const oldName = member.name;
        if (!this.applyMember(member)) return false;
        if (member.name !== oldName && member.events.member) {
            touch(member);
            member.emit(RoomMemberEvent.Name, member.events.member, member, oldName);
        }
        return true;
    }

    /** Makes this the instance the js-sdk models ask for names (patching them once). */
    public install(): void {
        setActiveNames(this);
        patchModels();
    }

    /**
     * A DM whose `m.room.name` is just the other person's display name (DMs created by scripts) is named
     * like a DM without a name: after the person, in the current language.
     */
    public localizeDmRoomName(room: Room, myUserId: string, name: string): string {
        if (this.language !== "en") return name;
        const members = room.currentState
            .getMembers()
            .filter((m) => m.membership === "join" || m.membership === "invite");
        if (members.length > 2) return name;
        const other: PatchedMember | undefined = members.find((m) => m.userId !== myUserId);
        if (!other || other[BASE_NAMES]?.rawDisplayName !== name) return name;
        return this.getShownLatinName(other.userId) ?? name;
    }
}

/**
 * Every event loaded in the room's timelines and threads.
 * @yields each event
 */
function* eventsOf(room: Room): Generator<MatrixEvent> {
    const timelineSets = [...room.getTimelineSets(), ...room.getThreads().map((thread) => thread.timelineSet)];
    for (const timelineSet of timelineSets) {
        for (const timeline of timelineSet.getTimelines()) yield* timeline.getEvents();
    }
}

/** Every room state the client keeps for a room: live, timeline starts and ends, threads. */
function statesOf(room: Room): Set<RoomState> {
    const states = new Set<RoomState>();
    if (room.currentState) states.add(room.currentState);
    if (room.oldState) states.add(room.oldState);
    const timelineSets = [...room.getTimelineSets(), ...room.getThreads().map((thread) => thread.timelineSet)];
    for (const timelineSet of timelineSets) {
        for (const timeline of timelineSet.getTimelines()) {
            const forwards = timeline.getState(EventTimeline.FORWARDS);
            const backwards = timeline.getState(EventTimeline.BACKWARDS);
            if (forwards) states.add(forwards);
            if (backwards) states.add(backwards);
        }
    }
    return states;
}

/** The instance the patched models use; none until {@link InsideLocalizedNames.install}. */
let activeNames: InsideLocalizedNames | undefined;
let modelsPatched = false;

function setActiveNames(names: InsideLocalizedNames): void {
    activeNames = names;
}

/** Patches `RoomMember`, `User` and `Room` of the js-sdk, once; without an active instance they act as before. */
function patchModels(): void {
    if (modelsPatched) return;
    modelsPatched = true;

    const memberProto = RoomMember.prototype;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with .call(this)
    const setMembershipEvent = memberProto.setMembershipEvent;
    memberProto.setMembershipEvent = function (this: RoomMember, event: MatrixEvent, roomState?: RoomState): void {
        const run = (): void => setMembershipEvent.call(this, event, roomState);
        if (!activeNames || event.getType() !== "m.room.member") return run();
        activeNames.runMember(this, run, event);
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with .call(this)
    const recalculate = memberProto.recalculateDisambiguatedName;
    memberProto.recalculateDisambiguatedName = function (this: RoomMember, roomState: RoomState): boolean {
        if (!activeNames) return recalculate.call(this, roomState);
        const oldName = this.name;
        activeNames.runMember(this, () => recalculate.call(this, roomState));
        return this.name !== oldName;
    };

    const userProto = User.prototype as unknown as Record<string, (this: User, arg: unknown) => void>;
    for (const method of ["setPresenceEvent", "setDisplayName", "setRawDisplayName"]) {
        const original = userProto[method];
        userProto[method] = function (this: User, arg: unknown): void {
            if (!activeNames) return original.call(this, arg);
            activeNames.runUser(this, () => original.call(this, arg));
        };
    }

    type RoomNaming = { calculateRoomName(userId: string, ignoreRoomNameEvent?: boolean): string };
    const roomProto = Room.prototype as unknown as RoomNaming;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with .call(this)
    const calculateRoomName = roomProto.calculateRoomName;
    roomProto.calculateRoomName = function (this: Room, userId: string, ignoreRoomNameEvent = false): string {
        const names = activeNames;
        if (names && !ignoreRoomNameEvent) {
            const i18nName = getRoomI18nName(this, names.language);
            if (i18nName) return i18nName;
        }
        const name = calculateRoomName.call(this, userId, ignoreRoomNameEvent);
        return names && !ignoreRoomNameEvent ? names.localizeDmRoomName(this, userId, name) : name;
    };
}
