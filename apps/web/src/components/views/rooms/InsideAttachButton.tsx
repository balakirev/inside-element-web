/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode, type MouseEvent } from "react";
import { IconButton } from "@vector-im/compound-web";
import { AttachmentIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import { useViewModel } from "@element-hq/web-shared-components";

import { _t } from "../../../languageHandler";
import { aboveRightOf, useContextMenu } from "../../structures/ContextMenu";
import IconizedContextMenu, {
    IconizedContextMenuOption,
    IconizedContextMenuOptionList,
} from "../context_menus/IconizedContextMenu";
import {
    INSIDE_UPLOAD_CAMERA,
    INSIDE_UPLOAD_MEDIA,
    INSIDE_UPLOAD_FILE,
    type RoomUploadViewModel,
} from "../../../viewmodels/room/RoomUploadViewModel";

/** Line icons of the attach menu, drawn like the skin's (24 px box, 1.8 stroke). */
function LineIcon({ children }: { children: ReactNode }): JSX.Element {
    return (
        <svg
            className="mx_InsideAttachMenu_icon"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {children}
        </svg>
    );
}

export const PhotoVideoIcon = (): JSX.Element => (
    <LineIcon>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <circle cx="8.5" cy="9.5" r="1.6" />
        <path d="M21 15.5l-4.6-4.6a1.5 1.5 0 0 0-2.1 0L6 19.5" />
    </LineIcon>
);

export const FileIcon = (): JSX.Element => (
    <LineIcon>
        <path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z" />
        <path d="M14 3v5h5" />
    </LineIcon>
);

export const CameraIcon = (): JSX.Element => (
    <LineIcon>
        <path d="M4.5 7.5h3l1.6-2.2a1.5 1.5 0 0 1 1.2-.6h3.4a1.5 1.5 0 0 1 1.2.6l1.6 2.2h3A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V9a1.5 1.5 0 0 1 1.5-1.5z" />
        <circle cx="12" cy="13" r="3.4" />
    </LineIcon>
);

export const PollIcon = (): JSX.Element => (
    <LineIcon>
        <path d="M5 20V11M12 20V4M19 20v-6" />
    </LineIcon>
);

const ICONS: Record<string, () => JSX.Element> = {
    [INSIDE_UPLOAD_MEDIA]: PhotoVideoIcon,
    [INSIDE_UPLOAD_FILE]: FileIcon,
    [INSIDE_UPLOAD_CAMERA]: CameraIcon,
};

interface Props {
    vm: RoomUploadViewModel;
    /** Opens the poll dialog; no poll item without it (threads, polls switched off). */
    onPoll?: () => void;
}

/**
 * Inside: the attach button opens a menu above it, as in Telegram: photo or video, file, camera (on a phone),
 * poll, and the uploaders of modules. Ctrl+click still picks the first item. The skin turns the menu into a
 * bottom sheet on a phone (`mx_InsideAttachMenu`).
 */
export function InsideAttachButton({ vm, onPoll }: Props): JSX.Element | null {
    const { options } = useViewModel(vm);
    const [menuDisplayed, buttonRef, openMenu, closeMenu] = useContextMenu<HTMLButtonElement>();

    const items: { key: string; label: string; icon: ReactNode; onSelect: () => void }[] = options.map((o) => {
        const Icon = ICONS[o.type];
        const ModuleIcon = o.icon;
        return {
            key: o.type,
            label: o.label,
            icon: Icon ? <Icon /> : ModuleIcon ? <ModuleIcon /> : <FileIcon />,
            onSelect: () => vm.onUploadOptionSelected(o.type),
        };
    });
    if (onPoll && options.length) {
        items.push({ key: "inside_poll", label: _t("composer|poll_button"), icon: <PollIcon />, onSelect: onPoll });
    }
    if (!items.length) return null;

    const onClick = (ev: MouseEvent<HTMLButtonElement>): void => {
        if (ev.ctrlKey || ev.metaKey) {
            ev.preventDefault();
            ev.stopPropagation();
            items[0].onSelect();
            return;
        }
        if (menuDisplayed) closeMenu();
        else openMenu(ev);
    };

    let menu: JSX.Element | undefined;
    if (menuDisplayed && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        menu = (
            <IconizedContextMenu
                {...aboveRightOf(rect, undefined, 8)}
                className="mx_InsideAttachMenu"
                onFinished={closeMenu}
                compact
            >
                <IconizedContextMenuOptionList>
                    {items.map((item) => (
                        <IconizedContextMenuOption
                            key={item.key}
                            className={`mx_InsideAttachMenu_option mx_InsideAttachMenu_option_${item.key}`}
                            label={item.label}
                            icon={item.icon}
                            onClick={(ev) => {
                                ev.preventDefault();
                                ev.stopPropagation();
                                closeMenu();
                                item.onSelect();
                            }}
                        />
                    ))}
                </IconizedContextMenuOptionList>
            </IconizedContextMenu>
        );
    }

    return (
        <>
            <IconButton
                ref={buttonRef}
                size="26px"
                className="mx_InsideAttachButton"
                tooltip={menuDisplayed ? undefined : _t("common|attachment")}
                aria-label={_t("common|attachment")}
                aria-haspopup="menu"
                aria-expanded={menuDisplayed}
                onClick={onClick}
                data-testid="inside-attach-button"
            >
                <AttachmentIcon />
            </IconButton>
            {menu}
        </>
    );
}
