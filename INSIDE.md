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
| Version script without `jq`            | Branch builds failed: the Docker builder image has no `jq`.                                                                                                                                                                                                                                                                                                               |

## Build

`.github/workflows/inside-docker.yaml` runs, on `inside-v*` tags only, the unit and browser tests related to our changes (six shards, in parallel with the image build) (not the Storybook
visual suite: its baselines are Element's) and builds
`ghcr.io/balakirev/inside-element-web` from the stock `apps/web/Dockerfile`.

## Licence

Element Web is licensed under AGPL-3.0 (see `LICENSE-AGPL-3.0`). This repository is public so that
users of Inside Chat can get the source of the version they use, as the AGPL requires.
