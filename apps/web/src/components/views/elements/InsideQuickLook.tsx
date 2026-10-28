/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useRef, useState } from "react";
import FocusLock from "react-focus-lock";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import { InlineSpinner } from "@vector-im/compound-web";
import { CloseIcon, DownloadIcon, ZoomInIcon, ZoomOutIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { type DocumentMedia } from "../../../@types/document-viewer";
import Modal from "../../../Modal";
import { _t } from "../../../languageHandler";
import { FileDownloader } from "../../../utils/FileDownloader";
import { fileSize } from "../../../utils/FileUtils";
import { type MediaEventHelper } from "../../../utils/MediaEventHelper";
import { documentMediaForEvent, type QuickLookKind, quickLookKindForEvent } from "../../../utils/documentViewer";
import { flushPdfViewerState, getPdfViewerState, setPdfViewerState } from "../../../utils/pdfViewerState";
import {
    type PdfHostMessage,
    type PdfKeyAction,
    type PdfScrollStep,
    parsePdfUsercontentMessage,
    pdfKeyAction,
} from "../../../usercontent/pdf/protocol";
import { hasPdfHeader, MAX_PDF_BYTES, PDF_IFRAME_PERMISSIONS, PDF_USERCONTENT_URL } from "../right_panel/PdfViewer";
import { MarkdownViewer } from "../right_panel/MarkdownViewer";
import { InsidePlainTextViewer } from "../right_panel/InsidePlainTextViewer";
import AccessibleButton from "./AccessibleButton";

const loggerQuickLook = logger.getChild("InsideQuickLook");

/** The element that scrolls a Markdown or text document. */
const TEXT_SCROLLER_SELECTOR = "[data-testid='markdown-content'], .mx_InsidePlainTextViewer";

/** How long the window takes to appear and to go, as Quick Look's zoom; nothing with reduced motion. */
export const QUICK_LOOK_ANIMATION_MS = 160;

/** The Modal class of the Quick Look window: a lightbox, so the dialog frame and its scrim are not drawn. */
export const QUICK_LOOK_DIALOG_CLASS = "mx_Dialog_lightbox mx_Dialog_insideQuickLook";

type Status = "loading" | "ready" | "error";

interface PdfSession {
    status: Status;
    currentPage: number;
    pageCount: number;
    /** Sends a message to the frame once it is listening; dropped before that. */
    send: (message: PdfHostMessage) => void;
}

/**
 * The document in the sandboxed usercontent frame of Element's PDF viewer (`src/usercontent/pdf/`),
 * driven as the right panel's `PdfViewer` drives it: the file is fetched and checked here, handed over
 * through the frame's private channel, and the reading position is remembered per MXC URI.
 */
function usePdfSession(
    media: DocumentMedia,
    iframeRef: React.RefObject<HTMLIFrameElement | null>,
    onDismiss: () => void,
): PdfSession {
    const portRef = useRef<MessagePort | null>(null);
    const [status, setStatus] = useState<Status>("loading");
    const [currentPage, setCurrentPage] = useState(1);
    const [pageCount, setPageCount] = useState(0);
    const onDismissRef = useRef(onDismiss);
    onDismissRef.current = onDismiss;

    useEffect(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;

        let disposed = false;
        let isLoaded = false;
        let port: MessagePort | undefined;

        const fail = (error: unknown): void => {
            if (disposed) return;
            loggerQuickLook.error("Unable to load PDF", error);
            setStatus("error");
        };

        const loadDocument = async (): Promise<void> => {
            if (media.size !== undefined && media.size > MAX_PDF_BYTES) throw new Error("PDF attachment is too large");
            const blob = await media.blob();
            if (blob.size === 0) throw new Error("PDF attachment is empty");
            if (blob.size > MAX_PDF_BYTES) throw new Error("PDF attachment is too large");
            const data = new Uint8Array(await blob.arrayBuffer());
            if (!hasPdfHeader(data)) throw new Error("Attachment is not a PDF");
            if (disposed) return;

            const saved = getPdfViewerState(media.uri);
            const position = saved && { page: saved.page, scale: saved.scale, left: saved.left, top: saved.top };
            const message: PdfHostMessage = { type: "load", data: data.buffer, position };
            port?.postMessage(message, [data.buffer]);
        };

        const onPortMessage = (event: MessageEvent): void => {
            if (disposed) return;
            const message = parsePdfUsercontentMessage(event.data);
            if (!message) return;

            switch (message.type) {
                case "loaded":
                    isLoaded = true;
                    setPageCount(message.pageCount);
                    setCurrentPage(message.page);
                    setStatus("ready");
                    break;
                case "page":
                    setCurrentPage(message.page);
                    break;
                case "position":
                    if (!isLoaded) return;
                    setPdfViewerState(media.uri, message.position);
                    break;
                case "dismiss":
                    onDismissRef.current();
                    break;
                case "error":
                    fail(new Error(message.message));
                    break;
            }
        };

        // Only our frame, and only with the "null" origin a sandboxed frame has, may hand over the channel.
        const onWindowMessage = (event: MessageEvent): void => {
            if (disposed || event.source !== iframe.contentWindow || event.origin !== "null") return;
            const received = event.ports[0];
            if (parsePdfUsercontentMessage(event.data)?.type !== "ready" || !received || port) return;
            port = received;
            portRef.current = received;
            received.onmessage = onPortMessage;
            void loadDocument().catch(fail);
        };

        window.addEventListener("message", onWindowMessage);
        iframe.src = PDF_USERCONTENT_URL;

        return () => {
            disposed = true;
            window.removeEventListener("message", onWindowMessage);
            port?.close();
            portRef.current = null;
            flushPdfViewerState();
        };
    }, [media, iframeRef]);

    const send = useCallback((message: PdfHostMessage): void => {
        portRef.current?.postMessage(message);
    }, []);

    return { status, currentPage, pageCount, send };
}

/** A line of text for the arrow keys in a Markdown or text document, px. */
const TEXT_LINE_STEP = 40;

/** Scrolls a Markdown or text document as the PDF frame scrolls its pages for the same keys. */
function scrollText(scroller: HTMLElement, step: PdfScrollStep): void {
    const page = Math.max(TEXT_LINE_STEP, scroller.clientHeight - TEXT_LINE_STEP);
    const delta: Record<PdfScrollStep, number> = {
        line_up: -TEXT_LINE_STEP,
        line_down: TEXT_LINE_STEP,
        page_up: -page,
        page_down: page,
        start: -scroller.scrollHeight,
        end: scroller.scrollHeight,
    };
    scroller.scrollTop = Math.max(0, scroller.scrollTop + delta[step]);
}

function prefersReducedMotion(): boolean {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

interface Props {
    media: DocumentMedia;
    /** The file name shown in the title and given to the download. */
    name: string;
    /** What the file is: a PDF (the default), Markdown or plain text. */
    kind?: QuickLookKind;
    onFinished: () => void;
}

/**
 * Inside: a document in a window over the app, as macOS Quick Look shows a file on Space: it scrolls
 * inside the window, "Download" saves the file, and Escape, the backdrop or the close button put it
 * away. A PDF's pages are drawn by the same sandboxed usercontent frame as Element's right panel
 * viewer; Markdown is rendered and sanitized by Element's Markdown viewer, plain text shown as it is.
 *
 * Keys: Escape closes; ↑/↓, Page Up/Down, Space (Shift+Space back), Home/End scroll; ⌘/Ctrl +/− zoom a
 * PDF. With the focus in the PDF frame it handles them itself and hands Escape back.
 */
export default function InsideQuickLook({ media, name, kind = "pdf", onFinished }: Props): JSX.Element {
    const isPdf = kind === "pdf";
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [closing, setClosing] = useState(false);
    const closingRef = useRef(false);

    // Where the focus was when the window opened (the tile, usually), to give it back on close. Kept by
    // hand rather than by the lock: StrictMode's remount of the lock would lose it.
    const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
    const finishedRef = useRef(false);
    useEffect(
        () => () => {
            if (!finishedRef.current || !opener?.isConnected) return;
            // Once the lock is gone, or it would pull the focus back in.
            window.setTimeout(() => opener.focus({ preventScroll: true }));
        },
        [opener],
    );

    const close = useCallback((): void => {
        if (closingRef.current) return;
        closingRef.current = true;
        const finish = (): void => {
            finishedRef.current = true;
            onFinished();
        };
        if (prefersReducedMotion()) {
            finish();
            return;
        }
        setClosing(true);
        window.setTimeout(finish, QUICK_LOOK_ANIMATION_MS);
    }, [onFinished]);

    const { status, currentPage, pageCount, send } = usePdfSession(media, iframeRef, close);

    // The pages take the keys from the start, so Space pages down rather than pressing a button. A task
    // later, so that a focus the lock gives back meanwhile (StrictMode remounts it) does not win.
    const focusPages = useCallback((): void => {
        window.setTimeout(() => bodyRef.current?.focus({ preventScroll: true }));
    }, []);

    const download = useCallback(async (): Promise<void> => {
        try {
            await new FileDownloader().download({ blob: await media.blob(), name });
        } catch (error) {
            loggerQuickLook.error("Unable to download PDF", error);
        }
    }, [media, name]);

    const onDownloadClick = useCallback((): void => void download(), [download]);
    const zoomIn = useCallback((): void => send({ type: "zoom", direction: "in" }), [send]);
    const zoomOut = useCallback((): void => send({ type: "zoom", direction: "out" }), [send]);

    const runAction = useCallback(
        (action: PdfKeyAction): void => {
            if (action.type === "dismiss") {
                close();
            } else if (action.type === "zoom") {
                send({ type: "zoom", direction: action.direction });
            } else if (isPdf) {
                send({ type: "scroll", step: action.step });
            } else {
                const scroller = bodyRef.current?.querySelector<HTMLElement>(TEXT_SCROLLER_SELECTOR);
                if (scroller) scrollText(scroller, action.step);
            }
        },
        [close, send, isPdf],
    );

    const onKeyDown = useCallback(
        (ev: React.KeyboardEvent): void => {
            const action = pdfKeyAction(ev);
            if (!action) return;
            // Only a PDF zooms; elsewhere ⌘/Ctrl +/− stay the browser's.
            if (!isPdf && action.type === "zoom") return;
            // Space and the arrows on a focused button are the button's own.
            const onButton = ev.target instanceof HTMLElement && !!ev.target.closest("button, [role=button]");
            if (onButton && action.type === "scroll" && ev.key === " ") return;
            ev.preventDefault();
            // Taken on the way down, before a button's tooltip eats Escape; nothing under the window
            // (the room's own Escape, which closes the right panel) sees it.
            ev.stopPropagation();
            runAction(action);
        },
        [runAction, isPdf],
    );

    // A link in a Markdown document that the viewer follows inside the app (a room, a user, a
    // message) takes the user there: the window goes out of the way.
    const onBodyClick = useCallback(
        (ev: React.MouseEvent): void => {
            if (ev.defaultPrevented && ev.target instanceof Element && ev.target.closest("a")) close();
        },
        [close],
    );

    const sizeText = typeof media.size === "number" ? fileSize(media.size) : undefined;
    const pageText =
        status === "ready" && pageCount > 0
            ? _t("pdf_viewer|inside_page_of", { page: currentPage, total: pageCount })
            : undefined;
    const meta = [pageText, sizeText].filter(Boolean).join(" · ");

    return (
        <FocusLock autoFocus={false} onActivation={focusPages} className="mx_InsideQuickLook_lock">
            <div
                className={closing ? "mx_InsideQuickLook mx_InsideQuickLook_closing" : "mx_InsideQuickLook"}
                onKeyDownCapture={onKeyDown}
            >
                {/* A mouse-only way out; Escape and the close button are the keyboard ones. */}
                {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events */}
                <div className="mx_InsideQuickLook_backdrop" data-testid="quick-look-backdrop" onClick={close} />
                <div className="mx_InsideQuickLook_window" role="dialog" aria-modal="true" aria-label={name}>
                    <div className="mx_InsideQuickLook_header">
                        <div className="mx_InsideQuickLook_heading">
                            <span className="mx_InsideQuickLook_title" title={name}>
                                {name}
                            </span>
                            {meta && <span className="mx_InsideQuickLook_meta">{meta}</span>}
                        </div>
                        {isPdf && (
                            <div className="mx_InsideQuickLook_zoom">
                                <AccessibleButton
                                    className="mx_InsideQuickLook_iconButton"
                                    onClick={zoomOut}
                                    disabled={status !== "ready"}
                                    aria-label={_t("action|zoom_out")}
                                    title={_t("action|zoom_out")}
                                >
                                    <ZoomOutIcon />
                                </AccessibleButton>
                                <AccessibleButton
                                    className="mx_InsideQuickLook_iconButton"
                                    onClick={zoomIn}
                                    disabled={status !== "ready"}
                                    aria-label={_t("action|zoom_in")}
                                    title={_t("action|zoom_in")}
                                >
                                    <ZoomInIcon />
                                </AccessibleButton>
                            </div>
                        )}
                        <AccessibleButton className="mx_InsideQuickLook_download" onClick={onDownloadClick}>
                            <DownloadIcon />
                            <span>{_t("action|download")}</span>
                        </AccessibleButton>
                        <AccessibleButton
                            className="mx_InsideQuickLook_close"
                            onClick={close}
                            aria-label={_t("action|close")}
                            title={_t("action|close")}
                        >
                            <CloseIcon />
                        </AccessibleButton>
                    </div>
                    {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- only watches the document's own link clicks */}
                    <div
                        className="mx_InsideQuickLook_body"
                        ref={bodyRef}
                        tabIndex={-1}
                        onClick={isPdf ? undefined : onBodyClick}
                    >
                        {isPdf ? (
                            <>
                                {/* `src` is set by usePdfSession, once it listens for the frame's `ready`. */}
                                <iframe
                                    ref={iframeRef}
                                    className="mx_InsideQuickLook_frame"
                                    data-testid="pdf-iframe"
                                    sandbox={PDF_IFRAME_PERMISSIONS}
                                    title={name}
                                />
                                {status === "loading" && (
                                    <div className="mx_InsideQuickLook_status">
                                        <InlineSpinner size={24} />
                                    </div>
                                )}
                                {status === "error" && (
                                    <div className="mx_InsideQuickLook_status mx_InsideQuickLook_error">
                                        {_t("pdf_viewer|inside_error")}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="mx_InsideQuickLook_document">
                                {kind === "markdown" ? (
                                    <MarkdownViewer media={media} />
                                ) : (
                                    <InsidePlainTextViewer media={media} />
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </FocusLock>
    );
}

/**
 * Inside: open an event's PDF, Markdown or text file in the Quick Look window. `helper` is the tile's,
 * so the file it may already have fetched is not fetched again.
 */
export function openInsideQuickLook(mxEvent: MatrixEvent, helper?: MediaEventHelper): void {
    const kind = quickLookKindForEvent(mxEvent);
    const media = kind && documentMediaForEvent(mxEvent, helper);
    if (!media) return;
    Modal.createDialog(
        InsideQuickLook,
        { media, name: media.name || _t("common|attachment"), kind },
        QUICK_LOOK_DIALOG_CLASS,
        false,
        true,
    );
}
