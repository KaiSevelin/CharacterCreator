const DEFERRED_TABLES = {
    "old-friend": {
        1: "RollTable.DfOldFrndStg1A0X",
        2: "RollTable.DfOldFrndStg2A0X"
    },
    "old-enemy": {
        1: "RollTable.DfOldEnmyStg1A0X",
        2: "RollTable.DfOldEnmyStg2A0X"
    },
    debt: {
        1: "RollTable.DfDebtRelStg1A0X",
        2: "RollTable.DfDebtRelStg2A0X"
    },
    obligation: {
        1: "RollTable.DfOblgtnStg1A0XZ",
        2: "RollTable.DfOblgtnStg2A0XZ"
    },
    "old-attachment": {
        1: "RollTable.DfAttchStg1A0X1Z",
        2: "RollTable.DfAttchStg2A0X1Z"
    },
    reputation: {
        1: "RollTable.DfReputStg1A0X1Z",
        2: "RollTable.DfReputStg2A0X1Z"
    },
    "family-matter": {
        1: "RollTable.DfFamlyStg1A0X1Z",
        2: "RollTable.DfFamlyStg2A0X1Z"
    },
    "old-wound": {
        1: "RollTable.DfWoundStg1A0X1Z",
        2: "RollTable.DfWoundStg2A0X1Z"
    },
    rival: {
        1: "RollTable.DfRivalStg1A0X1Z",
        2: "RollTable.DfRivalStg2A0X1Z"
    },
    doubt: {
        1: "RollTable.DfDoubtStg1A0X1Z",
        2: "RollTable.DfDoubtStg2A0X1Z"
    },
    vision: {
        1: "RollTable.DfVisionStg1A0X1",
        2: "RollTable.DfVisionStg2A0X1"
    },
    haunting: {
        1: "RollTable.DfHauntgStg1A0X1",
        2: "RollTable.DfHauntgStg2A0X1"
    }
};

const DEFERRED_IMAGES = {
    "old-friend": "media/home/games/1547/Cards/General Friendship.webp",
    "old-enemy": "media/home/games/1547/Cards/General Conflict.webp",
    debt: "media/home/games/1547/Cards/General Money.webp",
    obligation: "media/home/games/1547/Cards/General Obligation.webp",
    "old-attachment": "media/home/games/1547/Cards/General Friendship.webp",
    reputation: "media/home/games/1547/Cards/General Judgment.webp",
    "family-matter": "media/home/games/1547/Cards/General Bloodline.webp",
    "old-wound": "media/home/games/1547/Cards/General Conflict.webp",
    rival: "media/home/games/1547/Cards/General Conflict.webp",
    doubt: "media/home/games/1547/Cards/General Omen.webp",
    vision: "media/home/games/1547/Cards/General Omen.webp",
    haunting: "media/home/games/1547/Cards/General Omen.webp"
};

function tableLabel(tableName) {
    const raw = String(tableName ?? "").trim();
    if (!raw) return "";
    return raw
        .replace(/^(Birth|Childhood|Adolescence|Career|Advanced)\s*-\s*/i, "")
        .trim();
}

function interpolateDeferredText(text, deferred) {
    const sourceTitle = String(deferred?.sourceTitle ?? "").trim();
    const origin = String(deferred?.origin ?? "").trim();

    return String(text ?? "")
        .replace(/\{origin\}/g, origin || "an earlier chapter of your life")
        .replace(/\{sourceTitle\}/g, sourceTitle || "an old turning point");
}

function parseTagArgs(body) {
    return String(body ?? "").trim().split(/\s+/).filter(Boolean);
}

export function parseDeferredTags(rawText, context = {}) {
    let remaining = String(rawText ?? "");
    const changes = [];
    const enqueue = [];

    while (true) {
        const match = remaining.match(/^\s*\[([^\]]+)\]/);
        if (!match) break;

        const body = String(match[1] ?? "").trim();
        const parts = parseTagArgs(body);
        const cmd = String(parts.shift() ?? "").toLowerCase();
        const rest = parts.join(" ").trim();

        if (cmd === "money" && rest) {
            changes.push({ type: "money", formula: rest });
        } else if (cmd === "social" && /^[-+]?\d+$/.test(rest)) {
            changes.push({ type: "social", amount: Number(rest) });
        } else if (cmd === "stat" && parts.length >= 2) {
            const characteristic = parts[0];
            const steps = Number(parts[1]);
            if (["Strength", "Stamina", "Dexterity", "Faith", "Charisma", "Intelligence"].includes(characteristic) && Number.isFinite(steps) && steps !== 0) {
                changes.push({ type: "stat", characteristic, steps });
            }
        } else if (cmd === "body") {
            changes.push({ type: "body" });
        } else if (cmd === "contact") {
            changes.push({ type: "contact" });
        } else if (cmd === "bio" && rest) {
            changes.push({ type: "bio", roll: { tableUuid: rest } });
        } else if (cmd === "item" && rest) {
            if (rest.startsWith("RollTable.")) changes.push({ type: "item", tableUuid: rest, qty: 1 });
            else changes.push({ type: "item", itemUuid: rest, qty: 1 });
        } else if (cmd === "skill" && parts.length >= 2) {
            const targetKey = parts[0];
            const targetLevel = Number(parts[1]);
            if (targetKey && Number.isFinite(targetLevel)) {
                changes.push({ type: "skill", targetKey, targetLevel });
            }
        } else if (cmd === "maneuver" && rest) {
            changes.push({ type: "maneuver", targetKey: rest, targetLevel: 0 });
        } else if (cmd === "drive" && rest) {
            changes.push({ type: "drive", action: "add", category: rest });
        } else if (cmd === "language") {
            changes.push(rest ? { type: "language", tableKey: rest } : { type: "language" });
        } else if (cmd === "defer" && parts.length >= 3) {
            const type = String(parts[0] ?? "").trim().toLowerCase();
            const stage = Number(parts[1]);
            const delay = String(parts[2] ?? "").trim() || "1d6";
            const origin = parts.slice(3).join(" ").trim();
            if (type && Number.isFinite(stage) && delay) {
                enqueue.push({
                    type,
                    stage,
                    delay,
                    origin: origin || String(context.origin ?? "").trim(),
                    sourceTitle: String(context.sourceTitle ?? "").trim(),
                    image: String(context.image ?? "").trim()
                });
            }
        }

        remaining = remaining.slice(match[0].length);
    }

    return {
        text: interpolateDeferredText(remaining.trim(), context),
        changes,
        enqueue
    };
}

async function evaluateDelay(delay) {
    const raw = String(delay ?? "").trim();
    if (!raw) return 1;
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return Math.max(1, Math.floor(numeric));
    const roll = await (new Roll(raw)).evaluate({ async: true });
    return Math.max(1, Number(roll.total ?? 1));
}

export function extractDeferredFromChoice(data, tableName) {
    const deferred = data?.deferred;
    if (!deferred || typeof deferred !== "object") return null;

    const type = String(deferred.type ?? "").trim().toLowerCase();
    if (!type) return null;

    const stage = Number(deferred.stage ?? 1);
    const delay = String(deferred.delay ?? "1d6").trim() || "1d6";
    const origin = String(deferred.origin ?? "").trim() || tableLabel(tableName);
    const sourceTitle = String(data?.choice?.title ?? "").trim();
    const image = String(deferred.image ?? data?.choice?.icon ?? "").trim();

    return {
        type,
        stage: Number.isFinite(stage) ? stage : 1,
        delay,
        origin,
        sourceTitle,
        image
    };
}

export async function enqueueDeferred(run, deferred) {
    if (!deferred?.type) return null;
    run.deferredQueue ??= [];
    run.deferredReady ??= [];

    const entry = {
        type: String(deferred.type).trim().toLowerCase(),
        stage: Math.max(1, Number(deferred.stage ?? 1)),
        countdown: await evaluateDelay(deferred.delay ?? "1d6"),
        origin: String(deferred.origin ?? "").trim(),
        sourceTitle: String(deferred.sourceTitle ?? "").trim(),
        image: String(deferred.image ?? "").trim()
    };

    if (run.deferredQueue.length >= 2) {
        run.deferredQueue.shift();
    }

    run.deferredQueue.push(entry);
    return entry;
}

export function advanceDeferredQueue(run) {
    run.deferredQueue ??= [];
    run.deferredReady ??= [];

    const stillQueued = [];
    for (const entry of run.deferredQueue) {
        const nextCountdown = Math.max(0, Number(entry.countdown ?? 1) - 1);
        if (nextCountdown <= 0) {
            run.deferredReady.push({ ...entry, countdown: 0 });
        } else {
            stillQueued.push({ ...entry, countdown: nextCountdown });
        }
    }

    run.deferredQueue = stillQueued;
}

export async function buildDeferredReveal(app, run) {
    const ready = Array.isArray(run?.deferredReady) ? run.deferredReady.shift() : null;
    if (!ready) return null;

    const tableUuid = DEFERRED_TABLES?.[ready.type]?.[ready.stage] ?? null;
    if (!tableUuid) return null;

    const roll = await app._rollOnce(tableUuid);
    const rawText = String(app.constructor._resultRawJSON(roll.result) ?? "").trim();
    if (!rawText) return null;

    const parsed = parseDeferredTags(rawText, ready);
    return {
        isDeferred: true,
        title: "The Past Returns",
        originLine: ready.origin ? `From your time in ${ready.origin}` : "From an earlier chapter of your life",
        text: parsed.text,
        image: ready.image || DEFERRED_IMAGES[ready.type] || "",
        payload: {
            changes: parsed.changes,
            enqueue: parsed.enqueue
        }
    };
}
