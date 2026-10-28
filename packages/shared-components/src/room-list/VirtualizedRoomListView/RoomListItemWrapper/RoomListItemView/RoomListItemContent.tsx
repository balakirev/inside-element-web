/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, memo, type ReactNode } from "react";
import { Text, Tooltip } from "@vector-im/compound-web";
import { NotificationsOffSolidIcon, PinSolidIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import classNames from "classnames";

import { Flex } from "../../../../core/utils/Flex";
import { useViewModel } from "../../../../core/viewmodel";
import { NotificationDecoration } from "./NotificationDecoration";
import { RoomListItemHoverMenu } from "./RoomListItemHoverMenu";
import { type Room, type RoomListItemViewModel } from "./RoomListItemView";
import { MessageStatusIcon } from "./MessageStatusIcon";
import styles from "./RoomListItemView.module.css";

/**
 * Props for {@link RoomListItemContent}.
 */
export interface RoomListItemContentProps {
    /** The room item view model */
    vm: RoomListItemViewModel;
    /** Function to render the room avatar */
    renderAvatar: (room: Room) => ReactNode;
    /** Whether the item is being dragged */
    isDragging?: boolean;
}

/**
 * The inner content of a room list item: avatar, room name, message preview,
 * hover menu and notification decoration. Used both inside the full
 * {@link RoomListItemView} and inside the drag overlay.
 */
export const RoomListItemContent = memo(function RoomListItemContent({
    vm,
    renderAvatar,
    isDragging = false,
}: RoomListItemContentProps): JSX.Element {
    const item = useViewModel(vm);
    const { notification } = item;
    const showPin =
        item.isFavourite &&
        !notification.isMention &&
        !notification.isNotification &&
        !notification.isActivityNotification &&
        !notification.invited;

    return (
        <Flex
            className={classNames(styles.container, {
                [styles.dragging]: isDragging,
            })}
            gap="var(--cpd-space-3x)"
            align="center"
        >
            {renderAvatar(item.room)}
            <Flex className={styles.content} gap="var(--cpd-space-2x)" align="center" justify="space-between">
                {/* We truncate the room name when too long. Title here is to show the full name on hover */}
                <div className={styles.text}>
                    <div className={styles.topRow}>
                        <div className={styles.roomName} title={item.name} data-testid="room-name">
                            {item.name}
                            {item.userStatus && (
                                <Tooltip description={item.userStatus.text} maxWidth="30ch" maxLines={1}>
                                    <Text as="span" className={styles.userStatusEmoji}>
                                        {item.userStatus.emoji}
                                    </Text>
                                </Tooltip>
                            )}
                        </div>
                        {item.notification.muted && (
                            <NotificationsOffSolidIcon className={styles.mutedIcon} aria-hidden={true} />
                        )}
                        {(item.timestamp || item.lastMessageStatus) && (
                            <div className={styles.meta} aria-hidden={true}>
                                {item.lastMessageStatus && <MessageStatusIcon status={item.lastMessageStatus} />}
                                {item.timestamp && (
                                    <span className={styles.timestamp} title={item.timestampTitle}>
                                        {item.timestamp}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    {item.messagePreviewSender && (
                        <Text as="div" size="sm" className={classNames(styles.ellipsis, styles.previewSender)}>
                            {item.messagePreviewSender}
                        </Text>
                    )}
                    {item.messagePreview && (
                        <Text
                            as="div"
                            size="sm"
                            className={classNames(styles.preview, {
                                // Two lines of text when there is no sender line, as in other messengers.
                                [styles.previewTwoLines]: !item.messagePreviewSender,
                            })}
                            title={item.messagePreview}
                        >
                            {item.messagePreview}
                        </Text>
                    )}
                </div>
                {!isDragging && (item.showMoreOptionsMenu || item.showNotificationMenu) && (
                    <RoomListItemHoverMenu
                        showMoreOptionsMenu={item.showMoreOptionsMenu}
                        showNotificationMenu={item.showNotificationMenu}
                        vm={vm}
                    />
                )}

                {/* aria-hidden because we summarise the unread count/notification status in a11yLabel */}
                <div className={styles.notificationDecoration} aria-hidden={true}>
                    <NotificationDecoration {...item.notification} />
                    {/* Inside: a pin in place of the unread badge for favourite rooms, as in other messengers */}
                    {showPin && (
                        <PinSolidIcon
                            width="20px"
                            height="20px"
                            fill="var(--cpd-color-icon-tertiary)"
                            className="mx_RoomListItemView_inside_pin"
                            data-testid="room-list-item-pin"
                        />
                    )}
                </div>
            </Flex>
        </Flex>
    );
});
