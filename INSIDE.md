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

| Change                                | Why                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caption field in the upload dialog    | Users expect to send a photo with a caption in one message, as in other messengers. Uses Matrix media captions (`body` = caption, `filename` = file name), which Element and Element X already render. The "discard caption?" question is drawn inside the dialog: `Modal` shows only the topmost dialog, so a second dialog would unmount this one and lose the caption. |
| Room list items like other messengers | Time of the latest message on the right, the sender of group messages on its own line, sent/read ticks for the user's own latest message, a muted icon, two-line previews.                                                                                                                                                                                                |
| Version script without `jq`           | Branch builds failed: the Docker builder image has no `jq`.                                                                                                                                                                                                                                                                                                               |

## Build

`.github/workflows/inside-docker.yaml` runs the unit and browser tests related to our changes (not the Storybook
visual suite: its baselines are Element's) and builds
`ghcr.io/balakirev/inside-element-web` from the stock `apps/web/Dockerfile`.

## Licence

Element Web is licensed under AGPL-3.0 (see `LICENSE-AGPL-3.0`). This repository is public so that
users of Inside Chat can get the source of the version they use, as the AGPL requires.
