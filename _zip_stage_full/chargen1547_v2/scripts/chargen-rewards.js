export async function parseRewardResult({
    result,
    tableName = "RollTable",
    resolveItemFromRollResult,
    parseTemplateItemToChoiceData,
    resultRawJSON,
    validateParsedResultSchema
}) {
    const item = await resolveItemFromRollResult(result);
    if (item) {
        return parseTemplateItemToChoiceData(item, tableName);
    }

    const raw = resultRawJSON(result);
    if (!raw) throw new Error(`Empty result in ${tableName}.`);
    return parseRewardJSONText(raw, tableName, validateParsedResultSchema);
}

export function parseRewardJSONText(text, tableName = "RollTable", validateParsedResultSchema) {
    const rawIn = String(text ?? "").trim();
    let raw = rawIn;

    if (raw.startsWith("<")) {
        const div = document.createElement("div");
        div.innerHTML = raw;
        raw = (div.textContent ?? "").trim();
    }

    raw = foundry.utils.unescapeHTML(raw).trim();

    if (!raw.startsWith("{")) {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start !== -1 && end !== -1 && end > start) {
            raw = raw.slice(start, end + 1).trim();
        }
    }

    let obj;
    try {
        obj = JSON.parse(raw);
    } catch (e) {
        console.error("PARSE JSON ERROR", e, { tableName, rawIn, rawAfter: raw });
        throw new Error(
            `Invalid JSON in ${tableName} result:\n${e.message}\n\nText was:\n${rawIn.slice(0, 500)}`
        );
    }

    validateParsedResultSchema(obj, tableName);

    const rewards = (Array.isArray(obj.rewards) ? obj.rewards : []).map((r, i) => {
        if (!r || typeof r !== "object") throw new Error(`rewards[${i}] must be an object`);
        const rr = foundry.utils.deepClone(r);
        if (Array.isArray(rr.changes)) {
            for (const ch of rr.changes) {
                if (!ch || typeof ch !== "object") continue;
                if ((ch.type === "skill" || ch.type === "maneuver") && !ch.targetKey) {
                    ch.targetKey = ch.skill ?? ch.maneuver ?? "";
                }
            }
        }

        return {
            rr,
            weight: Number.isFinite(Number(rr.weight)) ? Number(rr.weight) : 1,
            changes: Array.isArray(rr.changes) ? rr.changes : [],
            next: (rr.next && typeof rr.next === "object")
                ? { tableUuid: String(rr.next.tableUuid ?? "").trim() }
                : null
        };
    });

    const effectTables = (Array.isArray(obj.effectTables) ? obj.effectTables : []).map((tbl, tableIdx) => {
        const tt = foundry.utils.deepClone(tbl);
        const rows = (Array.isArray(tt?.rows) ? tt.rows : []).map((row, rowIdx) => {
            if (!row || typeof row !== "object") {
                throw new Error(`effectTables[${tableIdx}].rows[${rowIdx}] must be an object`);
            }

            const rr = foundry.utils.deepClone(row);
            const change = rr.change && typeof rr.change === "object" ? rr.change : null;
            if ((change?.type === "skill" || change?.type === "maneuver") && !change.targetKey) {
                change.targetKey = change.skill ?? change.maneuver ?? "";
            }

            return {
                ...rr,
                weight: Number.isFinite(Number(rr.weight)) ? Number(rr.weight) : 0,
                change,
                next: (rr.next && typeof rr.next === "object")
                    ? { tableUuid: String(rr.next.tableUuid ?? "").trim() }
                    : null
            };
        });

        return { ...tt, rows };
    });

    return {
        choice: {
            title: String(obj.choice.title),
            text: obj.choice.text != null ? String(obj.choice.text) : "",
            icon: obj.choice.icon != null ? String(obj.choice.icon) : "",
            tags: Array.isArray(obj.choice.tags) ? obj.choice.tags.map(String) : []
        },
        bio: obj.bio != null ? String(obj.bio) : "",
        rewards,
        effectTables
    };
}

export function pickWeightedReward(rewards) {
    const list = Array.isArray(rewards) ? rewards.filter(r => r && typeof r === "object") : [];
    if (!list.length) return null;

    const weightOf = (r) => {
        const w = Number(r.weight ?? 1);
        return Number.isFinite(w) ? Math.max(0, w) : 0;
    };

    const total = list.reduce((s, r) => s + weightOf(r), 0);
    if (total <= 0) return list[0];

    let roll = (new Roll(`1d${total}`)).evaluate({ async: false }).total;
    for (const r of list) {
        roll -= weightOf(r);
        if (roll <= 0) return r;
    }
    return list[list.length - 1];
}

export function pickWeightedEffectRow(rows) {
    const list = Array.isArray(rows) ? rows.filter(r => r && typeof r === "object") : [];
    if (!list.length) return null;

    const total = list.reduce((sum, row) => sum + Math.max(0, Number(row.weight ?? 0)), 0);
    if (total <= 0) return list[0];

    let roll = (new Roll(`1d${total}`)).evaluate({ async: false }).total;
    for (const row of list) {
        roll -= Math.max(0, Number(row.weight ?? 0));
        if (roll <= 0) return row;
    }
    return list[list.length - 1];
}

export function resolveRewardFromEffectTables(effectTables) {
    const tables = Array.isArray(effectTables) ? effectTables : [];
    const changes = [];
    let next = null;

    for (const tbl of tables) {
        const row = pickWeightedEffectRow(tbl?.rows ?? []);
        if (!row) continue;
        if (row.change) changes.push(row.change);
        if (!next && row.next?.tableUuid) next = { tableUuid: String(row.next.tableUuid).trim() };
    }

    return { weight: 1, changes, next };
}

export function summarizeRewardChange(ch) {
    if (!ch || typeof ch !== "object") return null;
    if (ch.type === "stat") return `${ch.characteristic} ${Number(ch.steps) >= 0 ? "+" : ""}${ch.steps}`;
    if (ch.type === "skill") return `Skill ${ch.targetKey}${ch.targetLevel != null ? ` -> ${ch.targetLevel}` : ""}`;
    if (ch.type === "maneuver") return `Maneuver ${ch.targetKey}${ch.targetLevel != null ? ` -> ${ch.targetLevel}` : ""}`;
    if (ch.type === "money") return ch.formula ? `Money: ${ch.formula}` : `Money: ${ch.amount}`;
    if (ch.type === "luck") return `Lucky streak: ${ch.on ? "ON" : "OFF"}`;
    if (ch.type === "contact") return "Gain a contact";
    if (ch.type === "body") return "Roll body change";
    if (ch.type === "social") return `Social Status ${Number(ch.amount) >= 0 ? "+" : ""}${ch.amount}`;
    if (ch.type === "drive") return ch.action === "add" ? `Add drive: ${ch.category}` : "Remove a drive";
    if (ch.type === "bio") return ch.text ? `Bio: ${ch.text}` : "Roll biography entry";
    if (ch.type === "item") return `Item: ${ch.name ?? ch.itemUuid ?? ch.tableUuid ?? "unknown"}`;
    if (ch.type === "language") return "Language reward";
    return ch.type;
}

export async function applyRewardChanges(app, run, changes = [], deps = {}) {
    const advanceStat = deps.advanceStat;
    const promptAddDrive = deps.promptAddDrive;
    const promptRemoveDrive = deps.promptRemoveDrive;

    for (const ch of changes) {
        if (!ch || typeof ch !== "object") continue;

        if (ch.type === "money") {
            let amount = 0;

            if (ch.formula) {
                const roll = await (new Roll(String(ch.formula))).evaluate({ async: true });
                amount = roll.total;
            } else if (Number.isFinite(Number(ch.amount))) {
                amount = Number(ch.amount);
            }

            if (amount !== 0) {
                await app._addMoney(amount);
                await app._addBio(run, `Received ${amount} reales`);
            }

            continue;
        }

        if (ch.type === "luck") {
            run.luckyStreak = Boolean(ch.on);
            const reason = ch.reason ? ` (${String(ch.reason)})` : "";
            await app._addBio(run, `Lucky streak: ${run.luckyStreak ? "ON" : "OFF"}${reason}`);

            if (run.luckyStreak) {
                const luckResult = await app._rollLuckTable(run);
                await app._addBio(run, luckResult);
            }

            continue;
        }

        if (ch.type === "contact") {
            const roleRoll = await app._rollOnce(run.contactTables.roleTable);
            const flavorRoll = await app._rollOnce(run.contactTables.flavorTable);
            const toneRoll = await app._rollOnce(run.contactTables.toneTable);
            const quirkRoll = await app._rollOnce(run.contactTables.quirkTable);

            const role = app.constructor._resultRawJSON(roleRoll.result).trim();
            const flavor = app.constructor._resultRawJSON(flavorRoll.result).trim();
            const tone = app.constructor._resultRawJSON(toneRoll.result).trim();
            const quirk = app.constructor._resultRawJSON(quirkRoll.result).trim();

            const d100 = (new Roll("1d100")).evaluate({ async: false }).total;
            const hookCount = (d100 <= 90) ? 1 : 2;

            const hooks = [];
            const seen = new Set();
            const maxAttempts = hookCount * 6;

            for (let i = 0; i < maxAttempts && hooks.length < hookCount; i++) {
                const h = await app._rollOnce(run.contactTables.hookTable);
                const hook = app.constructor._resultRawJSON(h.result).trim();
                if (!hook) continue;

                const key = hook.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                hooks.push(hook);
            }

            const parts = [role];
            if (flavor) parts.push(`- ${flavor}`);
            if (tone) parts.push(`Tone: ${tone}`);
            if (quirk) parts.push(`Quirk: ${quirk}`);
            if (hooks.length) parts.push(`Hooks: ${hooks.join(", ")}`);

            const contactLine = parts.join(" ");
            await app._appendListProp("Contacts", contactLine);
            await app._addBio(run, `Gained a contact: ${contactLine}`);
            continue;
        }

        if (ch.type === "body") {
            const rr = await app._rollOnce(run.bodyTable);
            const txt = app.constructor._resultRawJSON(rr.result).trim() || "Unknown";
            await app._appendListProp("Appearance", txt);
            await app._addBio(run, `Appearance: ${txt}`);
            continue;
        }

        if (ch.type === "social") {
            const amt = Number(ch.amount ?? 0);
            if (!Number.isFinite(amt) || amt === 0) continue;

            const key = "Stats_SocialStatus";
            const props = app.actor.system?.props ?? {};
            const before = Number(props[key] ?? 0);
            const after = Math.max(-2, Math.min(2, before + amt));

            await app.actor.update({ [`system.props.${key}`]: String(after) });

            const reason = ch.reason ? ` (${String(ch.reason)})` : "";
            await app._addBio(run, `Social Status ${before} -> ${after}${reason}`);
            continue;
        }

        if (ch.type === "drive") {
            if (ch.action === "add") {
                await promptAddDrive(app.actor, ch.category);
            }
            if (ch.action === "remove") {
                await promptRemoveDrive(app.actor);
            }
            continue;
        }

        if (ch.type === "language") {
            await app._awardLanguage(run, ch);
            continue;
        }

        if (ch.type === "stat") {
            const steps = Number(ch.steps ?? 1);
            const characteristic = String(ch.characteristic ?? "").trim();
            if (!characteristic || steps === 0) continue;

            const dKey = `Stats_${characteristic}Dice`;
            const mKey = `Stats_${characteristic}Mod`;

            const props = app.actor.system?.props ?? {};
            const beforeDice = Number(props[dKey] ?? 1);
            const beforeMod = Number(props[mKey] ?? 0);
            const before = `${beforeDice}d6+${beforeMod}`;

            const { dice, mod } = await advanceStat(app.actor, characteristic, steps);
            const verb = steps > 0 ? "Improved" : "Reduced";
            await app._addBio(run, `${verb} ${characteristic} (${before} -> ${dice}d6+${mod})`);
            continue;
        }

        if (ch.type === "bio") {
            if (ch.text) await app._addBio(run, ch.text);

            if (ch.roll?.tableUuid) {
                const rr = await app._rollOnce(ch.roll.tableUuid);
                const txt = app.constructor._resultRawJSON(rr.result);
                if (txt) await app._addBio(run, txt);
            }
            continue;
        }

        if (ch.type === "skill") {
            const targetKey = String(ch.targetKey ?? ch.skill ?? "").trim();
            if (!targetKey) {
                await app._addBio(run, "Skill reward skipped: missing targetKey/skill.");
                continue;
            }
            await app._grantSkillToward(run, targetKey, ch.targetLevel, ch.fallback);
            continue;
        }

        if (ch.type === "maneuver") {
            const targetKey = String(ch.targetKey ?? ch.maneuver ?? ch.skill ?? "").trim();
            if (!targetKey) {
                await app._addBio(run, "Maneuver reward skipped: missing targetKey/maneuver.");
                continue;
            }
            await app._grantManeuverToward(run, targetKey, ch.targetLevel, ch.fallback);
            continue;
        }

        if (ch.type === "item") {
            const qty = Number(ch.qty ?? 1);
            const stack = Boolean(ch.stack ?? false);

            if (ch.tableUuid) {
                const rr = await app._rollOnce(ch.tableUuid);
                const spec = app.constructor._resultRawJSON(rr.result).trim();
                const doc = await app._getItemDocFromSpec(spec);

                if (!doc) {
                    await app._addBio(run, `Item reward failed: could not resolve "${spec}"`);
                    continue;
                }

                await app._grantItemToActor(run, doc, qty, { stack });
                continue;
            }

            if (ch.itemUuid || ch.name) {
                const spec = ch.itemUuid ?? ch.name;
                const doc = await app._getItemDocFromSpec(spec);

                if (!doc) {
                    await app._addBio(run, `Item reward failed: could not resolve "${spec}"`);
                    continue;
                }

                await app._grantItemToActor(run, doc, qty, { stack });
                continue;
            }

            await app._addBio(run, "Item reward failed: missing itemUuid/name or tableUuid");
        }
    }
}
