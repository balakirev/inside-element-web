/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import {
    EventType,
    HistoryVisibility,
    JoinRule,
    type MatrixClient,
    MatrixEvent,
    type MRoomTopicEventContent,
    Room,
    RoomMember,
    User,
} from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { fireEvent, render, screen } from "test-utils-rtl";
import { type ReactElement } from "react";
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi, type Mocked } from "vitest";
import React from "react";

import { createTestClient, stubClient } from "test-utils";
import { hasText, textForEvent } from "./TextForEvent";
import SettingsStore from "./settings/SettingsStore";
import { MatrixClientPeg } from "./MatrixClientPeg";
import { getSenderName } from "./utils/event/getSenderName";
import { ElementCallEventType } from "./call-types";
import defaultDispatcher from "./dispatcher/dispatcher";
import { Action } from "./dispatcher/actions";

vi.mock("./settings/SettingsStore");

function mockPinnedEvent(pinnedMessageIds?: string[], prevPinnedMessageIds?: string[]): MatrixEvent {
    return new MatrixEvent({
        type: "m.room.pinned_events",
        state_key: "",
        sender: "@foo:example.com",
        content: {
            pinned: pinnedMessageIds,
        },
        unsigned: {
            prev_content: {
                pinned: prevPinnedMessageIds,
            },
        },
    });
}

describe("TextForEvent", () => {
    const mockClient = createTestClient();

    describe("getSenderName()", () => {
        it("Prefers sender.name", () => {
            expect(getSenderName({ sender: { name: "Alice" } } as MatrixEvent)).toBe("Alice");
        });
        it("Handles missing sender", () => {
            expect(getSenderName({ getSender: () => "Alice" } as MatrixEvent)).toBe("Alice");
        });
        it("Handles missing sender and get sender", () => {
            expect(getSenderName({ getSender: () => undefined } as MatrixEvent)).toBe("Someone");
        });
    });

    describe("TextForPinnedEvent", () => {
        it("mentions message when a single message was pinned, with no previously pinned messages", () => {
            const event = mockPinnedEvent(["message-1"]);
            const plainText = textForEvent(event, mockClient);
            const component = render(textForEvent(event, mockClient, true) as ReactElement);

            const expectedText = "@foo:example.com pinned a message to this room. See all pinned messages.";
            expect(plainText).toBe(expectedText);
            expect(component.container).toHaveTextContent(expectedText);
        });

        it("mentions message when a single message was pinned, with multiple previously pinned messages", () => {
            const event = mockPinnedEvent(["message-1", "message-2", "message-3"], ["message-1", "message-2"]);
            const plainText = textForEvent(event, mockClient);
            const component = render(textForEvent(event, mockClient, true) as ReactElement);

            const expectedText = "@foo:example.com pinned a message to this room. See all pinned messages.";
            expect(plainText).toBe(expectedText);
            expect(component.container).toHaveTextContent(expectedText);
        });

        it("mentions message when a single message was unpinned, with a single message previously pinned", () => {
            const event = mockPinnedEvent([], ["message-1"]);
            const plainText = textForEvent(event, mockClient);
            const component = render(textForEvent(event, mockClient, true) as ReactElement);

            const expectedText = "@foo:example.com unpinned a message from this room. See all pinned messages.";
            expect(plainText).toBe(expectedText);
            expect(component.container).toHaveTextContent(expectedText);
        });

        it("mentions message when a single message was unpinned, with multiple previously pinned messages", () => {
            const event = mockPinnedEvent(["message-2"], ["message-1", "message-2"]);
            const plainText = textForEvent(event, mockClient);
            const component = render(textForEvent(event, mockClient, true) as ReactElement);

            const expectedText = "@foo:example.com unpinned a message from this room. See all pinned messages.";
            expect(plainText).toBe(expectedText);
            expect(component.container).toHaveTextContent(expectedText);
        });

        it("shows generic text when multiple messages were pinned", () => {
            const event = mockPinnedEvent(["message-1", "message-2", "message-3"], ["message-1"]);
            const plainText = textForEvent(event, mockClient);
            const component = render(textForEvent(event, mockClient, true) as ReactElement);

            const expectedText = "@foo:example.com changed the pinned messages for the room.";
            expect(plainText).toBe(expectedText);
            expect(component.container).toHaveTextContent(expectedText);
        });

        it("shows generic text when multiple messages were unpinned", () => {
            const event = mockPinnedEvent(["message-3"], ["message-1", "message-2", "message-3"]);
            const plainText = textForEvent(event, mockClient);
            const component = render(textForEvent(event, mockClient, true) as ReactElement);

            const expectedText = "@foo:example.com changed the pinned messages for the room.";
            expect(plainText).toBe(expectedText);
            expect(component.container).toHaveTextContent(expectedText);
        });

        it("shows generic text when one message was pinned, and another unpinned", () => {
            const event = mockPinnedEvent(["message-2"], ["message-1"]);
            const plainText = textForEvent(event, mockClient);
            const component = render(textForEvent(event, mockClient, true) as ReactElement);

            const expectedText = "@foo:example.com changed the pinned messages for the room.";
            expect(plainText).toBe(expectedText);
            expect(component.container).toHaveTextContent(expectedText);
        });
    });

    describe("textForPowerEvent()", () => {
        let mockClient: Mocked<MatrixClient>;
        const mockRoom = {
            getMember: vi.fn(),
        } as unknown as Mocked<Room>;

        const userA = {
            userId: "@a",
            name: "Alice",
            rawDisplayName: "Alice",
        } as RoomMember;
        const userB = {
            userId: "@b",
            name: "Bob (@b)",
            rawDisplayName: "Bob",
        } as RoomMember;
        const userC = {
            userId: "@c",
            name: "Bob (@c)",
            rawDisplayName: "Bob",
        } as RoomMember;
        interface PowerEventProps {
            usersDefault?: number;
            prevDefault?: number;
            users: Record<string, number>;
            prevUsers: Record<string, number>;
        }
        const mockPowerEvent = ({ usersDefault, prevDefault, users, prevUsers }: PowerEventProps): MatrixEvent => {
            const mxEvent = new MatrixEvent({
                type: EventType.RoomPowerLevels,
                sender: userA.userId,
                state_key: "",
                content: {
                    users_default: usersDefault,
                    users,
                },
                unsigned: {
                    prev_content: {
                        users: prevUsers,
                        users_default: prevDefault,
                    },
                },
            });
            mxEvent.sender = { name: userA.name } as RoomMember;
            return mxEvent;
        };

        beforeAll(() => {
            mockClient = createTestClient() as Mocked<MatrixClient>;
            MatrixClientPeg.get = () => mockClient;
            MatrixClientPeg.safeGet = () => mockClient;
            mockClient.getRoom.mockClear().mockReturnValue(mockRoom);
            mockRoom.getMember
                .mockClear()
                .mockImplementation((userId) => [userA, userB, userC].find((u) => u.userId === userId) || null);
            vi.mocked(SettingsStore.getValue).mockReturnValue(true);
        });

        it("returns falsy when no users have changed power level", () => {
            const event = mockPowerEvent({
                users: {
                    [userA.userId]: 100,
                },
                prevUsers: {
                    [userA.userId]: 100,
                },
            });
            expect(textForEvent(event, mockClient)).toBeFalsy();
        });

        it("returns false when users power levels have been changed by default settings", () => {
            const event = mockPowerEvent({
                usersDefault: 100,
                prevDefault: 50,
                users: {
                    [userA.userId]: 100,
                },
                prevUsers: {
                    [userA.userId]: 50,
                },
            });
            expect(textForEvent(event, mockClient)).toBeFalsy();
        });

        it("returns correct message for a single user with changed power level", () => {
            const event = mockPowerEvent({
                users: {
                    [userB.userId]: 100,
                },
                prevUsers: {
                    [userB.userId]: 50,
                },
            });
            const expectedText = "Alice changed the power level of Bob (@b) from Moderator to Admin.";
            expect(textForEvent(event, mockClient)).toEqual(expectedText);
        });

        it("returns correct message for a single user with power level changed to the default", () => {
            const event = mockPowerEvent({
                usersDefault: 20,
                prevDefault: 101,
                users: {
                    [userB.userId]: 20,
                },
                prevUsers: {
                    [userB.userId]: 50,
                },
            });
            const expectedText = "Alice changed the power level of Bob (@b) from Moderator to Default.";
            expect(textForEvent(event, mockClient)).toEqual(expectedText);
        });

        it("returns correct message for a single user with power level changed to a custom level", () => {
            const event = mockPowerEvent({
                users: {
                    [userB.userId]: -1,
                },
                prevUsers: {
                    [userB.userId]: 50,
                },
            });
            const expectedText = "Alice changed the power level of Bob (@b) from Moderator to Custom (-1).";
            expect(textForEvent(event, mockClient)).toEqual(expectedText);
        });

        it("returns correct message for a multiple power level changes", () => {
            const event = mockPowerEvent({
                users: {
                    [userB.userId]: 100,
                    [userC.userId]: 50,
                },
                prevUsers: {
                    [userB.userId]: 50,
                    [userC.userId]: 101,
                },
            });
            const expectedText =
                "Alice changed the power level of Bob (@b) from Moderator to Admin," +
                " Bob (@c) from Custom (101) to Moderator.";
            expect(textForEvent(event, mockClient)).toEqual(expectedText);
        });
    });

    describe("textForCanonicalAliasEvent()", () => {
        const userA = {
            userId: "@a",
            name: "Alice",
        };

        interface AliasEventProps {
            alias?: string;
            prevAlias?: string;
            altAliases?: string[];
            prevAltAliases?: string[];
        }
        const mockEvent = ({ alias, prevAlias, altAliases, prevAltAliases }: AliasEventProps): MatrixEvent =>
            new MatrixEvent({
                type: EventType.RoomCanonicalAlias,
                sender: userA.userId,
                state_key: "",
                content: {
                    alias,
                    alt_aliases: altAliases,
                },
                unsigned: {
                    prev_content: {
                        alias: prevAlias,
                        alt_aliases: prevAltAliases,
                    },
                },
            });

        type TestCase = [string, AliasEventProps & { result: string }];
        const testCases: TestCase[] = [
            [
                "room alias didn't change",
                {
                    result: "@a changed the addresses for this chat.",
                },
            ],
            [
                "room alias changed",
                {
                    alias: "banana",
                    prevAlias: "apple",
                    result: "@a set the main address for this chat to banana.",
                },
            ],
            [
                "room alias was added",
                {
                    alias: "banana",
                    result: "@a set the main address for this chat to banana.",
                },
            ],
            [
                "room alias was removed",
                {
                    prevAlias: "apple",
                    result: "@a removed the main address for this chat.",
                },
            ],
            [
                "added an alt alias",
                {
                    altAliases: ["canteloupe"],
                    result: "@a added alternative address canteloupe for this chat.",
                },
            ],
            [
                "added multiple alt aliases",
                {
                    altAliases: ["canteloupe", "date"],
                    result: "@a added the alternative addresses canteloupe, date for this chat.",
                },
            ],
            [
                "removed an alt alias",
                {
                    altAliases: ["canteloupe"],
                    prevAltAliases: ["canteloupe", "date"],
                    result: "@a removed alternative address date for this chat.",
                },
            ],
            [
                "added and removed an alt aliases",
                {
                    altAliases: ["canteloupe", "elderberry"],
                    prevAltAliases: ["canteloupe", "date"],
                    result: "@a changed the alternative addresses for this chat.",
                },
            ],
            [
                "changed alias and added alt alias",
                {
                    alias: "banana",
                    prevAlias: "apple",
                    altAliases: ["canteloupe"],
                    result: "@a changed the main and alternative addresses for this chat.",
                },
            ],
        ];

        it.each(testCases)("returns correct message when %s", (_d, { result, ...eventProps }) => {
            const event = mockEvent(eventProps);
            expect(textForEvent(event, mockClient)).toEqual(result);
        });
    });

    describe("textForPollStartEvent()", () => {
        let pollEvent: MatrixEvent;

        beforeEach(() => {
            pollEvent = new MatrixEvent({
                type: "org.matrix.msc3381.poll.start",
                sender: "@a",
                content: {
                    "org.matrix.msc3381.poll.start": {
                        answers: [{ "org.matrix.msc1767.text": "option1" }, { "org.matrix.msc1767.text": "option2" }],
                        question: {
                            "body": "Test poll name",
                            "msgtype": "m.text",
                            "org.matrix.msc1767.text": "Test poll name",
                        },
                    },
                },
            });
        });

        it("returns correct message for redacted poll start", () => {
            pollEvent.makeRedacted(pollEvent, new Room(pollEvent.getRoomId()!, mockClient, mockClient.getSafeUserId()));

            expect(textForEvent(pollEvent, mockClient)).toEqual("@a: Message deleted");
        });

        it("returns correct message for normal poll start", () => {
            expect(textForEvent(pollEvent, mockClient)).toEqual("@a has started a poll - ");
        });
    });

    describe("textForMessageEvent()", () => {
        let messageEvent: MatrixEvent;

        beforeEach(() => {
            messageEvent = new MatrixEvent({
                type: "m.room.message",
                sender: "@a",
                content: {
                    "body": "test message",
                    "msgtype": "m.text",
                    "org.matrix.msc1767.text": "test message",
                },
            });
        });

        it("returns correct message for redacted message", () => {
            messageEvent.makeRedacted(
                messageEvent,
                new Room(messageEvent.getRoomId()!, mockClient, mockClient.getSafeUserId()),
            );

            expect(textForEvent(messageEvent, mockClient)).toEqual("@a: Message deleted");
        });

        it("returns correct message for normal message", () => {
            expect(textForEvent(messageEvent, mockClient)).toEqual("@a: test message");
        });
    });

    describe("textForCallEvent()", () => {
        let mockClient: MatrixClient;
        let callEvent: MatrixEvent;

        beforeEach(() => {
            stubClient();
            mockClient = MatrixClientPeg.safeGet();

            vi.mocked(mockClient.getRoom).mockReturnValue({
                name: "Test room",
            } as unknown as Room);

            callEvent = {
                getRoomId: vi.fn(),
                getType: vi.fn(),
                isState: vi.fn().mockReturnValue(true),
            } as unknown as MatrixEvent;
        });

        describe.each(ElementCallEventType.names)("eventType=%s", (eventType: string) => {
            beforeEach(() => {
                vi.mocked(callEvent).getType.mockReturnValue(eventType);
            });

            it("returns correct message for call event when supported", () => {
                expect(textForEvent(callEvent, mockClient)).toEqual("Video call started in Test room.");
            });

            it("returns correct message for call event when not supported", () => {
                vi.mocked(mockClient).supportsVoip.mockReturnValue(false);

                expect(textForEvent(callEvent, mockClient)).toEqual(
                    "Video call started in Test room. (not supported by this browser)",
                );
            });
        });
    });

    describe("textForCallInviteEvent()", () => {
        let mockClient: MatrixClient;
        let callInviteEvent: MatrixEvent;

        beforeEach(() => {
            stubClient();
            mockClient = MatrixClientPeg.safeGet();

            vi.mocked(mockClient.supportsVoip).mockReturnValue(true);

            callInviteEvent = {
                getSender: vi.fn().mockReturnValue("@alice:matrix.org"),
                sender: { name: "Alice" },
                getContent: vi.fn().mockReturnValue({}),
                getType: vi.fn().mockReturnValue(EventType.CallInvite),
                isState: vi.fn().mockReturnValue(false),
            } as unknown as MatrixEvent;
        });

        it("returns correct message for legacy voice call invite", () => {
            vi.mocked(callInviteEvent).getContent.mockReturnValue({ offer: { sdp: "m=audio" } });
            expect(textForEvent(callInviteEvent, mockClient)).toEqual("Alice placed a voice call.");
        });

        it("returns correct message for legacy video call invite", () => {
            vi.mocked(callInviteEvent).getContent.mockReturnValue({ offer: { sdp: "m=video" } });
            expect(textForEvent(callInviteEvent, mockClient)).toEqual("Alice placed a video call.");
        });

        it("returns correct message for MSC4075 voice call", () => {
            vi.mocked(callInviteEvent).getType.mockReturnValue(EventType.RTCNotification);
            vi.mocked(callInviteEvent).getContent.mockReturnValue({ "m.call.intent": "audio" });
            expect(textForEvent(callInviteEvent, mockClient)).toEqual("Alice placed a voice call.");
        });

        it("returns correct message for MSC4075 video call", () => {
            vi.mocked(callInviteEvent).getType.mockReturnValue(EventType.RTCNotification);
            vi.mocked(callInviteEvent).getContent.mockReturnValue({ "m.call.intent": "video" });
            expect(textForEvent(callInviteEvent, mockClient)).toEqual("Alice placed a video call.");
        });
    });

    describe("textForMemberEvent()", () => {
        beforeEach(() => {
            stubClient();
        });

        it("should handle both displayname and avatar changing in one event", () => {
            expect(
                textForEvent(
                    new MatrixEvent({
                        type: "m.room.member",
                        sender: "@a:foo",
                        content: {
                            membership: KnownMembership.Join,
                            avatar_url: "b",
                            displayname: "Bob",
                        },
                        unsigned: {
                            prev_content: {
                                membership: KnownMembership.Join,
                                avatar_url: "a",
                                displayname: "Andy",
                            },
                        },
                        state_key: "@a:foo",
                    }),
                    mockClient,
                ),
            ).toMatchInlineSnapshot(`"Andy changed their display name and profile picture"`);
        });

        it("names same-named members without their Matrix ID", () => {
            const event = new MatrixEvent({
                type: "m.room.member",
                sender: "@dmitry:foo",
                content: { membership: KnownMembership.Invite, displayname: "Дмитрий" },
                state_key: "@testuser:foo",
            });
            const sender = new RoomMember("!room:foo", "@dmitry:foo");
            sender.rawDisplayName = "Дмитрий";
            sender.disambiguate = true;
            sender.name = "Дмитрий (@dmitry:foo)";
            const target = new RoomMember("!room:foo", "@testuser:foo");
            target.rawDisplayName = "Дмитрий";
            target.disambiguate = true;
            target.name = "Дмитрий (@testuser:foo)";
            event.sender = sender;
            event.target = target;

            expect(textForEvent(event, mockClient)).toBe("Дмитрий invited Дмитрий");
        });

        describe("knocks", () => {
            const knockEvent = (reason?: string): MatrixEvent =>
                new MatrixEvent({
                    type: "m.room.member",
                    sender: "@a:foo",
                    content: {
                        membership: KnownMembership.Knock,
                        reason,
                    },
                    state_key: "@a:foo",
                });

            beforeEach(() => {
                vi.mocked(SettingsStore.getValue).mockImplementation((name) => name === "feature_ask_to_join");
            });

            afterEach(() => {
                vi.mocked(SettingsStore.getValue).mockReturnValue(true);
            });

            it("should handle knocks", () => {
                expect(textForEvent(knockEvent(), mockClient)).toMatchInlineSnapshot(`"Member is requesting to join"`);
            });

            it("should handle knocks with a reason", () => {
                expect(textForEvent(knockEvent("Let me in please!"), mockClient)).toMatchInlineSnapshot(
                    `"Member is requesting to join: Let me in please!"`,
                );
            });

            it("should handle an accepted knock", () => {
                expect(
                    textForEvent(
                        new MatrixEvent({
                            type: "m.room.member",
                            sender: "@b:foo",
                            content: { membership: KnownMembership.Invite },
                            unsigned: { prev_content: { membership: KnownMembership.Knock } },
                            state_key: "@a:foo",
                        }),
                        mockClient,
                    ),
                ).toMatchInlineSnapshot(`"Member granted access to Member"`);
            });

            it("should handle a retracted knock", () => {
                expect(
                    textForEvent(
                        new MatrixEvent({
                            type: "m.room.member",
                            sender: "@a:foo",
                            content: { membership: KnownMembership.Leave },
                            unsigned: { prev_content: { membership: KnownMembership.Knock } },
                            state_key: "@a:foo",
                        }),
                        mockClient,
                    ),
                ).toMatchInlineSnapshot(`"Member withdrew their request to join"`);
            });

            it("should handle a denied knock", () => {
                expect(
                    textForEvent(
                        new MatrixEvent({
                            type: "m.room.member",
                            sender: "@b:foo",
                            content: { membership: KnownMembership.Leave },
                            unsigned: { prev_content: { membership: KnownMembership.Knock } },
                            state_key: "@a:foo",
                        }),
                        mockClient,
                    ),
                ).toMatchInlineSnapshot(`"Member rejected the request to join from Member"`);
            });

            it("should fall back to the plain invite copy when the ask to join labs flag is disabled", () => {
                vi.mocked(SettingsStore.getValue).mockReturnValue(false);
                expect(
                    textForEvent(
                        new MatrixEvent({
                            type: "m.room.member",
                            sender: "@b:foo",
                            content: { membership: KnownMembership.Invite },
                            unsigned: { prev_content: { membership: KnownMembership.Knock } },
                            state_key: "@a:foo",
                        }),
                        mockClient,
                    ),
                ).toMatchInlineSnapshot(`"Member invited Member"`);
            });

            it("should hide knocks when the ask to join labs flag is disabled", () => {
                vi.mocked(SettingsStore.getValue).mockReturnValue(false);
                expect(textForEvent(knockEvent(), mockClient)).toEqual("");
            });
        });

        it("should handle rejected invites", () => {
            expect(
                textForEvent(
                    new MatrixEvent({
                        type: "m.room.member",
                        sender: "@a:foo",
                        content: {
                            membership: KnownMembership.Leave,
                        },
                        unsigned: {
                            prev_content: {
                                membership: KnownMembership.Invite,
                            },
                        },
                        state_key: "@a:foo",
                    }),
                    mockClient,
                ),
            ).toMatchInlineSnapshot(`"Member rejected the invitation"`);
        });

        it("should handle rejected invites with a reason", () => {
            expect(
                textForEvent(
                    new MatrixEvent({
                        type: "m.room.member",
                        sender: "@a:foo",
                        content: {
                            membership: KnownMembership.Leave,
                            reason: "I don't want to be in this room.",
                        },
                        unsigned: {
                            prev_content: {
                                membership: KnownMembership.Invite,
                            },
                        },
                        state_key: "@a:foo",
                    }),
                    mockClient,
                ),
            ).toMatchInlineSnapshot(`"Member rejected the invitation: I don't want to be in this room."`);
        });

        it("shows single-user bans with a spoiler on display name", () => {
            vi.mocked(mockClient.getRoom).mockReturnValue({
                getMember: vi.fn().mockImplementation((userId) => {
                    return { rawDisplayName: userId === "@admin:example.com" ? "Admin" : "Bad User" };
                }),
            } as unknown as Mocked<Room>);

            // Inside: the banning member's name is a button opening their user card; the target stays a spoiler.
            const { container } = render(textForEvent(banEventWithReason(), mockClient, true) as ReactElement);
            expect(container).toHaveTextContent("Admin banned Bad User: bad behaviour");
            expect(container.querySelector(".mx_InsideServiceName")).toHaveTextContent("Admin");
            expect(container.querySelector(".mx_InsideServiceName")).toHaveAttribute(
                "data-user-id",
                "@admin:example.com",
            );
            expect(container.querySelector(".mx_EventTile_spoiler")).toHaveTextContent("Bad User");
        });

        it("hides user name for single-user bans with reason when JSX is not allowed", () => {
            vi.mocked(mockClient.getRoom).mockReturnValue({
                getMember: vi.fn().mockImplementation((userId) => {
                    return { rawDisplayName: userId === "@admin:example.com" ? "Admin" : "Bad User" };
                }),
            } as unknown as Mocked<Room>);

            expect(textForEvent(banEventWithReason(), mockClient)).toEqual("Admin banned a user: bad behaviour");
        });

        it("shows single-user bans with a spoiler on user ID", () => {
            vi.mocked(mockClient.getRoom).mockReturnValue({
                getMember: vi.fn().mockReturnValue({ rawDisplayName: undefined }),
            } as unknown as Mocked<Room>);

            const { container } = render(textForEvent(banEvent(), mockClient, true) as ReactElement);
            expect(container).toHaveTextContent("@admin:example.com banned @bad_name:bad_server.co");
            expect(container.querySelector(".mx_InsideServiceName")).toHaveTextContent("@admin:example.com");
            expect(container.querySelector(".mx_EventTile_spoiler")).toHaveTextContent("@bad_name:bad_server.co");
        });

        it("hides user name for single-user bans when JSX is not allowed", () => {
            vi.mocked(mockClient.getRoom).mockReturnValue({
                getMember: vi.fn().mockReturnValue({ rawDisplayName: undefined }),
            } as unknown as Mocked<Room>);

            expect(textForEvent(banEvent(), mockClient)).toEqual("@admin:example.com banned a user");
        });
    });

    describe("textForJoinRulesEvent()", () => {
        type TestCase = [string, { result: string }];
        const testCases: TestCase[] = [
            [JoinRule.Public, { result: "@a made the room public to whoever knows the link." }],
            [JoinRule.Invite, { result: "@a made the room invite only." }],
            [JoinRule.Knock, { result: "@a changed the join rule to ask to join." }],
            [JoinRule.Restricted, { result: "@a changed who can join this room." }],
        ];

        it.each(testCases)("returns correct message when room join rule changed to %s", (joinRule, { result }) => {
            expect(
                textForEvent(
                    new MatrixEvent({
                        type: "m.room.join_rules",
                        sender: "@a",
                        content: {
                            join_rule: joinRule,
                        },
                        state_key: "",
                    }),
                    mockClient,
                ),
            ).toEqual(result);
        });

        it(`returns correct JSX message when room join rule changed to ${JoinRule.Restricted}`, () => {
            expect(
                textForEvent(
                    new MatrixEvent({
                        type: "m.room.join_rules",
                        sender: "@a",
                        content: {
                            join_rule: JoinRule.Restricted,
                        },
                        state_key: "",
                    }),
                    mockClient,
                    true,
                ),
            ).toMatchSnapshot();
        });

        it("returns correct default message", () => {
            expect(
                textForEvent(
                    new MatrixEvent({
                        type: "m.room.join_rules",
                        sender: "@a",
                        content: {
                            join_rule: "a not implemented one",
                        },
                        state_key: "",
                    }),
                    mockClient,
                ),
            ).toEqual("@a changed the join rule to a not implemented one");
        });
    });

    describe("textForHistoryVisibilityEvent()", () => {
        type TestCase = [string, { result: string }];
        const testCases: TestCase[] = [
            [
                HistoryVisibility.Invited,
                { result: "@a made future room history visible to all room members, from the point they are invited." },
            ],
            [
                HistoryVisibility.Joined,
                { result: "@a made future room history visible to all room members, from the point they joined." },
            ],
            [HistoryVisibility.Shared, { result: "@a made future room history visible to all room members." }],
            [HistoryVisibility.WorldReadable, { result: "@a made future room history visible to anyone." }],
        ];

        it.each(testCases)(
            "returns correct message when room join rule changed to %s",
            (historyVisibility, { result }) => {
                expect(
                    textForEvent(
                        new MatrixEvent({
                            type: "m.room.history_visibility",
                            sender: "@a",
                            content: {
                                history_visibility: historyVisibility,
                            },
                            state_key: "",
                        }),
                        mockClient,
                    ),
                ).toEqual(result);
            },
        );
    });

    describe("textForTopicEvent()", () => {
        type TestCase = [string, MRoomTopicEventContent, { result: string }];
        const testCases: TestCase[] = [
            ["the legacy key", { topic: "My topic" }, { result: '@a changed the topic to "My topic".' }],
            [
                "the legacy key with an empty m.topic key",
                { "topic": "My topic", "m.topic": { "m.text": [] } },
                { result: '@a changed the topic to "My topic".' },
            ],
            [
                "the m.topic key",
                { "topic": "Ignore this", "m.topic": { "m.text": [{ mimetype: "text/plain", body: "My topic" }] } },
                { result: '@a changed the topic to "My topic".' },
            ],
            [
                "the m.topic key and the legacy key undefined",
                { "topic": undefined, "m.topic": { "m.text": [{ mimetype: "text/plain", body: "My topic" }] } },
                { result: '@a changed the topic to "My topic".' },
            ],
            ["the legacy key undefined", { topic: undefined }, { result: "@a removed the topic." }],
            ["the legacy key empty string", { topic: "" }, { result: "@a removed the topic." }],
            [
                "both the legacy and new keys removed",
                { "topic": undefined, "m.topic": { "m.text": [] } },
                { result: "@a removed the topic." },
            ],
        ];

        it.each(testCases)("returns correct message for topic event with %s", (_caseName, content, { result }) => {
            expect(
                textForEvent(
                    new MatrixEvent({
                        type: "m.room.topic",
                        sender: "@a",
                        content: content,
                        state_key: "",
                    }),
                    mockClient,
                ),
            ).toEqual(result);
        });
    });

    describe("hasText", () => {
        it("should return true for a known handler given an invalid event", async () => {
            const cli = stubClient();
            const ev = new MatrixEvent({
                type: "m.room.name",
                content: {
                    name: { foo: "bar" },
                },
                state_key: "",
                room_id: "!roomId",
                sender: cli.getUserId()!,
            });
            expect(hasText(ev, cli, false)).toBe(true);
        });
    });

    describe("Inside: names in service messages", () => {
        const roomId = "!room:server";
        const pavel = new RoomMember(roomId, "@pavel:server");
        pavel.name = pavel.rawDisplayName = "Павел Сидоров";
        const dmitry = new RoomMember(roomId, "@dmitry:server");
        dmitry.name = dmitry.rawDisplayName = "Дмитрий Балакирев";
        const members: Record<string, RoomMember> = { [pavel.userId]: pavel, [dmitry.userId]: dmitry };

        beforeEach(() => {
            vi.mocked(mockClient.getRoom).mockReturnValue({
                getMember: vi.fn().mockImplementation((userId: string) => members[userId] ?? null),
            } as unknown as Mocked<Room>);
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        const memberEvent = (
            membership: string,
            sender: RoomMember,
            target: RoomMember,
            prevContent: Record<string, unknown> = {},
            content: Record<string, unknown> = {},
        ): MatrixEvent => {
            const ev = new MatrixEvent({
                type: EventType.RoomMember,
                room_id: roomId,
                sender: sender.userId,
                state_key: target.userId,
                content: { membership, ...content },
                unsigned: { prev_content: prevContent },
            });
            ev.sender = sender;
            ev.target = target;
            return ev;
        };

        const renderJsx = (ev: MatrixEvent): HTMLElement => render(<>{textForEvent(ev, mockClient, true)}</>).container;

        const names = (container: HTMLElement): Array<[string | null, string | null]> =>
            Array.from(container.querySelectorAll(".mx_InsideServiceName")).map((el) => [
                el.textContent,
                el.getAttribute("data-user-id"),
            ]);

        it("renders both names of an invite as buttons and keeps the plain text a string", () => {
            const ev = memberEvent(KnownMembership.Invite, pavel, dmitry);

            expect(textForEvent(ev, mockClient)).toBe("Павел Сидоров invited Дмитрий Балакирев");
            const container = renderJsx(ev);
            expect(container).toHaveTextContent("Павел Сидоров invited Дмитрий Балакирев");
            expect(names(container)).toEqual([
                ["Павел Сидоров", "@pavel:server"],
                ["Дмитрий Балакирев", "@dmitry:server"],
            ]);
            for (const el of container.querySelectorAll(".mx_InsideServiceName")) {
                expect(el).toHaveAttribute("role", "button");
                expect(el).toHaveAttribute("tabindex", "0");
            }
        });

        it("opens the user card of the clicked member", () => {
            const dispatch = vi.spyOn(defaultDispatcher, "dispatch");
            const container = renderJsx(memberEvent(KnownMembership.Invite, pavel, dmitry));

            fireEvent.click(screen.getByRole("button", { name: "Дмитрий Балакирев" }));
            expect(dispatch).toHaveBeenCalledWith({ action: Action.ViewUser, member: dmitry, push: false });

            const pavelButton = container.querySelector<HTMLElement>('[data-user-id="@pavel:server"]')!;
            fireEvent.keyDown(pavelButton, { key: "Enter" });
            expect(dispatch).toHaveBeenLastCalledWith({ action: Action.ViewUser, member: pavel, push: false });
        });

        it("falls back to the user ID when the member is not known", () => {
            const dispatch = vi.spyOn(defaultDispatcher, "dispatch");
            const ev = new MatrixEvent({
                type: EventType.RoomName,
                room_id: roomId,
                sender: "@ghost:server",
                state_key: "",
                content: { name: "Новая" },
            });

            const container = renderJsx(ev);
            fireEvent.click(container.querySelector(".mx_InsideServiceName")!);
            const payload = dispatch.mock.calls[0][0] as unknown as { member: unknown };
            expect(payload.member).toBeInstanceOf(User);
            expect((payload.member as User).userId).toBe("@ghost:server");
        });

        it.each([
            ["join", () => memberEvent(KnownMembership.Join, dmitry, dmitry), ["Дмитрий Балакирев"]],
            [
                "leave",
                () => memberEvent(KnownMembership.Leave, dmitry, dmitry, { membership: KnownMembership.Join }),
                ["Дмитрий Балакирев"],
            ],
            [
                "accept invite",
                () => memberEvent(KnownMembership.Join, dmitry, dmitry, { membership: KnownMembership.Invite }),
                ["Дмитрий Балакирев"],
            ],
            [
                "kick",
                () => memberEvent(KnownMembership.Leave, pavel, dmitry, { membership: KnownMembership.Join }),
                ["Павел Сидоров", "Дмитрий Балакирев"],
            ],
            [
                "unban",
                () => memberEvent(KnownMembership.Leave, pavel, dmitry, { membership: KnownMembership.Ban }),
                ["Павел Сидоров", "Дмитрий Балакирев"],
            ],
            [
                "withdrawn invite",
                () => memberEvent(KnownMembership.Leave, pavel, dmitry, { membership: KnownMembership.Invite }),
                ["Павел Сидоров", "Дмитрий Балакирев"],
            ],
            ["ban (target stays a spoiler)", () => memberEvent(KnownMembership.Ban, pavel, dmitry), ["Павел Сидоров"]],
            [
                "display name change",
                () =>
                    memberEvent(
                        KnownMembership.Join,
                        dmitry,
                        dmitry,
                        { membership: KnownMembership.Join, displayname: "Дима" },
                        { displayname: "Дмитрий Балакирев" },
                    ),
                ["Дима"],
            ],
            [
                "avatar change",
                () =>
                    memberEvent(
                        KnownMembership.Join,
                        dmitry,
                        dmitry,
                        { membership: KnownMembership.Join, avatar_url: "mxc://a" },
                        { avatar_url: "mxc://b" },
                    ),
                ["Дмитрий Балакирев"],
            ],
        ])("makes the names of a %s clickable", (_, makeEvent, expected) => {
            const ev = makeEvent();
            const plain = textForEvent(ev, mockClient);
            expect(typeof plain).toBe("string");
            const container = renderJsx(ev);
            // A ban says "a user" in plain text and shows the target as a spoiler in the timeline.
            expect(container).toHaveTextContent(plain.replace("a user", "Дмитрий Балакирев"));
            expect(names(container).map(([name]) => name)).toEqual(expected);
        });

        it("makes the actor and the members of a power level change clickable", () => {
            const ev = new MatrixEvent({
                type: EventType.RoomPowerLevels,
                room_id: roomId,
                sender: pavel.userId,
                state_key: "",
                content: { users: { [pavel.userId]: 100, [dmitry.userId]: 100 } },
                unsigned: { prev_content: { users: { [pavel.userId]: 100 } } },
            });
            ev.sender = pavel;

            const plain = "Павел Сидоров changed the power level of Дмитрий Балакирев from Default to Admin.";
            expect(textForEvent(ev, mockClient)).toBe(plain);
            const container = renderJsx(ev);
            expect(container).toHaveTextContent(plain);
            expect(names(container)).toEqual([
                ["Павел Сидоров", "@pavel:server"],
                ["Дмитрий Балакирев", "@dmitry:server"],
            ]);
        });

        it.each([
            [EventType.RoomName, { name: "Новая" }],
            [EventType.RoomTopic, { topic: "Тема" }],
            [EventType.RoomAvatar, { url: "mxc://avatar" }],
            [EventType.RoomPinnedEvents, { pinned: ["$a"] }],
            [EventType.RoomPinnedEvents, { pinned: ["$a", "$b"] }],
            [EventType.RoomJoinRules, { join_rule: JoinRule.Restricted }],
            [EventType.RoomHistoryVisibility, { history_visibility: HistoryVisibility.Shared }],
        ])("makes the actor of %s clickable", (type, content) => {
            const ev = new MatrixEvent({ type, room_id: roomId, sender: pavel.userId, state_key: "", content });
            ev.sender = pavel;

            const plain = textForEvent(ev, mockClient);
            expect(typeof plain).toBe("string");
            expect(plain).toContain("Павел Сидоров");
            const container = renderJsx(ev);
            // The timeline may add a link ("View settings") after the same words.
            expect(container.textContent).toContain(plain);
            expect(names(container)).toEqual([["Павел Сидоров", "@pavel:server"]]);
        });
    });
});

function banEvent(): MatrixEvent {
    return new MatrixEvent({
        type: "m.room.member",
        sender: "@admin:example.com",
        content: {
            membership: KnownMembership.Ban,
        },
        state_key: "@bad_name:bad_server.co",
    });
}

function banEventWithReason(): MatrixEvent {
    return new MatrixEvent({
        type: "m.room.member",
        sender: "@admin:example.com",
        content: {
            membership: KnownMembership.Ban,
            reason: "bad behaviour",
        },
        state_key: "@bad_name:bad_server.co",
    });
}
