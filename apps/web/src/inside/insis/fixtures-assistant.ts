/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { AssistantSession } from "./model";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Midnight of the local day of `ts`. */
function startOfDay(ts: number): number {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/** `daysAgo` local days before `now`, at hh:mm. */
function at(now: number, daysAgo: number, hh: number, mm: number): number {
    const d = new Date(startOfDay(now) - daysAgo * DAY + 12 * 60 * MINUTE);
    d.setHours(hh, mm, 0, 0);
    return d.getTime();
}

/** `minutesAgo` before `now`, but never before today's midnight, so the session stays in "Today". */
function todayAgo(now: number, minutesAgo: number): number {
    return Math.max(startOfDay(now) + MINUTE, now - minutesAgo * MINUTE);
}

const INSIS = "https://insis.ins.is";
const ALINA = "клиент: Алина Касымова · L-20481";
const SERGEY = "клиент: Сергей Мельник";

/**
 * Inside: test assistant sessions of the preview — the data of the mockup (`#ast` of
 * `docs/design/lobby/variants/index.html`). Times are relative to `now`, so "Today · Yesterday · Earlier" work on
 * any day. Texts are Russian, as the demo accounts are.
 */
export function makeAssistantSessions(now: number): AssistantSession[] {
    const listingTs = todayAgo(now, 26);
    const dealTs = todayAgo(now, 20);
    const clientQTs = todayAgo(now, 10);
    const newClientTs = at(now, 1, 17, 15);
    const selectionTs = at(now, 1, 17, 32);
    const ownerTs = at(now, 6, 10, 12);
    const weekTs = at(now, 7, 9, 2);

    return [
        {
            id: "listing",
            title: "Объект: Collective 2.0 · 2BR",
            context: "",
            preview: "Черновик объекта ждёт подтверждения",
            lastActivityTs: listingTs,
            awaitingConfirmation: true,
            messages: [
                {
                    kind: "user",
                    id: "listing-1",
                    ts: listingTs,
                    text: "Заведи объект: двушка в Collective 2.0, 1 245 футов, 2,45 миллиона, сдан, вид на парк",
                    voice: { durationSec: 18 },
                },
                {
                    kind: "assistant",
                    id: "listing-2",
                    ts: listingTs,
                    text: "Разобрал голосовое и сверил со справочником проектов. Проверьте и создайте черновик — в общую базу он не уйдёт без вашей проверки.",
                    artifact: {
                        id: "art-listing",
                        type: "listing_draft",
                        title: "Черновик объекта",
                        subtitle: "pocket listing · виден только вам",
                        state: "draft",
                        awaiting: true,
                        fields: [
                            { label: "Проект", value: "Collective 2.0 · Dubai Hills", source: "справочник" },
                            { label: "Тип", value: "2BR", source: "голос" },
                            { label: "Площадь", value: "1 245 sqft", source: "голос" },
                            { label: "Цена", value: "AED 2 450 000", source: "голос" },
                            { label: "Статус", value: "готовый", source: "голос" },
                            { label: "Вид", value: "на парк", source: "голос" },
                        ],
                        missing: ["этаж", "номер разрешения"],
                        finalizeLabel: "Создать черновик",
                        secondaryLabel: "Изменить",
                        portableMarkdown:
                            "**Черновик объекта** — Collective 2.0 · Dubai Hills, 2BR, 1 245 sqft, AED 2 450 000, готовый, вид на парк.",
                        insisUrl: `${INSIS}/listings/drafts/art-listing`,
                    },
                },
            ],
        },
        {
            id: "deal",
            title: "Своя сделка — Алина Касымова",
            context: ALINA,
            clientConversationId: "alina",
            preview: "Не хватает паспорта и Form F",
            lastActivityTs: dealTs,
            awaitingConfirmation: true,
            messages: [
                {
                    kind: "user",
                    id: "deal-1",
                    ts: dealTs - MINUTE,
                    text: "Своя сделка с Алиной: бронь Collective 2.0 по 2,45 млн. Бронь прикладываю",
                },
                {
                    kind: "user",
                    id: "deal-2",
                    ts: dealTs - MINUTE,
                    text: "",
                    file: { name: "Бронь Collective 2.0.pdf", size: "410 КБ" },
                },
                {
                    kind: "assistant",
                    id: "deal-3",
                    ts: dealTs,
                    text: "Сверил «чей клиент»: Алина — ваш лид L-20481, конфликтов нет. Собрал черновик сделки, не хватает паспорта и Form F.",
                    artifact: {
                        id: "art-deal",
                        type: "deal_draft",
                        title: "Своя сделка — черновик",
                        subtitle: "вторичка · бронь",
                        state: "draft",
                        awaiting: true,
                        critical: true,
                        fields: [
                            { label: "Покупатель", value: "Алина Касымова" },
                            { label: "Продавец", value: "собственник · напрямую" },
                            { label: "Объект", value: "Collective 2.0 · 2BR" },
                            { label: "Цена", value: "AED 2 450 000" },
                        ],
                        documents: {
                            caption: "Этап · документы — загружен 1 из 3",
                            items: [
                                { label: "Бронь", done: true },
                                { label: "Паспорт", done: false },
                                { label: "Form F", done: false },
                            ],
                        },
                        warning:
                            "Дебиторка — после подтверждения руководителем направления. До проверки сделку нельзя закрыть.",
                        confirmText:
                            "Сделка уйдёт руководителю направления на проверку и появится в отчётах. Отозвать её можно только через руководителя.",
                        finalizeLabel: "Отправить на проверку",
                        secondaryLabel: "Добавить документы",
                        resultText: "Отправлено руководителю · ждёт проверки",
                        finalizedLabel: "На проверке",
                        portableMarkdown:
                            "**Своя сделка — черновик**: Алина Касымова, Collective 2.0 · 2BR, AED 2 450 000. Документы: бронь.",
                        insisUrl: `${INSIS}/deals/drafts/art-deal`,
                    },
                },
            ],
        },
        {
            id: "client-q",
            title: "Что по клиенту: Алина",
            context: ALINA,
            clientConversationId: "alina",
            preview: "Сводка по лиду и 3 предложения",
            lastActivityTs: clientQTs,
            messages: [
                { kind: "user", id: "client-q-1", ts: clientQTs, text: "Что по клиенту?" },
                {
                    kind: "assistant",
                    id: "client-q-2",
                    ts: clientQTs,
                    text: "Алина Касымова, лид L-20481 из Bayut (кампания Dubai Hills 2BR, 27.10). Стадия «Показ назначен», 3 из 5: показ Collective 2.0 в чт 30 окт, 16:30. Объект понравился, подборку PDF смотрела 3 мин, дольше всего стр. 3. Бюджет до AED 3 000 000, хочет готовое и парковку. Окно WhatsApp ещё 21 ч.",
                    suggestions: [
                        {
                            id: "s1",
                            title: "Напомнить клиенту и прислать локацию за час до показа",
                            reason: "вы обещали в 11:47 «пришлю локацию за час до показа»",
                            prompt: "Напомни Алине и пришли локацию за час до показа",
                        },
                        {
                            id: "s2",
                            title: "Предложить ещё 2 варианта с гостевой парковкой",
                            reason: "клиент спросил про парковку 18:02 · в подборке парковка есть у 1 из 4",
                            prompt: "Подбери Алине ещё 2 варианта с гостевой парковкой",
                        },
                        {
                            id: "s3",
                            title: "После показа — завести сделку",
                            reason: "показ сегодня 16:30 · объект понравился, бюджет подтверждён",
                            prompt: "После показа заведи сделку с Алиной",
                        },
                    ],
                },
            ],
        },
        {
            id: "client-new",
            title: "Новый клиент: Сергей Мельник",
            context: SERGEY,
            preview: "Клиент создан, Павел С. уведомлён",
            lastActivityTs: newClientTs,
            messages: [
                {
                    kind: "user",
                    id: "client-new-1",
                    ts: newClientTs,
                    text: "Новый клиент: Сергей Мельник, +971 55 …, ищет аренду 1BR Marina",
                },
                {
                    kind: "assistant",
                    id: "client-new-2",
                    ts: newClientTs,
                    text: "",
                    artifact: {
                        id: "art-client",
                        type: "contact",
                        title: "Новый клиент",
                        subtitle: "запрос «снять» · направление Аренда",
                        state: "finalized",
                        fields: [
                            { label: "Имя", value: "Сергей Мельник" },
                            { label: "Телефон", value: "+971 55 …" },
                            { label: "Запрос", value: "аренда · 1BR" },
                            { label: "Район", value: "Dubai Marina" },
                        ],
                        match: {
                            initials: "ПС",
                            color: "#47795A",
                            title: "Похожий контакт уже есть у брокера Павла С.",
                            detail: "совпадает телефон · последний контакт 12 окт",
                        },
                        finalizeLabel: "Это другой человек — создать",
                        secondaryLabel: "Открыть совпадение",
                        resultText: "Клиент создан · другой человек, Павел С. уведомлён",
                        portableMarkdown: "**Новый клиент**: Сергей Мельник, аренда 1BR, Dubai Marina.",
                        insisUrl: `${INSIS}/contacts/art-client`,
                    },
                },
            ],
        },
        {
            id: "selection",
            title: "Подборка 1BR Marina для Сергея",
            context: SERGEY,
            preview: "Подборка · 4 объекта",
            lastActivityTs: selectionTs,
            messages: [
                {
                    kind: "user",
                    id: "selection-1",
                    ts: selectionTs,
                    text: "Собери Сергею подборку: аренда 1BR в Marina, до 120 тыс. в год, с видом на воду",
                },
                {
                    kind: "assistant",
                    id: "selection-2",
                    ts: selectionTs,
                    text: "",
                    artifact: {
                        id: "art-selection",
                        type: "confirmation",
                        title: "Подборка · 4 объекта",
                        subtitle: "для Сергея Мельника · аренда 1BR · Dubai Marina",
                        state: "draft",
                        critical: true,
                        fields: [],
                        items: [
                            {
                                title: "Marina Gate 1",
                                subtitle: "AED 118 000 / год",
                                color: "linear-gradient(160deg,#BCC7D2,#7B8C9C)",
                            },
                            {
                                title: "Botanica Tower",
                                subtitle: "AED 105 000 / год",
                                color: "linear-gradient(160deg,#C9D2C2,#8B9A84)",
                            },
                            {
                                title: "Cayan Tower",
                                subtitle: "AED 115 000 / год",
                                color: "linear-gradient(160deg,#D8CFC2,#A69680)",
                            },
                            {
                                title: "Marina Promenade",
                                subtitle: "AED 112 000 / год",
                                color: "linear-gradient(160deg,#CBC6BE,#8F877C)",
                            },
                        ],
                        confirmText:
                            "Сергей Мельник получит в WhatsApp 4 объекта с трекаемой ссылкой. Это сообщение клиенту — его нельзя отозвать.",
                        finalizeLabel: "Отправить клиенту",
                        secondaryLabel: "Изменить",
                        resultText: "Отправлено Сергею в WhatsApp",
                        finalizedLabel: "Отправлено",
                        portableMarkdown:
                            "**Подборка · 4 объекта** для Сергея Мельника: Marina Gate 1, Botanica Tower, Cayan Tower, Marina Promenade.",
                        insisUrl: `${INSIS}/selections/art-selection`,
                    },
                },
            ],
        },
        {
            id: "owner",
            title: "Отчёт владельцу · Marina Gate",
            context: "объект: Marina Gate 1",
            preview: "Отправлено владельцу 24.10",
            lastActivityTs: ownerTs,
            messages: [
                { kind: "user", id: "owner-1", ts: ownerTs, text: "Отчёт владельцу по Marina Gate за октябрь" },
                {
                    kind: "assistant",
                    id: "owner-2",
                    ts: ownerTs + MINUTE,
                    text: "За октябрь: 3 показа, 2 запроса с Property Finder, 1 оффер AED 1 980 000 (ниже ожидания на 4 %). Собрал отчёт на русском и английском.",
                    artifact: {
                        // A type Lobby does not draw natively: shown from its portable Markdown.
                        id: "art-owner",
                        type: "owner_report",
                        title: "Отчёт владельцу · октябрь",
                        subtitle: "Marina Gate 1 · PDF + ссылка",
                        state: "finalized",
                        fields: [],
                        finalizeLabel: "Отправить владельцу",
                        portableMarkdown:
                            "**Отчёт владельцу · октябрь** — Marina Gate 1\n\n- Показы: **3**\n- Запросы: **2** (Property Finder)\n- Оффер: **AED 1 980 000**, на 4 % ниже ожидания\n\nОтправлено владельцу 24.10 · 10:20",
                        insisUrl: `${INSIS}/reports/art-owner`,
                    },
                },
            ],
        },
        {
            id: "week",
            title: "Задачи на неделю",
            context: "",
            preview: "Создано 4 задачи",
            lastActivityTs: weekTs,
            messages: [
                { kind: "user", id: "week-1", ts: weekTs, text: "Что у меня на неделе? Заведи задачи" },
                {
                    kind: "assistant",
                    id: "week-2",
                    ts: weekTs,
                    text: "На неделе:\n1. Показ Collective 2.0 — чт 16:30\n2. Продление Ejari, Marina Gate — до пт\n3. Перезвонить Игорю Петренко про payment plan\n4. Отчёт владельцу Marina Gate",
                    artifact: {
                        id: "art-week",
                        type: "task",
                        title: "4 задачи",
                        subtitle: "в «Задачах» Insis, со сроками",
                        state: "finalized",
                        fields: [],
                        finalizeLabel: "Создать задачи",
                        resultText: "Создано 4 задачи",
                        portableMarkdown: "**4 задачи** в «Задачах» Insis.",
                        insisUrl: `${INSIS}/tasks`,
                    },
                },
            ],
        },
    ];
}
