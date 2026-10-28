/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { type ComponentProps, type MouseEvent, type RefObject } from "react";
import { logger } from "matrix-js-sdk/src/logger";
import { ClientEvent, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { type ImageContent } from "matrix-js-sdk/src/types";
import {
    BaseViewModel,
    ImageBodyViewPlaceholder,
    ImageBodyViewState,
    type ImageBodyViewModel as ImageBodyViewModelInterface,
    type ImageBodyViewSnapshot,
} from "@element-hq/web-shared-components";

import Modal from "../../Modal";
import { MatrixClientPeg } from "../../MatrixClientPeg";
import { _t } from "../../languageHandler";
import { mediaFromContent } from "../../customisations/Media";
import { TimelineRenderingType } from "../../contexts/RoomContext";
import SettingsStore from "../../settings/SettingsStore";
import { type ImageSize, suggestedSize as suggestedImageSize } from "../../settings/enums/ImageSize";
import { presentableTextForFile } from "../../utils/FileUtils";
import { type MediaEventHelper } from "../../utils/MediaEventHelper";
import { blobIsAnimated, mayBeAnimated } from "../../utils/Image";
import { type RoomPermalinkCreator } from "../../utils/permalinks/Permalinks";
import { createReconnectedListener } from "../../utils/connection";
import { DecryptError, DownloadError } from "../../utils/DecryptFile";
import { BLURHASH_FIELD, createThumbnail } from "../../utils/image-media";
import { isMimeTypeAllowed } from "../../utils/blobs";
import { imageThumbnailHttp } from "../../utils/media/serverThumbnail";
import { NO_WAIT_HEADER, RETRY_PARAM } from "../../utils/media/mediaCacheShared";
import ImageView from "../../components/views/elements/ImageView";

export interface ImageBodyViewModelProps {
    /**
     * Image event being rendered.
     */
    mxEvent: MatrixEvent;
    /**
     * Helper for resolving encrypted media sources.
     */
    mediaEventHelper?: MediaEventHelper;
    /**
     * Whether the image is being rendered for export instead of the live timeline.
     */
    forExport?: boolean;
    /**
     * Optional maximum height applied when computing the rendered image dimensions.
     */
    maxImageHeight?: number;
    /**
     * Whether the media should currently be shown instead of the hidden-media preview.
     */
    mediaVisible: boolean;
    /**
     * Permalink helper passed to the image lightbox.
     */
    permalinkCreator?: RoomPermalinkCreator;
    /**
     * Timeline context used to decide which labels and supplemental content should be shown.
     */
    timelineRenderingType: TimelineRenderingType;
    /**
     * Ref to the underlying image element used for load dimensions and lightbox animation.
     */
    imageRef: RefObject<HTMLImageElement | null>;
    /**
     * Callback invoked when hidden media is revealed.
     */
    setMediaVisible?: (visible: boolean) => void;
}

interface LoadedImageDimensions {
    naturalWidth: number;
    naturalHeight: number;
}

interface InternalState {
    contentUrl: string | null;
    thumbUrl: string | null;
    isAnimated: boolean;
    error: unknown | null;
    imgError: boolean;
    imgLoaded: boolean;
    loadedImageDimensions?: LoadedImageDimensions;
    placeholder: ImageBodyViewPlaceholder;
    imageSize: ImageSize;
    generatedThumbnailUrl: string | null;
    /** Inside: the image is taking a while: show a spinner over the blurhash. */
    placeholderBusy: boolean;
    /** Inside: how many times the image has been loaded again after an error. */
    retryCount: number;
}

/** Inside: how long an image may take before a spinner joins its blurhash. */
const BUSY_SPINNER_DELAY_MS = 1000;
/** Inside: waits between attempts to load a file that is still being uploaded (MSC2246). */
const PENDING_RETRY_MIN_MS = 2000;
const PENDING_RETRY_MAX_MS = 30000;
/** Inside: give up on a file still not uploaded after this many attempts (about half an hour). */
const PENDING_MAX_RETRIES = 60;
/** Inside: load again at most this many times when the file turns out to be there after an error. */
const TRANSIENT_MAX_RETRIES = 2;

/** Inside: what the server says about a media URL that failed to load as an image. */
type MediaProbeResult = "pending" | "available" | "failed";

/**
 * Inside: ask the server about a media URL without waiting for an upload in progress: "pending" while
 * the sender's client is still uploading it (504 M_NOT_YET_UPLOADED), "available" if it loads now.
 */
async function probeMedia(url: string): Promise<MediaProbeResult> {
    try {
        const response = await fetch(url, { headers: { [NO_WAIT_HEADER]: "1" } });
        if (response.ok) {
            void response.body?.cancel();
            return "available";
        }
        if (response.status === 504) {
            const body = await response.json().catch(() => null);
            if (body?.errcode === "M_NOT_YET_UPLOADED") return "pending";
        }
    } catch {
        // offline or similar: treat as a failure; the reconnect listener retries.
    }
    return "failed";
}

/** Inside: the URL with a marker that makes the browser load it again (the service worker drops it). */
function withRetryParam(url: string | null, retryCount: number): string | null {
    if (!url || retryCount === 0 || !/^https?:/.test(url)) return url;
    const parsed = new URL(url);
    parsed.searchParams.set(RETRY_PARAM, String(retryCount));
    return parsed.toString();
}

/**
 * View model for the image message body, encapsulating media loading, sizing,
 * visibility, animated-image previews, and lightbox interactions.
 */
export class ImageBodyViewModel
    extends BaseViewModel<ImageBodyViewSnapshot, ImageBodyViewModelProps>
    implements ImageBodyViewModelInterface
{
    private state: InternalState;
    private blurhashTimeout?: number;
    private retryTimeout?: number;
    private probing = false;

    private readonly reconnectedListener = createReconnectedListener((): void => {
        MatrixClientPeg.get()?.off(ClientEvent.Sync, this.reconnectedListener);

        if (!this.state.imgError) {
            return;
        }

        this.state = {
            ...this.state,
            imgError: false,
        };
        this.updateSnapshotFromState();
    });

    public constructor(props: ImageBodyViewModelProps) {
        const initialState = ImageBodyViewModel.createInitialState(props.mxEvent);
        super(props, ImageBodyViewModel.computeSnapshot(props, initialState));
        this.state = initialState;

        const imageSizeWatcherRef = SettingsStore.watchSetting("Images.size", null, (_s, _r, _l, _nvl, value) => {
            this.setImageSize(value!);
        });
        this.disposables.track(() => SettingsStore.unwatchSetting(imageSizeWatcherRef));
    }

    private static createInitialState(mxEvent: MatrixEvent): InternalState {
        return {
            contentUrl: null,
            thumbUrl: null,
            isAnimated: false,
            error: null,
            imgError: false,
            imgLoaded: false,
            loadedImageDimensions: undefined,
            // Inside: the blurhash shows at once, as in Telegram, not after 150 ms: with the media cache
            // and prefetching most images are there at once anyway, and the rest should not leave a hole.
            placeholder: mxEvent.getContent<ImageContent>().info?.[BLURHASH_FIELD]
                ? ImageBodyViewPlaceholder.BLURHASH
                : ImageBodyViewPlaceholder.SPINNER,
            imageSize: SettingsStore.getValue("Images.size"),
            generatedThumbnailUrl: null,
            placeholderBusy: false,
            retryCount: 0,
        };
    }

    private static getImageDimensions(
        props: ImageBodyViewModelProps,
        state: InternalState,
    ): Pick<ImageBodyViewSnapshot, "maxWidth" | "maxHeight" | "aspectRatio" | "isSvg"> {
        const content = props.mxEvent.getContent<ImageContent>();
        const info = content.info;
        const naturalWidth = info?.w ?? state.loadedImageDimensions?.naturalWidth;
        const naturalHeight = info?.h ?? state.loadedImageDimensions?.naturalHeight;

        if (!naturalWidth || !naturalHeight) {
            return {
                maxWidth: undefined,
                maxHeight: undefined,
                aspectRatio: undefined,
                isSvg: info?.mimetype === "image/svg+xml",
            };
        }

        const { w: maxWidth, h: maxHeight } = suggestedImageSize(
            state.imageSize,
            { w: naturalWidth, h: naturalHeight },
            props.maxImageHeight,
        );

        return {
            maxWidth,
            maxHeight,
            aspectRatio: `${naturalWidth}/${naturalHeight}`,
            isSvg: info?.mimetype === "image/svg+xml",
        };
    }

    private static computeErrorLabel(error: unknown, imgError: boolean): string {
        if (error instanceof DecryptError) return _t("timeline|m.image|error_decrypting");
        if (error instanceof DownloadError) return _t("timeline|m.image|error_downloading");
        if (imgError || error) return _t("timeline|m.image|error");

        return _t("timeline|m.image|error");
    }

    private static shouldShowBanner(timelineRenderingType: TimelineRenderingType): boolean {
        return ![TimelineRenderingType.ThreadsList, TimelineRenderingType.File].includes(timelineRenderingType);
    }

    private static computeSnapshot(props: ImageBodyViewModelProps, state: InternalState): ImageBodyViewSnapshot {
        const content = props.mxEvent.getContent<ImageContent>();
        const dimensions = ImageBodyViewModel.getImageDimensions(props, state);
        const autoplayGifs = SettingsStore.getValue("autoplayGifs");
        const contentUrl = ImageBodyViewModel.getContentUrl(props, state);
        const thumbnailSrc = props.forExport
            ? (contentUrl ?? undefined)
            : state.isAnimated && autoplayGifs
              ? (contentUrl ?? undefined)
              : (state.thumbUrl ?? contentUrl ?? undefined);

        if (state.error || state.imgError) {
            return {
                state: ImageBodyViewState.ERROR,
                errorLabel: ImageBodyViewModel.computeErrorLabel(state.error, state.imgError),
                ...dimensions,
            };
        }

        if (!props.mediaVisible) {
            return {
                state: ImageBodyViewState.HIDDEN,
                hiddenButtonLabel: _t("timeline|m.image|show_image"),
                ...dimensions,
            };
        }

        return {
            state: ImageBodyViewState.READY,
            alt: content.body,
            src: contentUrl ?? undefined,
            thumbnailSrc,
            showAnimatedContentOnHover: state.isAnimated && !autoplayGifs && !!contentUrl,
            placeholder: !props.forExport && !state.imgLoaded ? state.placeholder : ImageBodyViewPlaceholder.NONE,
            blurhash: content.info?.[BLURHASH_FIELD],
            placeholderBusy: !props.forExport && !state.imgLoaded && state.placeholderBusy,
            gifLabel: state.isAnimated && !autoplayGifs ? "GIF" : undefined,
            bannerLabel: ImageBodyViewModel.shouldShowBanner(props.timelineRenderingType)
                ? presentableTextForFile(content, _t("common|image"), true, true)
                : undefined,
            linkUrl: contentUrl ?? undefined,
            linkTarget: props.forExport ? "_blank" : undefined,
            ...dimensions,
        };
    }

    private static getContentUrl(props: ImageBodyViewModelProps, state: InternalState): string | null {
        if (props.forExport) {
            return (
                props.mxEvent.getContent<ImageContent>().url ??
                props.mxEvent.getContent<ImageContent>().file?.url ??
                null
            );
        }

        return state.contentUrl;
    }

    public loadInitialMediaIfVisible(): void {
        if (!this.props.mediaVisible) {
            return;
        }

        this.scheduleBlurhashPlaceholder();
        void this.downloadImage();
    }

    private updateSnapshotFromState(): void {
        this.snapshot.set(ImageBodyViewModel.computeSnapshot(this.props, this.state));
    }

    private resetState(mxEvent: MatrixEvent): void {
        this.clearBlurhashTimeout();
        this.clearRetryTimeout();
        MatrixClientPeg.get()?.off(ClientEvent.Sync, this.reconnectedListener);
        this.revokeGeneratedThumbnailUrl();
        this.state = ImageBodyViewModel.createInitialState(mxEvent);
    }

    private revokeGeneratedThumbnailUrl(): void {
        if (!this.state.generatedThumbnailUrl) {
            return;
        }

        URL.revokeObjectURL(this.state.generatedThumbnailUrl);
        this.state = {
            ...this.state,
            generatedThumbnailUrl: null,
        };
    }

    private clearRetryTimeout(): void {
        if (!this.retryTimeout) return;
        clearTimeout(this.retryTimeout);
        this.retryTimeout = undefined;
    }

    private clearBlurhashTimeout(): void {
        if (!this.blurhashTimeout) {
            return;
        }

        clearTimeout(this.blurhashTimeout);
        this.blurhashTimeout = undefined;
    }

    /**
     * Inside: the blurhash is shown from the start (see createInitialState); this only adds a spinner
     * over it when the image takes a while.
     */
    private scheduleBlurhashPlaceholder(): void {
        if (
            !this.props.mxEvent.getContent<ImageContent>().info?.[BLURHASH_FIELD] ||
            this.state.imgLoaded ||
            this.state.imgError
        ) {
            return;
        }

        this.clearBlurhashTimeout();
        this.blurhashTimeout = window.setTimeout(() => {
            if (this.isDisposed || this.state.imgLoaded || this.state.imgError) {
                return;
            }

            this.state = {
                ...this.state,
                placeholderBusy: true,
            };
            this.snapshot.merge({ placeholderBusy: true });
        }, BUSY_SPINNER_DELAY_MS);
    }

    /**
     * Inside: the server thumbnail that fits the bubble on this screen (see `serverThumbnail.ts`),
     * instead of always 800×600 and the original on high-DPI screens.
     */
    private getThumbUrl(): string | null {
        return imageThumbnailHttp(this.props.mxEvent.getContent<ImageContent>(), {
            imageSize: this.state.imageSize,
            maxImageHeight: this.props.maxImageHeight,
            devicePixelRatio: window.devicePixelRatio,
            isAnimated: this.state.isAnimated,
        });
    }

    private async downloadImage(): Promise<void> {
        if (this.state.contentUrl || this.props.forExport) {
            return;
        }

        let thumbUrl: string | null;
        let contentUrl: string | null;

        if (this.props.mediaEventHelper?.media.isEncrypted || this.props.mediaEventHelper?.isFromLocalUpload) {
            try {
                [contentUrl, thumbUrl] = await Promise.all([
                    this.props.mediaEventHelper.sourceUrl.value,
                    this.props.mediaEventHelper.thumbnailUrl.value,
                ]);
            } catch (error) {
                if (this.isDisposed) {
                    return;
                }

                if (error instanceof DecryptError) {
                    logger.error("Unable to decrypt attachment: ", error);
                } else if (error instanceof DownloadError) {
                    logger.error("Unable to download attachment to decrypt it: ", error);
                } else {
                    logger.error("Error encountered when downloading encrypted attachment: ", error);
                }

                this.state = {
                    ...this.state,
                    error,
                };
                this.updateSnapshotFromState();
                return;
            }
        } else {
            contentUrl = mediaFromContent(this.props.mxEvent.getContent<ImageContent>()).srcHttp;
            thumbUrl = this.getThumbUrl();
        }

        const content = this.props.mxEvent.getContent<ImageContent>();
        let generatedThumbnailUrl: string | null = null;
        let isAnimated = content.info?.["org.matrix.msc4230.is_animated"];
        if (isAnimated === undefined) {
            isAnimated = mayBeAnimated(content.info?.mimetype);
        }

        const autoplayGifs = SettingsStore.getValue("autoplayGifs");
        if (isAnimated && !autoplayGifs) {
            if (!thumbUrl || !content.info?.thumbnail_info || mayBeAnimated(content.info.thumbnail_info.mimetype)) {
                const image = document.createElement("img");
                const loadPromise = new Promise<void>((resolve, reject) => {
                    image.onload = (): void => resolve();
                    image.onerror = (): void => reject(new Error("Unable to load image"));
                });

                image.crossOrigin = "Anonymous";
                image.src = contentUrl ?? "";

                try {
                    await loadPromise;
                } catch (error) {
                    logger.error("Unable to download attachment: ", error);
                    this.state = {
                        ...this.state,
                        error,
                    };
                    this.updateSnapshotFromState();
                    return;
                }

                try {
                    if (
                        content.info?.["org.matrix.msc4230.is_animated"] === false ||
                        (this.props.mediaEventHelper &&
                            (await blobIsAnimated(await this.props.mediaEventHelper.sourceBlob.value)) === false)
                    ) {
                        isAnimated = false;
                    }

                    if (isAnimated) {
                        const thumbnail = await createThumbnail(
                            image,
                            image.width,
                            image.height,
                            content.info?.mimetype ?? "image/jpeg",
                            false,
                        );
                        generatedThumbnailUrl = URL.createObjectURL(thumbnail.thumbnail);
                        thumbUrl = generatedThumbnailUrl;
                    }
                } catch (error) {
                    logger.warn("Unable to generate thumbnail for animated image: ", error);
                }
            }
        }

        if (this.isDisposed) {
            if (generatedThumbnailUrl) {
                URL.revokeObjectURL(generatedThumbnailUrl);
            }
            return;
        }

        this.revokeGeneratedThumbnailUrl();
        this.state = {
            ...this.state,
            contentUrl,
            thumbUrl,
            isAnimated,
            error: null,
            generatedThumbnailUrl,
        };
        this.updateSnapshotFromState();
    }

    private openImageViewer(event: MouseEvent<HTMLAnchorElement>): void {
        if (event.button !== 0 || event.metaKey) {
            return;
        }

        event.preventDefault();

        if (!this.props.mediaVisible) {
            this.props.setMediaVisible?.(true);
            return;
        }

        const content = this.props.mxEvent.getContent<ImageContent>();

        let httpUrl = this.state.contentUrl;
        if (
            this.props.mediaEventHelper?.media.isEncrypted &&
            !isMimeTypeAllowed(this.props.mediaEventHelper.sourceBlob.cachedValue?.type ?? "")
        ) {
            httpUrl = this.state.thumbUrl;
        }

        if (!httpUrl) {
            return;
        }

        const params: Omit<ComponentProps<typeof ImageView>, "onFinished"> = {
            src: httpUrl,
            name: content.body && content.body.length > 0 ? content.body : _t("common|attachment"),
            mxEvent: this.props.mxEvent,
            permalinkCreator: this.props.permalinkCreator,
        };

        if (content.info) {
            params.width = content.info.w;
            params.height = content.info.h;
            params.fileSize = content.info.size;
        }

        if (this.props.imageRef.current) {
            const clientRect = this.props.imageRef.current.getBoundingClientRect();
            params.thumbnailInfo = {
                width: clientRect.width,
                height: clientRect.height,
                positionX: clientRect.x,
                positionY: clientRect.y,
            };
        }

        Modal.createDialog(ImageView, params, "mx_Dialog_lightbox", undefined, true);
    }

    public onLinkClick = (event: MouseEvent<HTMLAnchorElement>): void => {
        this.openImageViewer(event);
    };

    public onHiddenButtonClick = (): void => {
        this.props.setMediaVisible?.(true);
    };

    public onImageError = (): void => {
        // Inside: a file of an event sent before its upload finished (MSC2246) fails to load until the
        // upload is done. Ask the server why it failed before showing an error.
        const failedUrl = this.state.thumbUrl ?? this.state.contentUrl;
        if (
            failedUrl &&
            /^https?:/.test(failedUrl) &&
            !this.props.mediaEventHelper?.media.isEncrypted &&
            !this.props.mediaEventHelper?.isFromLocalUpload
        ) {
            if (!this.probing) void this.handleRemoteImageError(failedUrl);
            return;
        }

        this.handleImageError();
    };

    /** Inside: after an image failed to load: wait for an upload in progress, retry, or fail. */
    private async handleRemoteImageError(failedUrl: string): Promise<void> {
        this.probing = true;
        const result = await probeMedia(failedUrl);
        this.probing = false;
        if (this.isDisposed || (this.state.thumbUrl ?? this.state.contentUrl) !== failedUrl) return;

        if (result === "pending" && this.state.retryCount < PENDING_MAX_RETRIES) {
            // Keep the blurhash (or spinner) with a spinner, and try again a little later.
            this.state = {
                ...this.state,
                placeholderBusy: true,
            };
            this.snapshot.merge({ placeholderBusy: true });
            const delay = Math.min(
                PENDING_RETRY_MIN_MS * 2 ** Math.min(this.state.retryCount, 4),
                PENDING_RETRY_MAX_MS,
            );
            this.clearRetryTimeout();
            this.retryTimeout = window.setTimeout(() => this.reloadImage(), delay);
            return;
        }

        if (result === "available" && this.state.retryCount < TRANSIENT_MAX_RETRIES) {
            this.reloadImage();
            return;
        }

        this.handleImageError();
    }

    /** Inside: load the image again, from its thumbnail, with URLs the browser has not failed on yet. */
    private reloadImage(): void {
        this.retryTimeout = undefined;
        if (this.isDisposed) return;
        const retryCount = this.state.retryCount + 1;
        const content = this.props.mxEvent.getContent<ImageContent>();
        this.state = {
            ...this.state,
            retryCount,
            imgError: false,
            thumbUrl: withRetryParam(this.getThumbUrl(), retryCount),
            contentUrl: withRetryParam(mediaFromContent(content).srcHttp, retryCount),
        };
        this.updateSnapshotFromState();
    }

    /** Element's handling of an image that failed to load: fall back to the original, then fail. */
    private handleImageError(): void {
        if (this.state.thumbUrl && this.state.thumbUrl !== this.state.contentUrl) {
            this.state = {
                ...this.state,
                thumbUrl: null,
            };
            this.updateSnapshotFromState();
            return;
        }

        this.clearBlurhashTimeout();

        if (this.state.imgError) {
            return;
        }

        this.state = {
            ...this.state,
            imgError: true,
        };
        MatrixClientPeg.safeGet().on(ClientEvent.Sync, this.reconnectedListener);
        this.updateSnapshotFromState();
    }

    public onImageLoad = (): void => {
        this.clearBlurhashTimeout();

        let loadedImageDimensions: LoadedImageDimensions | undefined;
        if (this.props.imageRef.current) {
            const { naturalWidth, naturalHeight } = this.props.imageRef.current;
            loadedImageDimensions = { naturalWidth, naturalHeight };
        }

        this.state = {
            ...this.state,
            imgLoaded: true,
            loadedImageDimensions,
            placeholder: ImageBodyViewPlaceholder.NONE,
            placeholderBusy: false,
        };
        this.updateSnapshotFromState();
    };

    public setEvent(mxEvent: MatrixEvent, mediaEventHelper?: MediaEventHelper): void {
        if (this.props.mxEvent === mxEvent && this.props.mediaEventHelper === mediaEventHelper) {
            return;
        }

        const previousVisible = this.props.mediaVisible;
        this.props = {
            ...this.props,
            mxEvent,
            mediaEventHelper,
        };
        this.resetState(mxEvent);
        this.updateSnapshotFromState();

        if (previousVisible) {
            this.scheduleBlurhashPlaceholder();
            void this.downloadImage();
        }
    }

    public setForExport(forExport?: boolean): void {
        if (this.props.forExport === forExport) {
            return;
        }

        this.props = {
            ...this.props,
            forExport,
        };
        this.updateSnapshotFromState();
    }

    public setMaxImageHeight(maxImageHeight?: number): void {
        if (this.props.maxImageHeight === maxImageHeight) {
            return;
        }

        this.props = {
            ...this.props,
            maxImageHeight,
        };
        this.updateSnapshotFromState();
    }

    public setMediaVisible(mediaVisible: boolean): void {
        if (this.props.mediaVisible === mediaVisible) {
            return;
        }

        const wasVisible = this.props.mediaVisible;
        this.props = {
            ...this.props,
            mediaVisible,
        };
        this.updateSnapshotFromState();

        if (!wasVisible && mediaVisible) {
            this.scheduleBlurhashPlaceholder();
            void this.downloadImage();
        }
    }

    public setPermalinkCreator(permalinkCreator?: RoomPermalinkCreator): void {
        if (this.props.permalinkCreator === permalinkCreator) {
            return;
        }

        this.props = {
            ...this.props,
            permalinkCreator,
        };
    }

    public setTimelineRenderingType(timelineRenderingType: TimelineRenderingType): void {
        if (this.props.timelineRenderingType === timelineRenderingType) {
            return;
        }

        this.props = {
            ...this.props,
            timelineRenderingType,
        };
        this.snapshot.merge(ImageBodyViewModel.computeSnapshot(this.props, this.state));
    }

    public setSetMediaVisible(setMediaVisible?: (visible: boolean) => void): void {
        if (this.props.setMediaVisible === setMediaVisible) {
            return;
        }

        this.props = {
            ...this.props,
            setMediaVisible,
        };
    }

    private setImageSize(imageSize: ImageSize): void {
        if (this.state.imageSize === imageSize) {
            return;
        }

        this.state = {
            ...this.state,
            imageSize,
        };
        this.updateSnapshotFromState();
    }

    public dispose(): void {
        this.clearBlurhashTimeout();
        this.clearRetryTimeout();
        MatrixClientPeg.get()?.off(ClientEvent.Sync, this.reconnectedListener);
        this.revokeGeneratedThumbnailUrl();
        super.dispose();
    }
}
