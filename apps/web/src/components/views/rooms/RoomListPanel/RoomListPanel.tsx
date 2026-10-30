/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useState, useCallback, useContext, useEffect } from "react";
import { Flex, RoomListHeaderView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";

import { shouldShowComponent } from "../../../../customisations/helpers/UIComponents";
import { UIComponent } from "../../../../settings/UIFeature";
import { RoomListSearch } from "./RoomListSearch";
import { RoomListView } from "./RoomListView";
import { RoomListBottomBar } from "./RoomListBottomBar";
import { InsideFolderTabs } from "./InsideFolderTabs";
import { InsideMainMenu } from "./InsideMainMenu";
import { InsideComposeFab } from "./InsideComposeFab";
import { useInsideLayout } from "../../../../utils/InsideLayout";
import { _t } from "../../../../languageHandler";
import { getKeyBindingsManager } from "../../../../KeyBindingsManager";
import { KeyBindingAction } from "../../../../accessibility/KeyboardShortcuts";
import { Landmark, LandmarkNavigation } from "../../../../accessibility/LandmarkNavigation";
import { type IState as IRovingTabIndexState } from "../../../../accessibility/RovingTabIndex";
import { RoomListHeaderViewModel } from "../../../../viewmodels/room-list/RoomListHeaderViewModel";
import { useMatrixClientContext } from "../../../../contexts/MatrixClientContext";
import { SDKContext } from "../../../../contexts/SDKContext.ts";
import { useInsisStore } from "../../../../inside/insis/useInsis";
import { isInsisPreviewUser } from "../../../../inside/insis/preview";
import { leaveAssistantFolder } from "../../../../inside/insis/assistant";
import {
    AssistantSessionList,
    AssistantSessionSearch,
} from "../../../../inside/insis/views/assistant/AssistantSessionList";
import { InsideFolderStore, InsideFolderStoreEvent } from "../../../../stores/room-list-v3/InsideFolderStore";

type RoomListPanelProps = {
    /**
     * Current active space
     * See {@link RoomListSearch}
     */
    activeSpace: string;
};

/**
 * The panel of the room list
 */
export const RoomListPanel: React.FC<RoomListPanelProps> = ({ activeSpace }) => {
    const sdkContext = useContext(SDKContext);
    const displayRoomSearch = shouldShowComponent(UIComponent.FilterContainer);
    const [focusedElement, setFocusedElement] = useState<Element | null>(null);

    const onFocus = useCallback((ev: React.FocusEvent): void => {
        setFocusedElement(ev.target);
    }, []);

    const onBlur = useCallback((): void => {
        setFocusedElement(null);
    }, []);

    const onKeyDown = useCallback(
        (ev: React.KeyboardEvent, state?: IRovingTabIndexState): void => {
            if (!focusedElement) return;
            const navAction = getKeyBindingsManager().getNavigationAction(ev);
            if (navAction === KeyBindingAction.PreviousLandmark || navAction === KeyBindingAction.NextLandmark) {
                ev.stopPropagation();
                ev.preventDefault();
                LandmarkNavigation.findAndFocusNextLandmark(
                    Landmark.ROOM_SEARCH,
                    navAction === KeyBindingAction.PreviousLandmark,
                );
            }
        },
        [focusedElement],
    );

    const narrow = useInsideLayout() !== "desktop";

    // Inside: the "Помощник" folder replaces the room list with the assistant's sessions; picking any other folder
    // leaves it.
    const insis = useInsisStore();
    const assistant = insis.isAssistantFolderActive && isInsisPreviewUser();
    useEffect(() => {
        const onFolder = (): void => leaveAssistantFolder();
        InsideFolderStore.instance.on(InsideFolderStoreEvent.Changed, onFolder);
        return () => {
            InsideFolderStore.instance.off(InsideFolderStoreEvent.Changed, onFolder);
        };
    }, []);

    const matrixClient = useMatrixClientContext();
    const vm = useCreateAutoDisposedViewModel(
        () => new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore }),
    );

    return (
        <Flex
            as="nav"
            className="mx_RoomListPanel"
            direction="column"
            align="stretch"
            aria-label={_t("room_list|list_title")}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
        >
            {narrow ? (
                // Inside: narrow windows have no space panel — a menu button left of the search, the folders as
                // tabs, and a round "new message" button instead of the header, as Telegram Web.
                <>
                    <div className="mx_RoomListPanel_inside_topBar">
                        <InsideMainMenu />
                        {assistant ? (
                            <AssistantSessionSearch />
                        ) : (
                            displayRoomSearch && <RoomListSearch activeSpace={activeSpace} />
                        )}
                    </div>
                    <InsideFolderTabs />
                    {assistant ? (
                        <AssistantSessionList narrow />
                    ) : (
                        <>
                            <RoomListView />
                            <InsideComposeFab />
                        </>
                    )}
                </>
            ) : assistant ? (
                <>
                    <AssistantSessionList />
                    <RoomListBottomBar />
                </>
            ) : (
                <>
                    {displayRoomSearch && <RoomListSearch activeSpace={activeSpace} />}
                    <RoomListHeaderView vm={vm} />
                    <RoomListView />
                    <RoomListBottomBar />
                </>
            )}
        </Flex>
    );
};
