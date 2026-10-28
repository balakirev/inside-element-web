/*
Copyright 2026 Inside Estate

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// Inside: the parts of the room summary card from the Lobby redesign (right panel as in Telegram):
// a row of four tile buttons under the profile, and the "Media / Files / Links" tabs.

import React, { type JSX, type ReactNode, useEffect, useRef, useState } from "react";
import classNames from "classnames";
import { Menu } from "@vector-im/compound-web";
import VoiceCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call";
import NotificationsIcon from "@vector-im/compound-design-tokens/assets/web/icons/notifications";
import NotificationsOffIcon from "@vector-im/compound-design-tokens/assets/web/icons/notifications-off";
import SearchIcon from "@vector-im/compound-design-tokens/assets/web/icons/search";
import OverflowHorizontalIcon from "@vector-im/compound-design-tokens/assets/web/icons/overflow-horizontal";
import DocumentIcon from "@vector-im/compound-design-tokens/assets/web/icons/document";
import LinkIcon from "@vector-im/compound-design-tokens/assets/web/icons/link";
import PlaySolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/play-solid";
import { type MatrixEvent, MsgType, type Room } from "matrix-js-sdk/src/matrix";
import { type ImageContent, type MediaEventContent } from "matrix-js-sdk/src/types";

import { _t } from "../../../languageHandler";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { useScopedRoomContext } from "../../../contexts/ScopedRoomContext";
import defaultDispatcher from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import { useRoomCall } from "../../../hooks/room/useRoomCall";
import { useNotificationState } from "../../../hooks/useRoomNotificationState";
import { RoomNotifState } from "../../../RoomNotifs";
import { hasAccessToNotificationMenu, hasAccessToOptionsMenu } from "../../../viewmodels/room-list/utils";
import { DefaultTagID } from "../../../stores/room-list-v3/skip-list/tag";
import { MoreMenuContent } from "../rooms/RoomHeader/InsideHeaderButtons";
import { mediaFromContent } from "../../../customisations/Media";
import Modal from "../../../Modal";
import ImageView from "../elements/ImageView";
import Spinner from "../elements/Spinner";
import { formatBytes } from "../../../utils/FormattingUtils";
import { formatFullDateNoTime } from "../../../DateUtils";
import { type RoomPermalinkCreator } from "../../../utils/permalinks/Permalinks";
import { findUrls, type InsideMediaTab, useInsideRoomMedia } from "./useInsideRoomMedia";
import { useSettingValue } from "../../../hooks/useSettings";
import { isPdfEvent } from "../../../utils/pdfViewer";
import { openDocumentViewer } from "../../../utils/documentViewer";

interface TileProps {
    className: string;
    icon: ReactNode;
    label: string;
    onClick?: (ev: React.MouseEvent) => void;
    disabled?: boolean;
    title?: string;
    pressed?: boolean;
    ref?: React.Ref<HTMLButtonElement>;
}

function Tile({ className, icon, label, onClick, disabled, title, pressed, ref, ...rest }: TileProps): JSX.Element {
    return (
        <button
            {...rest}
            ref={ref}
            type="button"
            className={classNames("mx_RoomSummaryCard_inside_tile", className)}
            onClick={onClick}
            disabled={disabled}
            title={title}
            aria-pressed={pressed}
        >
            {icon}
            <span className="mx_RoomSummaryCard_inside_tileLabel">{label}</span>
        </button>
    );
}

/** "Call": the voice call of the room header; hidden where the header hides it (calls off, groups). */
function CallTile({ room }: { room: Room }): JSX.Element | null {
    // useRoomCall needs the room view's store; without a room view there is nothing to call from.
    const { roomViewStore } = useScopedRoomContext("roomViewStore");
    if (!roomViewStore) return null;
    return <CallTileInner room={room} />;
}

function CallTileInner({ room }: { room: Room }): JSX.Element | null {
    const { voiceCallDisabledReason, voiceCallClick, callOptions, showVoiceCallButton } = useRoomCall(room);
    if (!showVoiceCallButton || callOptions.length === 0) return null;
    return (
        <Tile
            className="mx_RoomSummaryCard_inside_call"
            icon={<VoiceCallIcon />}
            label={_t("right_panel|inside_call")}
            disabled={!!voiceCallDisabledReason}
            title={voiceCallDisabledReason ?? undefined}
            onClick={(ev) => voiceCallClick(ev, callOptions[0])}
        />
    );
}

/** "Mute" / "Unmute": the room's notification volume, the same setting as Mute in the room list. */
function MuteTile({ room }: { room: Room }): JSX.Element | null {
    const client = useMatrixClientContext();
    const [notifState, setNotifState] = useNotificationState(room);
    const isArchived = Boolean(room.tags[DefaultTagID.Archived]);
    if (!hasAccessToNotificationMenu(room, client.isGuest(), isArchived)) return null;

    const muted = notifState === RoomNotifState.Mute;
    return (
        <Tile
            className={classNames("mx_RoomSummaryCard_inside_mute", { mx_RoomSummaryCard_inside_tile_muted: muted })}
            icon={muted ? <NotificationsIcon /> : <NotificationsOffIcon />}
            label={muted ? _t("right_panel|inside_unmute") : _t("right_panel|inside_mute")}
            pressed={muted}
            onClick={() => setNotifState(muted ? RoomNotifState.AllMessages : RoomNotifState.Mute)}
        />
    );
}

/** "More": the room list item's options menu, as the "More" of the room header. */
function MoreTile({ room }: { room: Room }): JSX.Element | null {
    const client = useMatrixClientContext();
    const [open, setOpen] = useState(false);
    if (!hasAccessToOptionsMenu(room)) return null;
    return (
        <Menu
            open={open}
            onOpenChange={setOpen}
            title={_t("right_panel|inside_more")}
            showTitle={false}
            side="bottom"
            align="end"
            trigger={
                <Tile
                    className="mx_RoomSummaryCard_inside_more"
                    icon={<OverflowHorizontalIcon />}
                    label={_t("right_panel|inside_more")}
                />
            }
        >
            <MoreMenuContent key={room.roomId} room={room} client={client} />
        </Menu>
    );
}

/** The row of tile buttons under the profile: call, mute, search, more. */
export function InsideRoomSummaryTiles({ room }: { room: Room }): JSX.Element {
    return (
        <div className="mx_RoomSummaryCard_inside_tiles" role="group">
            <CallTile room={room} />
            <MuteTile room={room} />
            <Tile
                className="mx_RoomSummaryCard_inside_search"
                icon={<SearchIcon />}
                label={_t("right_panel|inside_search")}
                onClick={() => defaultDispatcher.fire(Action.FocusMessageSearch)}
            />
            <MoreTile room={room} />
        </div>
    );
}

function viewEvent(ev: MatrixEvent): void {
    defaultDispatcher.dispatch<ViewRoomPayload>({
        action: Action.ViewRoom,
        event_id: ev.getId(),
        highlighted: true,
        room_id: ev.getRoomId(),
        metricsTrigger: undefined, // room doesn't change
    });
}

/** Opens an image in Element's image viewer, as a click on it in the timeline does. */
function openImage(ev: MatrixEvent, permalinkCreator?: RoomPermalinkCreator): void {
    const content = ev.getContent<ImageContent>();
    const src = mediaFromContent(content).srcHttp;
    if (!src) return;
    Modal.createDialog(
        ImageView,
        {
            src,
            name: content.body || _t("common|attachment"),
            mxEvent: ev,
            permalinkCreator,
            width: content.info?.w,
            height: content.info?.h,
            fileSize: content.info?.size,
        },
        "mx_Dialog_lightbox",
        undefined,
        true,
    );
}

const THUMBNAIL_SIZE = 110;

function MediaItem({
    ev,
    permalinkCreator,
}: {
    ev: MatrixEvent;
    permalinkCreator?: RoomPermalinkCreator;
}): JSX.Element {
    const content = ev.getContent<MediaEventContent>();
    const isVideo = content.msgtype === MsgType.Video;
    const media = mediaFromContent(content);
    let thumbnail: string | null = null;
    if (!media.isEncrypted) {
        thumbnail = isVideo
            ? media.hasThumbnail
                ? media.getThumbnailHttp(THUMBNAIL_SIZE, THUMBNAIL_SIZE, "crop")
                : null
            : media.getSquareThumbnailHttp(THUMBNAIL_SIZE);
    }
    const name = content.body || _t("common|attachment");

    return (
        <li>
            <button
                type="button"
                className={classNames("mx_RoomSummaryCard_inside_gridItem", {
                    mx_RoomSummaryCard_inside_gridItem_video: isVideo,
                })}
                title={name}
                aria-label={name}
                onClick={() => (isVideo || media.isEncrypted ? viewEvent(ev) : openImage(ev, permalinkCreator))}
            >
                {thumbnail && <img src={thumbnail} alt="" loading="lazy" />}
                {isVideo && <PlaySolidIcon className="mx_RoomSummaryCard_inside_videoIcon" />}
            </button>
        </li>
    );
}

/** A file in the Files tab: a PDF opens in the Quick Look window, any other file is shown in the timeline. */
function FileItem({ ev }: { ev: MatrixEvent }): JSX.Element {
    const documentPreviewsEnabled = useSettingValue("feature_pdf_viewer");
    const opensQuickLook = documentPreviewsEnabled && isPdfEvent(ev);
    const content = ev.getContent();
    const name = content.filename || content.body || _t("common|attachment");
    const meta = [
        typeof content.info?.size === "number" ? formatBytes(content.info.size) : null,
        formatFullDateNoTime(ev.getDate() ?? new Date(ev.getTs())),
    ]
        .filter(Boolean)
        .join(" · ");
    return (
        <li>
            <button
                type="button"
                className="mx_RoomSummaryCard_inside_item mx_RoomSummaryCard_inside_file"
                onClick={() => (opensQuickLook ? openDocumentViewer(ev) : viewEvent(ev))}
            >
                <span className="mx_RoomSummaryCard_inside_itemIcon">
                    <DocumentIcon />
                </span>
                <span className="mx_RoomSummaryCard_inside_itemText">
                    <span className="mx_RoomSummaryCard_inside_itemTitle">{name}</span>
                    <span className="mx_RoomSummaryCard_inside_itemMeta">{meta}</span>
                </span>
            </button>
        </li>
    );
}

function hostOf(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

function LinkItem({ ev }: { ev: MatrixEvent }): JSX.Element {
    const body: string = ev.getContent().body;
    const url = findUrls(body)[0];
    return (
        <li>
            <button
                type="button"
                className="mx_RoomSummaryCard_inside_item mx_RoomSummaryCard_inside_link"
                onClick={() => viewEvent(ev)}
            >
                <span className="mx_RoomSummaryCard_inside_itemIcon">
                    <LinkIcon />
                </span>
                <span className="mx_RoomSummaryCard_inside_itemText">
                    <span className="mx_RoomSummaryCard_inside_itemTitle">{hostOf(url)}</span>
                    <span className="mx_RoomSummaryCard_inside_itemUrl">{url}</span>
                    {body.trim() !== url && <span className="mx_RoomSummaryCard_inside_itemMeta">{body}</span>}
                </span>
            </button>
        </li>
    );
}

/** Calls `onVisible` whenever the element at the end of the list scrolls into view. */
function LoadMoreSentinel({ onVisible }: { onVisible: () => void }): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    const onVisibleRef = useRef(onVisible);
    onVisibleRef.current = onVisible;
    useEffect(() => {
        const el = ref.current;
        if (!el || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) onVisibleRef.current();
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    return <div ref={ref} className="mx_RoomSummaryCard_inside_sentinel" aria-hidden="true" />;
}

const TABS: InsideMediaTab[] = ["media", "files", "links"];

function tabLabel(tab: InsideMediaTab): string {
    switch (tab) {
        case "media":
            return _t("right_panel|inside_media");
        case "files":
            return _t("right_panel|inside_files");
        case "links":
            return _t("right_panel|inside_links");
    }
}

function emptyLabel(tab: InsideMediaTab): string {
    switch (tab) {
        case "media":
            return _t("right_panel|inside_media_empty");
        case "files":
            return _t("right_panel|inside_files_empty");
        case "links":
            return _t("right_panel|inside_links_empty");
    }
}

function TabPanel({
    room,
    tab,
    permalinkCreator,
}: {
    room: Room;
    tab: InsideMediaTab;
    permalinkCreator?: RoomPermalinkCreator;
}): JSX.Element {
    const client = useMatrixClientContext();
    const { events, loading, canLoadMore, loadMore } = useInsideRoomMedia(client, room, tab);

    let content: ReactNode;
    if (events.length === 0) {
        content = loading ? null : <div className="mx_RoomSummaryCard_inside_empty">{emptyLabel(tab)}</div>;
    } else if (tab === "media") {
        content = (
            <ul className="mx_RoomSummaryCard_inside_grid">
                {events.map((ev) => (
                    <MediaItem key={ev.getId()} ev={ev} permalinkCreator={permalinkCreator} />
                ))}
            </ul>
        );
    } else {
        content = (
            <ul className="mx_RoomSummaryCard_inside_list">
                {events.map((ev) =>
                    tab === "files" ? <FileItem key={ev.getId()} ev={ev} /> : <LinkItem key={ev.getId()} ev={ev} />,
                )}
            </ul>
        );
    }

    return (
        <div
            role="tabpanel"
            id={`mx_RoomSummaryCard_inside_panel_${tab}`}
            aria-labelledby={`mx_RoomSummaryCard_inside_tab_${tab}`}
            className="mx_RoomSummaryCard_inside_panel"
            aria-busy={loading}
        >
            {content}
            {loading && <Spinner />}
            {!loading && canLoadMore && <LoadMoreSentinel onVisible={loadMore} />}
        </div>
    );
}

/** The "Media / Files / Links" tabs. Each tab loads its events only when it is opened. */
export function InsideRoomMedia({
    room,
    permalinkCreator,
}: {
    room: Room;
    permalinkCreator?: RoomPermalinkCreator;
}): JSX.Element {
    const [tab, setTab] = useState<InsideMediaTab>("media");

    return (
        <section className="mx_RoomSummaryCard_inside_media">
            <div className="mx_RoomSummaryCard_inside_tabs" role="tablist">
                {TABS.map((t) => (
                    <button
                        key={t}
                        type="button"
                        role="tab"
                        id={`mx_RoomSummaryCard_inside_tab_${t}`}
                        aria-controls={`mx_RoomSummaryCard_inside_panel_${t}`}
                        aria-selected={t === tab}
                        className={classNames("mx_RoomSummaryCard_inside_tab", {
                            mx_RoomSummaryCard_inside_tab_active: t === tab,
                        })}
                        onClick={() => setTab(t)}
                    >
                        {tabLabel(t)}
                    </button>
                ))}
            </div>
            <TabPanel key={tab} room={room} tab={tab} permalinkCreator={permalinkCreator} />
        </section>
    );
}
