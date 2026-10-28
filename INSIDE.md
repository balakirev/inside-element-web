# Inside Chat fork of Element Web

This is the Element Web build used by **Inside Chat**, the internal messenger of Inside Estate
(Matrix server `lobby.inside.estate`). Deployment, configuration and the visual skin live in a
separate repository, `balakirev/inside-chat`; this repository holds only changes to the app itself.

## Branches and tags

| Ref                      | Meaning                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `inside/main`            | upstream release tag (see `.inside-base`) + our commits on top |
| `inside-v<upstream>-<n>` | image that production pins to, e.g. `inside-v1.12.32-1`        |

Every Inside change is a separate, small commit on `inside/main`, so it can be re-applied on top of
the next upstream release with `git rebase --onto <new-tag> <old-tag> inside/main`.

## What we change and why

| Change                                 | Why                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caption field in the upload dialog     | Users expect to send a photo with a caption in one message, as in other messengers. Uses Matrix media captions (`body` = caption, `filename` = file name), which Element and Element X already render. The "discard caption?" question is drawn inside the dialog: `Modal` shows only the topmost dialog, so a second dialog would unmount this one and lose the caption. |
| Media in the upload dialog             | An image or a video is shown on its own with the name and size as one quiet line under it, without the file-type tile (kept for other files). The caption field takes the focus however the dialog opened (attach button, drag and drop, paste) and has a stable class `mx_UploadConfirmDialog_inside_caption` for the skin. |
| Files being sent in the timeline       | While a file uploads, the end of the room timeline shows it as an own bubble, as in Telegram: a dimmed preview of the image or video (a file bubble for other files) with a circular progress, a cancel button and "12.3 of 42.5 MB", and the caption under it (`InsidePendingUploads`). The event takes the bubble's place once it is in the timeline. A failed upload stays there with "Retry" and "Delete" instead of an error dialog. Replaces the upload bar of the room; threads keep the bar and the dialog. |
| Room list items like other messengers  | Time of the latest message on the right, the sender of group messages on its own line, sent/read ticks for the user's own latest message, a muted icon, two-line previews.                                                                                                                                                                                                |
| Quick reactions above the context menu | One-tap emoji row with a button for the full picker, as in other messengers; replaces the "React" menu item.                                                                                                                                                                                                                                                              |
| Reactions inside the bubble            | In the bubble layout reactions sit under the message text with the time on their right.                                                                                                                                                                                                                                                                                   |
| Voice message button                   | While the composer is empty, the round button in place of "send" records a voice message, as in other messengers. Element only offered it in the "more options" menu. |
| Editing in the composer                | Editing a message opens it in the main composer under an "Editing" bar, with a round save button in place of "send", as in other messengers; the bubble stays as it is. Element edited inside the bubble. The send composer unmounts meanwhile and gets its draft back from local storage. Not with the rich text editor (labs), which still edits in the timeline. |
| Bar under the room list                | Contacts (start a chat), Chats (all chats) and the user's avatar with Element's user menu, moved from the top of the space panel — the bottom tab bar of other messengers. |
| Media retry after a 401                | With MAS access tokens expire; the service worker used a stale stored token and avatars stayed broken. It now asks the tab to refresh the token and retries once. |
| "Open here" on the other-tab screen    | The tab that lost the session to another tab gets a button to take it back in one click instead of only "close this tab". |
| Notifications in the context menu       | Right-click on a room offers the notification options (mute and others), as Mute in other messengers; the Inside skin hides the hover buttons. |
| Folders in the space panel             | Under "All chats": Groups, Colleagues, Clients, VIP, Favourites — room list filters, as folders of other messengers. Colleagues/clients: the other side of a DM is on our server, or on another server / a bridged network. |
| VIP in the room context menu           | A private room tag (`u.inside.vip`) for the VIP folder, independent of the room list sections. |
| Own avatar opens the settings          | The last tab of the bar under the room list is the user's avatar and opens the settings, which show the profile (avatar, name, ID) above their tabs — the Settings screen of other messengers. |
| No verify-this-device prompts         | With `inside_hide_device_verification` in config.json, the "verify this device" toast is not shown, and a fresh login skips the full-screen verify/key-setup views (encryption is off server-wide; remove the key if E2EE comes back). |
| Robust media auth in the service worker | The worker waits up to 5 s for the tab's token, and on a 401 asks the tab to refresh once (shared by all requests of a burst) and retries with auth — no broken avatars right after start. |
| Dust when deleting a message          | After the delete confirmation the message tile crumbles into dust, as in Telegram (`utils/DustEffect.ts`). |
| Favicon badge in the brand red        | The unread counter drawn over the tab icon uses the Lobby signal red `#C8102E` instead of Element's `#d00`. |
| Search and More in the room header    | The right side of the room header is the Lobby button capsule: search, threads, room info, more. Search opens the room's message search as Ctrl+F does; More opens the room list item's options menu below the button (`RoomHeader/InsideHeaderButtons.tsx`). |
| Room info as in Telegram             | Under the profile of the room info card a row of tiles: call (the header's voice call, hidden where the header hides it), mute / unmute (the room list's mute), search, more (the room options menu). At its end the Media / Files / Links tabs: a grid of images and videos, lists of files and of messages with links, loaded when a tab is opened and paged on scroll from filtered timelines as in FilePanel (`right_panel/InsideRoomSummary.tsx`). |
| Muted text follows the theme       | The legacy `$muted-fg-color` (blue-grey `#61708b`, used by the upload bar, home page and others) now points at `--cpd-color-text-secondary`, so skins recolour it with the rest of the theme. |
| Threads                                | The bar under a message with replies shows a stack of up to three reply participants' avatars and always the count with the word ("3 replies"), also in the thread list; the thread panel header has "<room> · N replies" under its title; the empty thread composer offers the voice message button too (Element hid it in the narrow thread panel), and voice messages name their thread like text ones. |
| Escape closes the right panel          | As in Telegram, Escape closes the open thread, room or user info panel (`RoomView.closeRightPanelOnEscape`) and puts focus back into the composer if it was in the panel. Dialogs, menus, autocomplete and cancelling a reply or an edit take the press first; a text field with text and the room search keep it. |
| Avatar at the last bubble of a series  | In the bubble layout the sender avatar sits at the last message of a series (`mx_EventTile_inside_lastInSeries`), the name above the first one, as in Telegram. |
| Names without the Matrix ID           | Same-named members (one person with two accounts) no longer get " (@user:server)" in event texts, room list previews and the timeline sender; kept for names that look like a Matrix ID or contain direction marks, and in the member list and user info (`utils/event/getSenderName.ts`). |
| Online members in the room header      | "6 members · 2 online": the number of joined members whose presence is online, next to the member count (`mx_RoomHeader_inside_online`). |
| Pin for favourite rooms                | A favourite room without unread messages shows a pin where the unread badge would be (`mx_RoomListItemView_inside_pin`). |
| Counter on muted rooms                 | A muted room keeps a grey counter of its unread messages in the room list (`mx_RoomListItemView_inside_muted`), counted on the client because servers do not count them; folders and the favicon still leave it out. |
| Version script without `jq`            | Branch builds failed: the Docker builder image has no `jq`.                                                                                                                                                                                                                                                                                                               |

## Build

`.github/workflows/inside-docker.yaml` runs, on `inside-v*` tags only, the unit and browser tests related to our changes (six shards, in parallel with the image build) (not the Storybook
visual suite: its baselines are Element's) and builds
`ghcr.io/balakirev/inside-element-web` from the stock `apps/web/Dockerfile`.

## Licence

Element Web is licensed under AGPL-3.0 (see `LICENSE-AGPL-3.0`). This repository is public so that
users of Inside Chat can get the source of the version they use, as the AGPL requires.
