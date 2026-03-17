const STORY_THREAD_TABLES = {
    family: {
        seed: "RollTable.StFamSeedQ7mR1601",
        progress: "RollTable.StFamProgQ7mR1602",
        resolution: "RollTable.StFamResoQ7mR1603"
    },
    self: {
        seed: "RollTable.StSelfSeedQ7mR1604",
        progress: "RollTable.StSelfProgQ7mR1605",
        resolution: "RollTable.StSelfResoQ7mR1606"
    }
};

const THREE_D6_COUNTS = new Map([
    [3, 1], [4, 3], [5, 6], [6, 10], [7, 15], [8, 21], [9, 25], [10, 27],
    [11, 27], [12, 25], [13, 21], [14, 15], [15, 10], [16, 6], [17, 3], [18, 1]
]);

function rangeWeightFor3d6(result) {
    const range = Array.isArray(result?.range) ? result.range : [];
    const lo = Number(range[0]);
    const hi = Number(range[1]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;

    let total = 0;
    for (let n = lo; n <= hi; n++) total += THREE_D6_COUNTS.get(n) ?? 0;
    return total;
}

function pickWeightedResult(results, weightFn) {
    const weighted = results
        .map(result => ({ result, weight: Math.max(0, Number(weightFn(result) ?? 0)) }))
        .filter(entry => entry.weight > 0);

    if (!weighted.length) return null;

    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let pick = (new Roll(`1d${total}`)).evaluate({ async: false }).total;
    for (const entry of weighted) {
        pick -= entry.weight;
        if (pick <= 0) return entry.result;
    }

    return weighted[weighted.length - 1].result;
}

export function getStoryPhase(tableName) {
    const name = String(tableName ?? "").trim().toLowerCase();
    if (!name) return null;
    if (name.startsWith("birth") || name.startsWith("childhood")) return "family";
    if (name.startsWith("adolescence") || name.startsWith("career") || name.startsWith("advanced")) return "self";
    return null;
}

export function getStoryLabel(tableName) {
    const raw = String(tableName ?? "").trim();
    if (!raw) return "";
    return raw
        .replace(/^(Birth|Childhood|Adolescence|Career|Advanced)\s*-\s*/i, "")
        .trim();
}

export function parseStoryTags(rawText) {
    let remaining = String(rawText ?? "");
    const changes = [];

    while (true) {
        const match = remaining.match(/^\s*\[([^\]]+)\]/);
        if (!match) break;

        const body = String(match[1] ?? "").trim();
        const parts = body.split(/\s+/).filter(Boolean);
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
        }

        remaining = remaining.slice(match[0].length);
    }

    return {
        text: remaining.trim(),
        changes
    };
}

export async function applyStoryResult(app, run, tableName, rawText) {
    const parsed = parseStoryTags(rawText);
    if (parsed.changes.length) {
        await app._applyChanges(run, parsed.changes);
    }
    if (parsed.text) {
        await app._addStory(run, tableName, parsed.text);
    }
}

export async function drawStoryTableResult(app, tableUuidOrId, nameFilter = null) {
    const table = await app._getRollTable(tableUuidOrId);
    if (!table) throw new Error(`RollTable not found: ${tableUuidOrId}`);

    let results = Array.from(table.results?.contents ?? []).filter(r => {
        const raw = String(app.constructor._resultRawJSON(r) ?? "").trim();
        return raw !== "";
    });

    if (nameFilter != null) {
        const needle = String(nameFilter).trim().toLowerCase();
        results = results.filter(r => String(r?.name ?? "").trim().toLowerCase() === needle);
    }

    if (!results.length) return null;

    const use3d6Weighting = String(table.formula ?? "").trim().toLowerCase() === "3d6";
    const picked = pickWeightedResult(
        results,
        use3d6Weighting
            ? (result) => rangeWeightFor3d6(result)
            : (result) => Math.max(1, Number(result?.weight ?? 1))
    );

    if (!picked) return null;

    return {
        table,
        result: picked,
        key: String(picked?.name ?? "").trim(),
        text: String(app.constructor._resultRawJSON(picked) ?? "").trim()
    };
}

export async function advanceStoryThread(app, run, { tableName, choiceTitle, choiceTags = [] } = {}) {
    run.story ??= {
        familySuspended: false,
        active: null,
        phase: null,
        transitionedToSelf: false
    };

    const story = run.story;
    const phase = getStoryPhase(tableName);
    story.phase = phase ?? story.phase ?? null;

    const normalizedTags = Array.isArray(choiceTags)
        ? choiceTags.map(tag => String(tag ?? "").trim().toLowerCase()).filter(Boolean)
        : [];

    if (normalizedTags.includes("born-alone")) {
        story.familySuspended = true;
    }

    if (!phase) return;
    if (phase === "family" && story.familySuspended) return;

    if (phase === "self" && story.active?.phase === "family" && !story.transitionedToSelf) {
        story.active.phase = "self";
        story.transitionedToSelf = true;
        await applyStoryResult(app, run, tableName, "What had once burdened your household began to attach itself to your own name.");
    }

    if (!story.active) {
        const seedPulse = (new Roll("1d4")).evaluate({ async: false }).total;
        if (seedPulse !== 4) return;

        const seed = await drawStoryTableResult(app, STORY_THREAD_TABLES[phase].seed);
        if (!seed?.text) return;
        story.active = {
            key: String(seed.key || "story-thread").trim(),
            phase,
            stage: 1,
            updates: 0
        };
        await applyStoryResult(app, run, tableName, seed.text);
        return;
    }

    const active = story.active;
    const activePhase = active.phase === "family" && phase === "self" ? "self" : active.phase;
    const progressPulse = (new Roll("1d3")).evaluate({ async: false }).total;
    if (progressPulse !== 3) return;

    if (active.stage >= 2) {
        const resolveRoll = Number(active.updates ?? 0) >= 2
            ? (new Roll("1d2")).evaluate({ async: false }).total
            : (new Roll("1d3")).evaluate({ async: false }).total;
        const shouldResolve = Number(active.updates ?? 0) >= 2
            ? resolveRoll === 2
            : resolveRoll === 3;
        if (shouldResolve) {
            const resolution = await drawStoryTableResult(app, STORY_THREAD_TABLES[activePhase].resolution, active.key);
            if (resolution?.text) {
                await applyStoryResult(app, run, tableName, resolution.text);
                story.active = null;
                return;
            }
        }
    }

    const progress = await drawStoryTableResult(app, STORY_THREAD_TABLES[activePhase].progress, active.key);
    if (!progress?.text) return;

    await applyStoryResult(app, run, tableName, progress.text);
    active.updates = Number(active.updates ?? 0) + 1;
    if (Number(active.stage ?? 1) < 3 && (new Roll("1d3")).evaluate({ async: false }).total === 3) {
        active.stage = Number(active.stage ?? 1) + 1;
    }
}
