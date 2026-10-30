/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useState, type JSX } from "react";
import classNames from "classnames";

import { _t } from "../../../../languageHandler";
import Markdown from "../../../../Markdown";
import { sanitizedHtmlNode } from "../../../../HtmlUtils";
import type { Artifact, AssistantSuggestion } from "../../model";
import { discardArtifact, finalizeArtifact, pickSuggestion } from "../../assistant";
import { AssistantIcon, type AssistantIconName } from "./icons";

/** Types Lobby draws as its own cards; anything else is drawn from `portableMarkdown`. */
const NATIVE_TYPES = new Set(["listing_draft", "deal_draft", "contact", "task", "confirmation"]);

export function isNativeArtifact(artifact: Artifact): boolean {
    return NATIVE_TYPES.has(artifact.type);
}

function iconOf(artifact: Artifact): AssistantIconName {
    switch (artifact.type) {
        case "listing_draft":
            return "build";
        case "deal_draft":
            return "case";
        case "contact":
            return "user";
        case "task":
            return "tick";
        case "confirmation":
            return artifact.items ? "build" : "spark";
        default:
            return "doc";
    }
}

function stateChip(artifact: Artifact): { label: string; done: boolean } {
    if (artifact.state === "finalized")
        return { label: artifact.finalizedLabel ?? _t("insis_assistant|state_created"), done: true };
    if (artifact.state === "discarded") return { label: _t("insis_assistant|state_discarded"), done: false };
    return {
        label: artifact.awaiting ? _t("insis_assistant|state_awaiting") : _t("insis_assistant|state_draft"),
        done: false,
    };
}

/** "открыть в Insis": the artifact in INSIS, in a new tab. */
function OpenInInsis({ url, className }: { url: string; className?: string }): JSX.Element | null {
    if (!url) return null;
    return (
        <a className={className} href={url} target="_blank" rel="noreferrer noopener">
            {_t("insis_assistant|open_in_insis")}
        </a>
    );
}

interface CardProps {
    sessionId: string;
    artifact: Artifact;
    /** "Изменить" and the like: the composer gets a request to change the draft. */
    onEdit: (text: string) => void;
}

/**
 * Inside: an artifact of the assistant as a native card of the mockup — icon, title, "pocket listing · виден только
 * вам", the state chip, a two-column grid of fields with where each value came from, what is missing, a warning,
 * the buttons. The finalize button sends `finalize` with a fresh Idempotency-Key (a preview: kept on the artifact);
 * a critical action (a message to a client, a deal) asks for an explicit confirmation first (ADR-034).
 */
export function AssistantArtifactCard({ sessionId, artifact, onEdit }: CardProps): JSX.Element {
    const [confirming, setConfirming] = useState(false);
    if (!isNativeArtifact(artifact)) return <PortableArtifactCard artifact={artifact} />;

    const chip = stateChip(artifact);
    const isDraft = artifact.state === "draft";
    const finalize = (): void => {
        setConfirming(false);
        finalizeArtifact(sessionId, artifact.id);
    };

    return (
        <section
            className={classNames("mx_InsisArtifact", `mx_InsisArtifact_${artifact.state}`)}
            aria-label={artifact.title}
            data-idempotency-key={artifact.idempotencyKey}
        >
            <header className="mx_InsisArtifact_header">
                <span className="mx_InsisArtifact_icon" aria-hidden="true">
                    <AssistantIcon name={iconOf(artifact)} />
                </span>
                <div className="mx_InsisArtifact_titles">
                    <b>{artifact.title}</b>
                    {artifact.subtitle && <span>{artifact.subtitle}</span>}
                </div>
                <span className={classNames("mx_InsisArtifact_state", { mx_InsisArtifact_state_done: chip.done })}>
                    {chip.label}
                </span>
            </header>

            {artifact.fields.length > 0 && (
                <dl className="mx_InsisArtifact_fields">
                    {artifact.fields.map((f) => (
                        <div key={f.label} className="mx_InsisArtifact_field">
                            <dt>
                                {f.label}
                                {f.source && <em>{f.source}</em>}
                            </dt>
                            <dd title={f.value}>{f.value}</dd>
                        </div>
                    ))}
                </dl>
            )}

            {artifact.documents && (
                <div className="mx_InsisArtifact_fields mx_InsisArtifact_fields_one">
                    <div className="mx_InsisArtifact_field">
                        <dt>{artifact.documents.caption}</dt>
                        <dd className="mx_InsisArtifact_docs">
                            {artifact.documents.items.map((d) => (
                                <span
                                    key={d.label}
                                    className={classNames("mx_InsisArtifact_doc", {
                                        mx_InsisArtifact_doc_done: d.done,
                                    })}
                                >
                                    {d.done && <AssistantIcon name="tick" />}
                                    {d.done ? d.label : `${d.label} —`}
                                </span>
                            ))}
                        </dd>
                    </div>
                </div>
            )}

            {artifact.items && (
                <div className="mx_InsisArtifact_items">
                    {artifact.items.map((it) => (
                        <figure key={it.title}>
                            <i style={{ background: it.color }} />
                            <figcaption>
                                <b>{it.title}</b>
                                {it.subtitle}
                            </figcaption>
                        </figure>
                    ))}
                </div>
            )}

            {artifact.missing && artifact.missing.length > 0 && isDraft && (
                <div className="mx_InsisArtifact_missing">
                    <AssistantIcon name="warn" />
                    {_t("insis_assistant|missing", { fields: artifact.missing.join(", ") })}
                </div>
            )}

            {artifact.warning && (
                <div className="mx_InsisArtifact_warning">
                    <AssistantIcon name="warn" />
                    <span>{artifact.warning}</span>
                </div>
            )}

            {artifact.match && (
                <div className="mx_InsisArtifact_match">
                    <span className="mx_InsisArtifact_matchAvatar" style={{ background: artifact.match.color }}>
                        {artifact.match.initials}
                    </span>
                    <div>
                        <b>{artifact.match.title}</b>
                        <span>{artifact.match.detail}</span>
                    </div>
                </div>
            )}

            {isDraft && confirming && (
                <div className="mx_InsisArtifact_confirm" role="group" aria-label={_t("insis_assistant|confirm_title")}>
                    <p>
                        <b>{_t("insis_assistant|confirm_question", { action: artifact.finalizeLabel })}</b>{" "}
                        {artifact.confirmText ?? _t("insis_assistant|confirm_default")}
                    </p>
                    <div className="mx_InsisArtifact_buttons mx_InsisArtifact_buttons_inline">
                        <button type="button" className="mx_InsisArtifact_button_primary" onClick={finalize} autoFocus>
                            {_t("insis_assistant|confirm_do", { action: artifact.finalizeLabel })}
                        </button>
                        <button
                            type="button"
                            className="mx_InsisArtifact_button_secondary"
                            onClick={() => setConfirming(false)}
                        >
                            {_t("action|cancel")}
                        </button>
                    </div>
                </div>
            )}

            {isDraft && !confirming && (
                <div className="mx_InsisArtifact_buttons">
                    <button
                        type="button"
                        className="mx_InsisArtifact_button_primary"
                        onClick={() => (artifact.critical ? setConfirming(true) : finalize())}
                    >
                        {artifact.finalizeLabel}
                    </button>
                    <button
                        type="button"
                        className="mx_InsisArtifact_button_secondary"
                        onClick={() =>
                            onEdit(_t("insis_assistant|edit_request", { title: artifact.title.toLocaleLowerCase() }))
                        }
                    >
                        {artifact.secondaryLabel ?? _t("insis_assistant|action_edit")}
                    </button>
                    <button
                        type="button"
                        className="mx_InsisArtifact_button_quiet"
                        onClick={() => discardArtifact(sessionId, artifact.id)}
                    >
                        {_t("insis_assistant|discard")}
                    </button>
                </div>
            )}

            {artifact.state === "finalized" && (
                <div className="mx_InsisArtifact_result">
                    <span className="mx_InsisArtifact_resultTick" aria-hidden="true">
                        <AssistantIcon name="tick" />
                    </span>
                    <span>{artifact.resultText ?? _t("insis_assistant|artifact_created")}</span>
                    <OpenInInsis url={artifact.insisUrl} className="mx_InsisArtifact_link" />
                </div>
            )}

            {artifact.state === "discarded" && (
                <div className="mx_InsisArtifact_result mx_InsisArtifact_result_discarded">
                    <span>{_t("insis_assistant|artifact_discarded")}</span>
                </div>
            )}
        </section>
    );
}

/** An artifact type Lobby does not know: its portable Markdown and "Открыть в insis" (ADR-069 Amendment, п. 1). */
function PortableArtifactCard({ artifact }: { artifact: Artifact }): JSX.Element {
    const html = new Markdown(artifact.portableMarkdown).toHTML();
    return (
        <section className="mx_InsisArtifact mx_InsisArtifact_portable" aria-label={artifact.title}>
            <header className="mx_InsisArtifact_header">
                <span className="mx_InsisArtifact_icon" aria-hidden="true">
                    <AssistantIcon name="doc" />
                </span>
                <div className="mx_InsisArtifact_titles">
                    <b>{artifact.title}</b>
                    {artifact.subtitle && <span>{artifact.subtitle}</span>}
                </div>
            </header>
            {/* Markdown of the INSIS Copilot, through Element's Markdown renderer and HTML sanitiser. */}
            {sanitizedHtmlNode(html, "mx_InsisArtifact_markdown")}
            <div className="mx_InsisArtifact_buttons">
                {artifact.insisUrl && (
                    <a
                        className="mx_InsisArtifact_button_primary"
                        href={artifact.insisUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        <AssistantIcon name="ext" />
                        {_t("insis_assistant|open_in_insis_button")}
                    </a>
                )}
            </div>
        </section>
    );
}

/** "Помощник предлагает": up to three next steps with why; each goes through the assistant and a confirmation. */
export function AssistantSuggestionsCard({
    sessionId,
    suggestions,
}: {
    sessionId: string;
    suggestions: AssistantSuggestion[];
}): JSX.Element {
    const [picked, setPicked] = useState<Set<string>>(new Set());
    return (
        <section className="mx_InsisArtifact mx_InsisArtifact_suggestions" aria-label={_t("insis_assistant|suggests")}>
            <header className="mx_InsisArtifact_header">
                <span className="mx_InsisArtifact_icon" aria-hidden="true">
                    <AssistantIcon name="spark" />
                </span>
                <div className="mx_InsisArtifact_titles">
                    <b>{_t("insis_assistant|suggests")}</b>
                    <span>{_t("insis_assistant|suggests_subtitle", { count: suggestions.length })}</span>
                </div>
            </header>
            {suggestions.map((s, i) => (
                <div key={s.id} className="mx_InsisSuggestion">
                    <p>{s.title}</p>
                    <div className="mx_InsisSuggestion_why">
                        <AssistantIcon name="help" />
                        {s.reason}
                    </div>
                    {picked.has(s.id) ? (
                        <span className="mx_InsisArtifact_result mx_InsisSuggestion_done">
                            <span className="mx_InsisArtifact_resultTick" aria-hidden="true">
                                <AssistantIcon name="tick" />
                            </span>
                            {_t("insis_assistant|suggestion_sent")}
                        </span>
                    ) : (
                        <button
                            type="button"
                            className={
                                i === 0 ? "mx_InsisArtifact_button_primary" : "mx_InsisArtifact_button_secondary"
                            }
                            onClick={() => {
                                setPicked(new Set(picked).add(s.id));
                                pickSuggestion(sessionId, s.title, s.prompt);
                            }}
                        >
                            {_t("insis_assistant|suggestion_prepare")}
                        </button>
                    )}
                </div>
            ))}
        </section>
    );
}
