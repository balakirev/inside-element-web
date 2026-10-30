/*
Copyright 2024 New Vector Ltd.
Copyright 2019-2024 The Matrix.org Foundation C.I.C.
Copyright 2019 New Vector Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { ClientEvent, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { Toast } from "@vector-im/compound-web";
import React, { type JSX, useEffect, useState } from "react";
import classNames from "classnames";
import UserProfileIcon from "@vector-im/compound-design-tokens/assets/web/icons/user-profile";
import DevicesIcon from "@vector-im/compound-design-tokens/assets/web/icons/devices";
import VisibilityOnIcon from "@vector-im/compound-design-tokens/assets/web/icons/visibility-on";
import NotificationsIcon from "@vector-im/compound-design-tokens/assets/web/icons/notifications";
import PreferencesIcon from "@vector-im/compound-design-tokens/assets/web/icons/preferences";
import KeyboardIcon from "@vector-im/compound-design-tokens/assets/web/icons/keyboard";
import KeyIcon from "@vector-im/compound-design-tokens/assets/web/icons/key";
import SidebarIcon from "@vector-im/compound-design-tokens/assets/web/icons/sidebar";
import MicOnIcon from "@vector-im/compound-design-tokens/assets/web/icons/mic-on";
import LockIcon from "@vector-im/compound-design-tokens/assets/web/icons/lock";
import LabsIcon from "@vector-im/compound-design-tokens/assets/web/icons/labs";
import BlockIcon from "@vector-im/compound-design-tokens/assets/web/icons/block";
import HelpIcon from "@vector-im/compound-design-tokens/assets/web/icons/help";
import SearchIcon from "@vector-im/compound-design-tokens/assets/web/icons/search";
import { ToastContext, useActiveToast } from "@element-hq/web-shared-components";

import TabbedView, { Tab, useActiveTabWithDefault } from "../../structures/TabbedView";
import { _t, _td } from "../../../languageHandler";
import AccountUserSettingsTab from "../settings/tabs/user/AccountUserSettingsTab";
import SettingsStore from "../../../settings/SettingsStore";
import LabsUserSettingsTab, { showLabsFlags } from "../settings/tabs/user/LabsUserSettingsTab";
import AppearanceUserSettingsTab from "../settings/tabs/user/AppearanceUserSettingsTab";
import SecurityUserSettingsTab from "../settings/tabs/user/SecurityUserSettingsTab";
import NotificationUserSettingsTab from "../settings/tabs/user/NotificationUserSettingsTab";
import PreferencesUserSettingsTab from "../settings/tabs/user/PreferencesUserSettingsTab";
import VoiceUserSettingsTab from "../settings/tabs/user/VoiceUserSettingsTab";
import HelpUserSettingsTab from "../settings/tabs/user/HelpUserSettingsTab";
import MjolnirUserSettingsTab from "../settings/tabs/user/MjolnirUserSettingsTab";
import { UIFeature } from "../../../settings/UIFeature";
import BaseDialog from "./BaseDialog";
import SidebarUserSettingsTab from "../settings/tabs/user/SidebarUserSettingsTab";
import KeyboardUserSettingsTab from "../settings/tabs/user/KeyboardUserSettingsTab";
import SessionManagerTab from "../settings/tabs/user/SessionManagerTab";
import { UserTab } from "./UserTab";
import { type NonEmptyArray } from "../../../@types/common";
import { SDKContext } from "../../../contexts/SDKContext";
import { type SDKContextClass } from "../../../contexts/SDKContextClass";
import { useSettingValue } from "../../../hooks/useSettings";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import AccessibleButton from "../elements/AccessibleButton";
import { OwnAvatar } from "../rooms/RoomListPanel/OwnAvatarButton";
import { OwnProfileStore } from "../../../stores/OwnProfileStore";
import { UPDATE_EVENT } from "../../../stores/AsyncStore";
import {
    NoChange,
    useEventEmitterAsyncState,
    useEventEmitterState,
    type AsyncStateCallbackResult,
} from "../../../hooks/useEventEmitter";
import { IS_MAC } from "../../../Keyboard";
import { useWindowWidth } from "../../../hooks/useWindowWidth";
import { EncryptionUserSettingsTab, type State } from "../settings/tabs/user/EncryptionUserSettingsTab";

interface IProps {
    initialTabId?: UserTab;
    showMsc4108QrCode?: boolean;
    /*
     * If true, the Account tab's status control starts in custom status mode,
     * ready for the user to enter a custom status.
     */
    startCustomStatus?: boolean;
    /*
     * The initial state of the Encryption tab.
     * If undefined, the default state is used ("loading").
     */
    initialEncryptionState?: State;
    sdkContext: SDKContextClass;
    onFinished(this: void): void;
}

/**
 * Inside: the profile at the top of the settings, as in other messengers; opens the account tab.
 */
function SettingsProfileHeader({ onClick }: { onClick: () => void }): JSX.Element {
    const client = MatrixClientPeg.safeGet();
    const displayName = useEventEmitterState(
        OwnProfileStore.instance,
        UPDATE_EVENT,
        () => OwnProfileStore.instance.displayName,
    );
    const userId = client.getSafeUserId();
    return (
        // The dialog's focus lock focuses this, not the search field below the title: on a phone a focused
        // field would open the keyboard over the settings.
        <AccessibleButton className="mx_UserSettingsDialog_profile" onClick={onClick} data-autofocus={true}>
            <OwnAvatar size="64px" userId={userId} />
            <div className="mx_UserSettingsDialog_profile_text">
                <div className="mx_UserSettingsDialog_profile_name">{displayName ?? userId}</div>
                <div className="mx_UserSettingsDialog_profile_id">{userId}</div>
            </div>
        </AccessibleButton>
    );
}

/** Inside: below this window width the settings are one column (the same number in the Inside skin). */
const INSIDE_SETTINGS_ONE_COLUMN_WIDTH = 900;

/** Inside: a section of the settings with its group in the list (1 account, 2 app, 3 help). */
interface InsideTabEntry {
    group: number;
    tab: Tab<UserTab>;
}

/**
 * Inside: marks the first and the last visible section of each group, so the skin rounds the group and
 * separates it from the next — also when the search or a missing section (voice, Mjolnir) shortens it.
 */
function insideGroupTabs(entries: InsideTabEntry[], hidden: UserTab[]): NonEmptyArray<Tab<UserTab>> {
    const visible = entries.filter((e) => !hidden.includes(e.tab.id));
    return entries.map((e) => {
        const i = visible.indexOf(e);
        if (i < 0) return e.tab;
        const first = i === 0 || visible[i - 1].group !== e.group;
        const last = i === visible.length - 1 || visible[i + 1].group !== e.group;
        if (!first && !last) return e.tab;
        const t = e.tab;
        return new Tab(
            t.id,
            t.label,
            t.icon,
            t.body,
            t.screenName,
            classNames(t.labelClassName, {
                mx_UserSettingsDialog_groupFirst: first,
                mx_UserSettingsDialog_groupLast: last,
            }),
            t.labelSuffix,
        );
    }) as NonEmptyArray<Tab<UserTab>>;
}

/** Inside: the label of every section, for the settings search. */
const ALL_TAB_LABELS: Array<[UserTab, TranslationKey]> = [
    [UserTab.Account, _td("settings|account|title")],
    [UserTab.SessionManager, _td("settings|sessions|title")],
    [UserTab.Notifications, _td("notifications|enable_prompt_toast_title")],
    [UserTab.Voice, _td("settings|voip|title")],
    [UserTab.Appearance, _td("common|appearance")],
    [UserTab.Preferences, _td("common|preferences")],
    [UserTab.Security, _td("room_settings|security|title")],
    [UserTab.Mjolnir, _td("labs_mjolnir|title")],
    [UserTab.Encryption, _td("settings|encryption|title")],
    [UserTab.Keyboard, _td("settings|keyboard|title")],
    [UserTab.Sidebar, _td("settings|sidebar|title")],
    [UserTab.Labs, _td("common|labs")],
    [UserTab.Help, _td("setting|help_about|title")],
];

/** Inside: the sections whose name does not contain the search text. */
function insideHiddenTabIds(query: string): UserTab[] {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return [];
    return ALL_TAB_LABELS.filter(([, label]) => !_t(label).toLocaleLowerCase().includes(q)).map(([id]) => id);
}

/** Inside: the search field at the top of the settings list. */
function SettingsSearch({ query, onChange }: { query: string; onChange: (query: string) => void }): JSX.Element {
    const placeholder = _t("settings|inside_search");
    return (
        <label className="mx_UserSettingsDialog_search mx_no_textinput">
            <SearchIcon className="mx_UserSettingsDialog_search_icon" aria-hidden={true} />
            <input
                type="search"
                value={query}
                placeholder={placeholder}
                aria-label={placeholder}
                autoComplete="off"
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    // Escape clears the search first, then closes the settings.
                    if (e.key === "Escape" && query) {
                        e.stopPropagation();
                        onChange("");
                    }
                }}
            />
        </label>
    );
}

/** Inside: the number of the user's sessions, shown next to Devices. */
function useSessionCount(sdkContext: SDKContextClass): number | null {
    const [count, setCount] = useState<number | null>(null);
    useEffect(() => {
        let cancelled = false;
        sdkContext.client
            ?.getDevices()
            .then(({ devices }) => {
                if (!cancelled) setCount(devices.length);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [sdkContext]);
    return count;
}

function titleForTabID(tabId: UserTab): React.ReactNode {
    const subs = {
        strong: (sub: string) => <span className="mx_UserSettingsDialog_title_strong">{sub}</span>,
    };
    switch (tabId) {
        case UserTab.Account:
            return _t("settings|account|dialog_title", undefined, subs);
        case UserTab.SessionManager:
            return _t("settings|sessions|dialog_title", undefined, subs);
        case UserTab.Appearance:
            return _t("settings|appearance|dialog_title", undefined, subs);
        case UserTab.Notifications:
            return _t("settings|notifications|dialog_title", undefined, subs);
        case UserTab.Preferences:
            return _t("settings|preferences|dialog_title", undefined, subs);
        case UserTab.Keyboard:
            return _t("settings|keyboard|dialog_title", undefined, subs);
        case UserTab.Sidebar:
            return _t("settings|sidebar|dialog_title", undefined, subs);
        case UserTab.Voice:
            return _t("settings|voip|dialog_title", undefined, subs);
        case UserTab.Security:
            return _t("settings|security|dialog_title", undefined, subs);
        case UserTab.Encryption:
            return _t("settings|encryption|dialog_title", undefined, subs);
        case UserTab.Labs:
            return _t("settings|labs|dialog_title", undefined, subs);
        case UserTab.Mjolnir:
            return _t("settings|labs_mjolnir|dialog_title", undefined, subs);
        case UserTab.Help:
            return _t("setting|help_about|dialog_title", undefined, subs);
    }
}

export default function UserSettingsDialog(props: IProps): JSX.Element {
    const voipEnabled = useSettingValue(UIFeature.Voip);
    const mjolnirEnabled = useSettingValue("feature_mjolnir");
    // store these props in state as changing tabs back and forth should clear them
    const [showMsc4108QrCode, setShowMsc4108QrCode] = useState(props.showMsc4108QrCode);
    const [initialEncryptionState, setInitialEncryptionState] = useState(props.initialEncryptionState);
    const [startCustomStatus, setStartCustomStatus] = useState(props.startCustomStatus);
    // Inside: the settings search filters the sections by name; the number of sessions next to Devices.
    const [query, setQuery] = useState("");
    const sessionCount = useSessionCount(props.sdkContext);
    const hiddenTabIds = insideHiddenTabIds(query);
    // Inside: in a narrow window the settings are one column, as in Telegram: the list of sections, a
    // section opens over it and "back" returns to the list. Opened without a section, it starts on the list.
    const oneColumn = useWindowWidth() < INSIDE_SETTINGS_ONE_COLUMN_WIDTH;
    const [showList, setShowList] = useState(!props.initialTabId);

    // If the user doesn't have Recovery set up (no default Secret Storage key),
    // we show an indicator on the Encryption tab.
    const showSetupRecoveryIndicator = useEventEmitterAsyncState(
        props.sdkContext.client,
        ClientEvent.AccountData,
        async (event?: MatrixEvent): AsyncStateCallbackResult<boolean> => {
            if (event === undefined || event.getType() === "m.secret_storage.default_key") {
                const client = props.sdkContext.client;
                if (!client) {
                    return false;
                }

                return !(await client.secretStorage.getDefaultKeyId());
            }
            return new NoChange();
        },
        [],
        false,
    );

    // Inside: the sections in groups as the Lobby settings screen: account and devices; notifications,
    // appearance, preferences (language), security, encryption; keyboard, sidebar, labs, help.
    const getTabs = (): NonEmptyArray<Tab<UserTab>> => {
        const entries: InsideTabEntry[] = [];

        entries.push({
            group: 1,
            tab: new Tab(
                UserTab.Account,
                _td("settings|account|title"),
                <UserProfileIcon />,
                <AccountUserSettingsTab closeSettingsFn={props.onFinished} startCustomStatus={startCustomStatus} />,
                "UserSettingsGeneral",
            ),
        });
        entries.push({
            group: 1,
            tab: new Tab(
                UserTab.SessionManager,
                _td("settings|sessions|title"),
                <DevicesIcon />,
                <SessionManagerTab showMsc4108QrCode={showMsc4108QrCode} />,
                undefined,
                undefined,
                sessionCount ?? undefined,
            ),
        });
        entries.push({
            group: 2,
            tab: new Tab(
                UserTab.Notifications,
                _td("notifications|enable_prompt_toast_title"),
                <NotificationsIcon />,
                <NotificationUserSettingsTab />,
                "UserSettingsNotifications",
            ),
        });
        if (voipEnabled) {
            entries.push({
                group: 2,
                tab: new Tab(
                    UserTab.Voice,
                    _td("settings|voip|title"),
                    <MicOnIcon />,
                    <VoiceUserSettingsTab />,
                    "UserSettingsVoiceVideo",
                ),
            });
        }
        entries.push({
            group: 2,
            tab: new Tab(
                UserTab.Appearance,
                _td("common|appearance"),
                <VisibilityOnIcon />,
                <AppearanceUserSettingsTab />,
                "UserSettingsAppearance",
            ),
        });
        entries.push({
            group: 2,
            tab: new Tab(
                UserTab.Preferences,
                _td("common|preferences"),
                <PreferencesIcon />,
                <PreferencesUserSettingsTab />,
                "UserSettingsPreferences",
            ),
        });
        entries.push({
            group: 2,
            tab: new Tab(
                UserTab.Security,
                _td("room_settings|security|title"),
                <LockIcon />,
                <SecurityUserSettingsTab />,
                "UserSettingsSecurityPrivacy",
            ),
        });
        if (mjolnirEnabled) {
            entries.push({
                group: 2,
                tab: new Tab(
                    UserTab.Mjolnir,
                    _td("labs_mjolnir|title"),
                    <BlockIcon />,
                    <MjolnirUserSettingsTab />,
                    "UserSettingMjolnir",
                ),
            });
        }
        entries.push({
            group: 2,
            tab: new Tab(
                UserTab.Encryption,
                _td("settings|encryption|title"),
                <KeyIcon />,
                <EncryptionUserSettingsTab initialState={initialEncryptionState} />,
                "UserSettingsEncryption",
                showSetupRecoveryIndicator ? "mx_SettingsDialog_tabLabelsAlert" : undefined,
            ),
        });
        entries.push({
            group: 3,
            tab: new Tab(
                UserTab.Keyboard,
                _td("settings|keyboard|title"),
                <KeyboardIcon />,
                <KeyboardUserSettingsTab />,
                "UserSettingsKeyboard",
                undefined,
                <span className="mx_UserSettingsDialog_shortcut">{IS_MAC ? "⌘ /" : "Ctrl /"}</span>,
            ),
        });
        entries.push({
            group: 3,
            tab: new Tab(
                UserTab.Sidebar,
                _td("settings|sidebar|title"),
                <SidebarIcon />,
                <SidebarUserSettingsTab />,
                "UserSettingsSidebar",
            ),
        });
        if (showLabsFlags() || SettingsStore.getFeatureSettingNames().some((k) => SettingsStore.getBetaInfo(k))) {
            entries.push({
                group: 3,
                tab: new Tab(
                    UserTab.Labs,
                    _td("common|labs"),
                    <LabsIcon />,
                    <LabsUserSettingsTab />,
                    "UserSettingsLabs",
                ),
            });
        }
        entries.push({
            group: 3,
            tab: new Tab(
                UserTab.Help,
                _td("setting|help_about|title"),
                <HelpIcon />,
                <HelpUserSettingsTab />,
                "UserSettingsHelpAbout",
            ),
        });

        return insideGroupTabs(entries, hiddenTabIds);
    };

    const [activeTabId, _setActiveTabId] = useActiveTabWithDefault(getTabs(), UserTab.Account, props.initialTabId);
    const setActiveTabId = (tabId: UserTab): void => {
        _setActiveTabId(tabId);
        setShowList(false);
        // Clear these so switching away from the tab and back to it will not show the QR code again
        setShowMsc4108QrCode(false);
        setInitialEncryptionState(undefined);
        setStartCustomStatus(false);
    };

    const [activeToast, toastRack] = useActiveToast();
    const tabs = getTabs();

    return (
        // XXX: SDKContext is provided within the LoggedInView subtree.
        // Modals function outside the MatrixChat React tree, so sdkContext is reprovided here to simulate that.
        // The longer term solution is to move our ModalManager into the React tree to inherit contexts properly.
        <SDKContext.Provider value={props.sdkContext}>
            <ToastContext.Provider value={toastRack}>
                <BaseDialog
                    className={classNames("mx_UserSettingsDialog", {
                        mx_UserSettingsDialog_inside_oneColumn: oneColumn,
                        mx_UserSettingsDialog_inside_list: oneColumn && showList,
                    })}
                    hasCancel={true}
                    onFinished={oneColumn && !showList ? () => setShowList(true) : props.onFinished}
                    title={titleForTabID(activeTabId)}
                    titleClass="mx_UserSettingsDialog_title"
                >
                    <div className="mx_SettingsDialog_content">
                        <TabbedView
                            tabs={tabs}
                            activeTabId={activeTabId}
                            screenName="UserSettings"
                            onChange={setActiveTabId}
                            responsive={true}
                            hiddenTabIds={hiddenTabIds}
                            tabListHeader={
                                <>
                                    <SettingsSearch query={query} onChange={setQuery} />
                                    {query ? (
                                        tabs.every((t) => hiddenTabIds.includes(t.id)) && (
                                            <div className="mx_UserSettingsDialog_searchEmpty">
                                                {_t("settings|inside_search_empty")}
                                            </div>
                                        )
                                    ) : (
                                        <SettingsProfileHeader onClick={() => setActiveTabId(UserTab.Account)} />
                                    )}
                                </>
                            }
                        />
                    </div>
                    <div className="mx_SettingsDialog_toastContainer">
                        {activeToast && <Toast>{activeToast}</Toast>}
                    </div>
                </BaseDialog>
            </ToastContext.Provider>
        </SDKContext.Provider>
    );
}
