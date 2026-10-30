/*
Copyright 2026 Inside Estate.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { ClientConversation, ClientTemplate, LeadCard, WaitingQueue } from "./model";

/*
 * Inside: test data of the preview — made-up people, the mockup's conversations (docs/design/lobby/variants,
 * #chat-b). Nothing here is real and nothing of it goes to Matrix (ADR-069 К-1).
 *
 * Times are times of day, as in the mockup ("сегодня 11:42"). Before 12:30 those would be in the future, so then
 * "today" of the data is yesterday.
 */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A time of day `days` days from the data's "today". */
function clock(now: number): (days: number, hours: number, minutes: number) => number {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const shift = now < midnight.getTime() + 12 * HOUR + 30 * MIN ? -1 : 0;
    return (days, hours, minutes) => {
        const d = new Date(midnight.getTime());
        d.setDate(d.getDate() + days + shift);
        d.setHours(hours, minutes, 0, 0);
        return d.getTime();
    };
}

const THUMBS = [
    "linear-gradient(160deg,#B9C4C9,#7D8B90)",
    "linear-gradient(160deg,#D8CFC2,#A69680)",
    "linear-gradient(160deg,#C9D2C2,#8B9A84)",
    "linear-gradient(160deg,#BCC7D2,#7B8C9C)",
];

/** Inside: test client conversations of the preview (made-up people, the mockup's data). */
export function makeClientConversations(now: number): ClientConversation[] {
    const at = clock(now);
    return [
        {
            id: "alina",
            displayName: "Алина Касымова",
            initials: "АК",
            avatarColor: "#2C7370",
            online: true,
            channel: "whatsapp",
            phone: "+971 50 418 27 63",
            subtitle: "в сети · брокер Амир Х.",
            stage: "Показ назначен",
            unread: 0,
            lastActivityTs: at(0, 11, 52),
            serviceWindowUntil: at(0, 11, 42) + DAY,
            clientTimeZone: "Asia/Dubai",
            leadId: "L-20481",
            timeline: [
                {
                    kind: "system",
                    id: "a0",
                    ts: at(-1, 18, 2),
                    icon: "lead",
                    text: "Новый лид из Bayut · назначен Амиру Х.",
                },
                {
                    kind: "message",
                    id: "a1",
                    ts: at(-1, 18, 2),
                    author: { kind: "client" },
                    text: "Здравствуйте! Увидела ваше объявление на Bayut. Интересует 2BR в Dubai Hills, бюджет до 3 млн AED",
                },
                {
                    kind: "message",
                    id: "a2",
                    ts: at(-1, 18, 2),
                    author: { kind: "client" },
                    text: "Готовое жильё, хотим заехать до весны",
                },
                {
                    kind: "message",
                    id: "a3",
                    ts: at(-1, 18, 7),
                    author: { kind: "me" },
                    text: "Добрый вечер, Алина! Меня зовут Амир, я брокер Inside Realty",
                    delivery: "read",
                },
                {
                    kind: "message",
                    id: "a4",
                    ts: at(-1, 18, 9),
                    author: { kind: "me" },
                    text: "Подобрал 4 варианта от 2 450 000 AED. Первый — Collective 2.0, сдан, вид на парк",
                    attachment: {
                        kind: "listing",
                        site: "insiderealty.ae",
                        title: "Collective 2.0 · 2BR · 1 245 sqft",
                        subtitle: "AED 2 450 000 · готовый · Dubai Hills Estate",
                    },
                    delivery: "read",
                },
                {
                    kind: "message",
                    id: "a5",
                    ts: at(-1, 18, 10),
                    author: { kind: "me" },
                    attachment: {
                        kind: "file",
                        title: "Dubai Hills — подборка 2BR.pdf",
                        subtitle: "2,4 МБ · 4 объекта",
                    },
                    delivery: "read",
                },
                {
                    kind: "message",
                    id: "a6",
                    ts: at(0, 11, 42),
                    author: { kind: "client" },
                    replyTo: {
                        author: "Амир Х.",
                        text: "Подобрал 4 варианта от 2 450 000 AED. Первый — Collective 2.0",
                    },
                    text: "Первый очень нравится. Можно посмотреть в четверг после 16:00?",
                },
                {
                    kind: "message",
                    id: "a7",
                    ts: at(0, 11, 47),
                    author: { kind: "me" },
                    text: "Да, четверг 16:30 подходит. Пришлю локацию за час до показа",
                    delivery: "read",
                },
                {
                    kind: "message",
                    id: "a8",
                    ts: at(0, 11, 48),
                    author: { kind: "me" },
                    text: "Парковка гостевая, на въезде скажите «Inside Realty»",
                    reactions: [{ key: "👍", count: 1 }],
                    delivery: "delivered",
                },
                {
                    kind: "system",
                    id: "a9",
                    ts: at(0, 11, 52),
                    icon: "calendar",
                    text: "Амир создал показ в Insis · чт, 30 окт, 16:30",
                },
            ],
        },
        {
            id: "mohammed",
            displayName: "Mohammed Rashid",
            initials: "MR",
            avatarColor: "#26608F",
            channel: "whatsapp",
            phone: "+971 55 902 11 40",
            subtitle: "был(а) недавно · брокер Амир Х.",
            stage: "Viewing scheduled",
            unread: 0,
            lastActivityTs: at(0, 10, 18),
            serviceWindowUntil: at(0, 10, 2) + DAY,
            clientTimeZone: "Europe/London",
            leadId: "L-20476",
            timeline: [
                {
                    kind: "message",
                    id: "m1",
                    ts: at(0, 9, 55),
                    author: { kind: "client" },
                    text: "Hi Amir, is the 3BR in Emaar Beachfront still available?",
                },
                {
                    kind: "message",
                    id: "m2",
                    ts: at(0, 9, 58),
                    author: { kind: "me" },
                    text: "Good morning! Yes, Beach Isle 3BR on the 21st floor is available, AED 6 900 000",
                    delivery: "read",
                },
                {
                    kind: "message",
                    id: "m3",
                    ts: at(0, 10, 2),
                    author: { kind: "client" },
                    text: "Great. Can we see it on Thursday afternoon?",
                },
                {
                    kind: "message",
                    id: "m4",
                    ts: at(0, 10, 18),
                    author: { kind: "me" },
                    text: "Thursday 4 pm works, I’ll send the location in the morning",
                    delivery: "read",
                },
            ],
        },
        {
            id: "igor",
            displayName: "Игорь Петренко",
            initials: "ИП",
            avatarColor: "#6D7A2C",
            channel: "whatsapp",
            phone: "+7 916 204 55 18",
            subtitle: "был(а) вчера · брокер Анна П. → вы",
            stage: "В работе",
            unread: 1,
            lastActivityTs: at(-1, 19, 4),
            serviceWindowUntil: at(-1, 19, 4) + DAY,
            clientTimeZone: "Europe/Moscow",
            leadId: "L-20311",
            timeline: [
                {
                    kind: "message",
                    id: "i1",
                    ts: at(-6, 12, 10),
                    author: { kind: "client" },
                    text: "Добрый день! Рассматриваю off-plan в Dubai Creek Harbour, 1–2BR",
                },
                {
                    kind: "message",
                    id: "i2",
                    ts: at(-6, 12, 10),
                    author: { kind: "ai_agent" },
                    text: "Здравствуйте, Игорь! Передаю ваш запрос брокеру, он свяжется в течение часа",
                    delivery: "read",
                },
                {
                    kind: "message",
                    id: "i3",
                    ts: at(-6, 12, 41),
                    author: { kind: "colleague", displayName: "Анна Петрова", fromPhone: true },
                    text: "Игорь, добрый день! Пришлю подборку сегодня вечером",
                    delivery: "read",
                },
                {
                    kind: "message",
                    id: "i4",
                    ts: at(-6, 20, 15),
                    author: { kind: "colleague", displayName: "Анна Петрова" },
                    attachment: {
                        kind: "file",
                        title: "Creek Harbour — off-plan.pdf",
                        subtitle: "3,8 МБ · 6 объектов",
                    },
                    delivery: "read",
                },
                {
                    kind: "message",
                    id: "i5",
                    ts: at(-4, 10, 0),
                    author: { kind: "automation" },
                    text: "Напоминаем: ваш брокер ждёт ответа по подборке. Ответьте на это сообщение, если удобно созвониться",
                    delivery: "delivered",
                },
                { kind: "assignment_changed", id: "i6", ts: at(-2, 9, 30), from: "Анна Петрова", to: "me" },
                {
                    kind: "message",
                    id: "i7",
                    ts: at(-1, 19, 4),
                    author: { kind: "client" },
                    text: "Пришлите, пожалуйста, планировку и payment plan",
                },
            ],
        },
        {
            id: "olga",
            displayName: "Ольга Смирнова",
            initials: "ОС",
            avatarColor: "#6B4FA8",
            channel: "whatsapp",
            phone: "+971 52 317 08 92",
            subtitle: "была 3 дня назад · брокер Амир Х.",
            stage: "Новый",
            unread: 0,
            lastActivityTs: at(-3, 16, 20),
            serviceWindowUntil: at(-3, 15, 55) + DAY,
            clientTimeZone: "Asia/Dubai",
            leadId: "L-20219",
            timeline: [
                {
                    kind: "message",
                    id: "o1",
                    ts: at(-3, 15, 55),
                    author: { kind: "client" },
                    text: "Добрый день, интересует аренда виллы в Arabian Ranches на год",
                },
                {
                    kind: "message",
                    id: "o2",
                    ts: at(-3, 16, 20),
                    author: { kind: "me" },
                    text: "Ольга, здравствуйте! Какой бюджет и с какого месяца планируете заезд?",
                    delivery: "delivered",
                },
            ],
        },
        {
            id: "timur",
            displayName: "Тимур Ахмедов",
            initials: "ТА",
            avatarColor: "#8A5A3E",
            channel: "telegram",
            phone: "+998 90 118 42 07",
            subtitle: "был(а) недавно · брокер Амир Х.",
            stage: "В работе",
            unread: 0,
            lastActivityTs: at(-2, 13, 6),
            clientTimeZone: "Asia/Tashkent",
            leadId: "L-20288",
            timeline: [
                {
                    kind: "message",
                    id: "t1",
                    ts: at(-2, 12, 40),
                    author: { kind: "client" },
                    text: "Можно прислать презентацию Sobha Hartland II?",
                },
                {
                    kind: "message",
                    id: "t2",
                    ts: at(-2, 13, 6),
                    author: { kind: "me" },
                    attachment: { kind: "file", title: "Sobha Hartland II.pdf", subtitle: "18,4 МБ" },
                    delivery: "failed",
                    failReason: "Файл больше лимита канала (16 МБ)",
                },
            ],
        },
        {
            id: "sergey",
            displayName: "Сергей Мельник",
            initials: "СМ",
            avatarColor: "#47795A",
            online: true,
            channel: "whatsapp",
            phone: "+971 58 640 12 75",
            subtitle: "в сети · ждёт приёма",
            stage: "Новый",
            unread: 1,
            lastActivityTs: at(0, 9, 12),
            serviceWindowUntil: at(0, 9, 12) + DAY,
            clientTimeZone: "Asia/Dubai",
            leadId: "L-20502",
            queue: "pending",
            timeline: [
                { kind: "system", id: "s0", ts: at(0, 9, 12), icon: "lead", text: "Новый лид с сайта · назначен вам" },
                {
                    kind: "message",
                    id: "s1",
                    ts: at(0, 9, 12),
                    author: { kind: "client" },
                    text: "Здравствуйте! Ищу 1BR в Dubai Marina до 1,6 млн, можно с арендатором",
                },
            ],
        },
    ];
}

/** Inside: conversations waiting in the queue ("Ждут приёма"); "Принять следующий" takes the first. */
export function makeQueuedConversations(now: number): ClientConversation[] {
    return [
        {
            id: "natalia",
            displayName: "Наталья Ким",
            initials: "НК",
            avatarColor: "#8E3D52",
            online: true,
            channel: "whatsapp",
            phone: "+971 50 772 39 14",
            subtitle: "в сети · брокер — вы",
            stage: "Новый",
            unread: 1,
            lastActivityTs: now - 12 * MIN,
            serviceWindowUntil: now - 12 * MIN + DAY,
            clientTimeZone: "Asia/Dubai",
            leadId: "L-20517",
            queue: "accepted",
            timeline: [
                {
                    kind: "system",
                    id: "n0",
                    ts: now - 12 * MIN,
                    icon: "lead",
                    text: "Новый лид из Property Finder · принят вами",
                },
                {
                    kind: "message",
                    id: "n1",
                    ts: now - 12 * MIN,
                    author: { kind: "client" },
                    text: "Добрый день! Хочу продать квартиру в JLT и купить побольше в Dubai Hills",
                },
            ],
        },
        {
            id: "rahul",
            displayName: "Rahul Mehta",
            initials: "RM",
            avatarColor: "#9A6A11",
            channel: "whatsapp",
            phone: "+91 98201 44 310",
            subtitle: "был(а) недавно · брокер — вы",
            stage: "New",
            unread: 1,
            lastActivityTs: now - 5 * MIN,
            serviceWindowUntil: now - 5 * MIN + DAY,
            clientTimeZone: "Asia/Kolkata",
            leadId: "L-20520",
            queue: "accepted",
            timeline: [
                { kind: "system", id: "r0", ts: now - 5 * MIN, icon: "lead", text: "Новый лид из Bayut · принят вами" },
                {
                    kind: "message",
                    id: "r1",
                    ts: now - 5 * MIN,
                    author: { kind: "client" },
                    text: "Hello, looking for a 2BR investment unit with a payment plan, budget AED 2M",
                },
            ],
        },
    ];
}

/** Inside: the queue of the preview, "Ждут приёма · 2". */
export function makeWaitingQueue(now: number): WaitingQueue {
    return { count: 2, oldestSince: now - 12 * MIN };
}

/** Inside: approved WhatsApp templates of the preview. */
export function makeClientTemplates(): ClientTemplate[] {
    return [
        {
            id: "followup",
            name: "Продолжить разговор",
            language: "ru",
            body: "{{name}}, добрый день! Это Inside Realty. Удобно продолжить разговор о вашем запросе? Ответьте на это сообщение — брокер на связи.",
        },
        {
            id: "viewing",
            name: "Напоминание о показе",
            language: "ru",
            body: "{{name}}, напоминаем о показе. Ответьте на это сообщение, чтобы подтвердить время или перенести.",
        },
        {
            id: "selection",
            name: "Новая подборка",
            language: "ru",
            body: "{{name}}, мы подобрали новые варианты по вашему запросу. Ответьте «да», и брокер пришлёт подборку.",
        },
        {
            id: "followup_en",
            name: "Follow-up",
            language: "en",
            body: "Hi {{name}}, this is Inside Realty. Is it a good time to continue about your request? Reply to this message and your broker will get back to you.",
        },
    ];
}

function smallCard(
    conversationId: string,
    leadId: string,
    stage: string,
    stageIndex: number,
    extra: Partial<LeadCard>,
): LeadCard {
    return {
        conversationId,
        leadId,
        stage,
        stageIndex,
        stageCount: 5,
        budget: "—",
        source: "—",
        broker: "Амир Х.",
        wants: [],
        suggestions: [],
        listings: [],
        journey: [],
        files: [],
        insisUrl: `https://insis.inside.estate/crm/leads/${leadId}`,
        ...extra,
    };
}

/** Inside: test lead cards of the preview, by conversation id. */
export function makeLeadCards(now: number): Record<string, LeadCard> {
    const at = clock(now);
    const cards: LeadCard[] = [
        {
            conversationId: "alina",
            leadId: "L-20481",
            stage: "Показ назначен",
            stageIndex: 3,
            stageCount: 5,
            budget: "до AED 3 000 000",
            source: "Bayut · 27.10",
            campaign: "кампания Dubai Hills 2BR",
            broker: "Амир Х.",
            wants: ["2BR", "готовое", "Dubai Hills", "парковка", "заезд до весны"],
            nextStep: { title: "Показ · Collective 2.0", when: "чт, 30 окт · 16:30" },
            suggestions: [
                {
                    id: "remind",
                    title: "Напомнить клиенту и прислать локацию за час до показа",
                    reason: "вы обещали в 11:47 «пришлю локацию за час до показа»",
                    prompt: "Напомни Алине о показе и пришли локацию за час до показа",
                },
                {
                    id: "parking",
                    title: "Предложить ещё 2 варианта с гостевой парковкой",
                    reason: "клиент спросил про парковку 18:02 · в подборке парковка есть у 1 из 4",
                    prompt: "Подбери ещё 2 варианта 2BR в Dubai Hills с гостевой парковкой",
                },
                {
                    id: "deal",
                    title: "После показа — завести сделку",
                    reason: "показ сегодня 16:30 · объект понравился, бюджет подтверждён",
                    prompt: "После показа подготовь сделку по Collective 2.0",
                },
            ],
            listings: [
                {
                    id: "l1",
                    title: "Collective 2.0 · 2BR · 1 245 sqft",
                    subtitle: "готовое",
                    price: "AED 2 450 000",
                    tags: [
                        { label: "показ назначен", tone: "key" },
                        { label: "понравился", tone: "signal" },
                    ],
                    thumb: THUMBS[0],
                },
                {
                    id: "l2",
                    title: "Socio Tower 2 · 2BR · 1 080 sqft",
                    subtitle: "готовое",
                    price: "AED 2 520 000",
                    tags: [{ label: "просмотрен 3 мин" }],
                    thumb: THUMBS[1],
                },
                {
                    id: "l3",
                    title: "Park Heights 2 · 2BR · 1 160 sqft",
                    subtitle: "готовое",
                    price: "AED 2 690 000",
                    tags: [{ label: "отправлен" }],
                    thumb: THUMBS[2],
                },
                {
                    id: "l4",
                    title: "Golf Suites · 2BR · 1 210 sqft",
                    subtitle: "готовое",
                    price: "AED 2 880 000",
                    tags: [{ label: "отправлен" }],
                    thumb: THUMBS[3],
                },
            ],
            journey: [
                {
                    id: "j1",
                    ts: at(-1, 18, 2),
                    title: "Новый лид из Bayut",
                    detail: "кампания Dubai Hills 2BR",
                    done: true,
                },
                {
                    id: "j2",
                    ts: at(-1, 18, 2),
                    title: "Назначен Амиру Х.",
                    detail: "по очереди направления",
                    done: true,
                },
                { id: "j3", ts: at(-1, 18, 7), title: "Первый ответ через 5 мин", detail: "WhatsApp", done: true },
                { id: "j4", ts: at(-1, 18, 10), title: "Подборка отправлена", detail: "4 объекта, PDF", done: true },
                {
                    id: "j5",
                    ts: at(-1, 18, 41),
                    title: "PDF просмотрен 3 мин, стр. 1–4",
                    detail: "дольше всего стр. 3",
                    done: true,
                },
                { id: "j6", ts: at(0, 11, 52), title: "Показ назначен", detail: "чт, 30 окт, 16:30", done: false },
            ],
            files: [
                {
                    id: "f1",
                    name: "Dubai Hills — подборка 2BR.pdf",
                    size: "2,4 МБ",
                    ts: at(-1, 18, 10),
                    pageSeconds: [42, 58, 112, 33],
                    viewSummary: "Просмотрено 3 мин · дольше всего стр. 3 (Collective 2.0)",
                },
                { id: "f2", name: "Планировка Collective 2.0.jpg", size: "840 КБ", ts: at(-1, 18, 9) },
                { id: "f3", name: "Payment plan — Socio Tower 2.pdf", size: "320 КБ", ts: at(-1, 18, 10) },
            ],
            insisUrl: "https://insis.inside.estate/crm/leads/L-20481",
        },
        smallCard("mohammed", "L-20476", "Viewing scheduled", 3, {
            budget: "up to AED 7 000 000",
            source: "Website · 30.10",
            wants: ["3BR", "sea view", "Emaar Beachfront"],
            nextStep: { title: "Viewing · Beach Isle 3BR", when: "Thu, 30 Oct · 16:00" },
            suggestions: [
                {
                    id: "loc",
                    title: "Send the location in the morning",
                    reason: "you promised at 10:18 “I’ll send the location in the morning”",
                    prompt: "Remind me to send Mohammed the location on Thursday morning",
                },
            ],
            listings: [
                {
                    id: "m1",
                    title: "Beach Isle · 3BR · 1 820 sqft",
                    subtitle: "ready",
                    price: "AED 6 900 000",
                    tags: [{ label: "viewing", tone: "key" }],
                    thumb: THUMBS[3],
                },
            ],
        }),
        smallCard("igor", "L-20311", "В работе", 2, {
            budget: "до AED 2 000 000",
            source: "Сайт · 24.10",
            broker: "Вы (от Анны П.)",
            wants: ["off-plan", "1–2BR", "Creek Harbour", "payment plan"],
            suggestions: [
                {
                    id: "plan",
                    title: "Прислать планировку и payment plan",
                    reason: "клиент попросил вчера в 19:04, ответа ещё нет",
                    prompt: "Подбери планировки и payment plan по Creek Harbour для Игоря",
                },
            ],
            files: [{ id: "f1", name: "Creek Harbour — off-plan.pdf", size: "3,8 МБ", ts: at(-6, 20, 15) }],
        }),
        smallCard("olga", "L-20219", "Новый", 1, {
            budget: "аренда, до AED 350 000 / год",
            source: "Instagram · 27.10",
            wants: ["вилла", "аренда", "Arabian Ranches"],
            suggestions: [
                {
                    id: "tpl",
                    title: "Вернуть клиента шаблоном",
                    reason: "окно WhatsApp закрыто, клиент не ответил на вопрос о бюджете",
                    prompt: "Какой шаблон отправить Ольге, чтобы продолжить разговор?",
                },
            ],
        }),
        smallCard("timur", "L-20288", "В работе", 2, {
            budget: "до AED 1 800 000",
            source: "Telegram · 25.10",
            wants: ["off-plan", "Sobha"],
            suggestions: [
                {
                    id: "link",
                    title: "Отправить презентацию ссылкой",
                    reason: "файл 18,4 МБ не прошёл в Telegram",
                    prompt: "Сделай ссылку на презентацию Sobha Hartland II для Тимура",
                },
            ],
        }),
        smallCard("sergey", "L-20502", "Новый", 1, {
            budget: "до AED 1 600 000",
            source: "Сайт · сегодня",
            broker: "Вы",
            wants: ["1BR", "Dubai Marina", "с арендатором"],
        }),
        smallCard("natalia", "L-20517", "Новый", 1, {
            budget: "—",
            source: "Property Finder · сегодня",
            broker: "Вы",
            wants: ["продажа JLT", "покупка Dubai Hills"],
        }),
        smallCard("rahul", "L-20520", "New", 1, {
            budget: "AED 2 000 000",
            source: "Bayut · today",
            broker: "You",
            wants: ["2BR", "investment", "payment plan"],
        }),
    ];
    return Object.fromEntries(cards.map((card) => [card.conversationId, card]));
}
