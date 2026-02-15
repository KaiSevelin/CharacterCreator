console.log("CHARGEN.JS LOADED FROM", import.meta.url);

// -------- Optional helpers (safe even if you skip images) --------
function isPlaceholderImg(p) {
    const s = String(p ?? "");
    return !s || s.startsWith("icons/svg/");
}

function resolveImgPath(p) {
    const s = String(p ?? "").trim();
    return s ? foundry.utils.getRoute(s) : "";
}

function normalizeTableKey(name) {
    return String(name ?? "")
        .toLowerCase()
        .replace(/[–—]/g, "-")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}


// ===================== APP =====================
export class SkillTreeChargenApp extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "skilltree-chargen",
            title: "Character Generation",
            template: "modules/chargen1547_v2/templates/chargen.hbs",
            width: 900,
            height: "auto",
            closeOnSubmit: false,
            resizable: true
        });
    }
    static async _requireRollTable(uuid, label) {
        if (!uuid || typeof uuid !== "string") {
            throw new Error(`Missing required RollTable: ${label}`);
        }

        const doc = uuid.includes(".")
            ? await fromUuid(uuid).catch(() => null)
            : game.tables.get(uuid);

        if (!doc || doc.documentName !== "RollTable") {
            throw new Error(`Invalid RollTable for ${label}: ${uuid}`);
        }

        return uuid;
    }

    // ---- NEW: prompt for a name, create an actor, and start chargen ----
    static async open(opts = {}) {
        await this._requireRollTable(opts.startingTable, "Starting Table");

        await this._requireRollTable(
            opts.contactTables?.professionTable,
            "Contact Profession Table"
        );
        await this._requireRollTable(
            opts.contactTables?.regionTable,
            "Contact Region Table"
        );
        await this._requireRollTable(
            opts.contactTables?.connectionTable,
            "Contact Connection Table"
        );

        await this._requireRollTable(opts.bodyTable, "Body Table");
        await this._requireRollTable(opts.miscTable, "Misc Table");
        const name = await this._promptForName();
        if (!name) return;

        const type =
            game.system?.documentTypes?.Actor?.[0] ??
            Object.keys(game.system?.model?.Actor ?? {})[0] ??
            "character";

        const actor = await Actor.create({
            name,
            type,
            ownership: {
                default: 0,
                [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
            }
        });

        const app = new SkillTreeChargenApp(actor);

        const tableUuid =
            opts.startingTable;

        const choices = opts.choices ?? 2;
        const maxRolls = opts.maxRolls ?? 10;

        const contactTables = {
            professionTable: opts.contactTables?.professionTable,
            regionTable: opts.contactTables?.regionTable,
            connectionTable: opts.contactTables?.connectionTable
        };
        const bodyTable = opts.bodyTable;
        const miscTable = opts.miscTable;

        const run = {
            tableUuid,
            choices,
            remainingGlobal: maxRolls,
            bio: [],
            history: [],
            luckyStreak: false,
            contactTables,
            bodyTable,
            miscTable,
            cards: []
        };

        run.cards = await app._rollCards(run);

        await app._setState({
            setup: { tableUuid, choices, maxRolls, contactTables, bodyTable, miscTable },
            run
        });

        app.render(true);
    }
    static async validateTableJSON(tableUuid) {
        const doc = await fromUuid(tableUuid);
        if (!doc) throw new Error(`No document found for UUID: ${tableUuid}`);
        if (doc.documentName !== "RollTable") {
            throw new Error(`UUID is ${doc.documentName}, expected RollTable`);
        }

        const table = doc;
        const bad = [];
        const skipped = [];

        for (const r of table.results.contents) {
            const raw = this._resultRawJSON(r);

            if (!raw) {
                skipped.push({
                    id: r.id,
                    range: r.range,
                    reason: "Empty or non-text result",
                });
                continue;
            }

            try {
                this._parseJSONResultText(raw, table.name);
            } catch (e) {
                bad.push({
                    id: r.id,
                    range: r.range,
                    error: e?.message ?? String(e),
                    raw,
                });
            }
        }

        const report = {
            ok: bad.length === 0,
            tableName: table.name,
            uuid: table.uuid,
            total: table.results.size,
            bad,
            skipped,
        };

        // Console output for devs / GMs
        console.group(`Chargen table validation: ${table.name}`);
        console.log(`Total: ${report.total}`);
        console.log(`Bad JSON: ${bad.length}`);
        if (bad.length) {
            console.table(bad.map(b => ({
                id: b.id,
                range: JSON.stringify(b.range),
                error: b.error,
                rawPreview: b.raw.slice(0, 80),
            })));
        }
        console.groupEnd();

        return report;
    }


    static async _promptForName() {
        return new Promise((resolve) => {
            const content = `
        <form>
          <div class="form-group">
            <label>Character Name</label>
            <input type="text" name="name" placeholder="Enter a name..." autofocus />
          </div>
        </form>
      `;

            new Dialog({
                title: "Create New Character",
                content,
                buttons: {
                    create: {
                        label: "Create",
                        callback: (html) => {
                            const name = String(html.find("input[name='name']").val() ?? "").trim();
                            resolve(name || null);
                        }
                    },
                    cancel: { label: "Cancel", callback: () => resolve(null) }
                },
                default: "create",
                close: () => resolve(null)
            }, { width: 420 }).render(true);
        });
    }

    constructor(actor, options = {}) {
        super({}, options);
        this.actor = actor;
    }

    /* ---------------- State helpers ---------------- */

    _flagPath() { return "flags.chargen1547_v2.chargen"; }

    _getState() {
        return foundry.utils.getProperty(this.actor, this._flagPath()) ?? {
            setup: { tableUuid: "", choices: 2, maxRolls: 10 },
            run: null
        };
    }

    async _setState(next) {
        await this.actor.update({ [this._flagPath()]: next });
    }

    _isSetupMode(state) {
        return !state.run;
    }

    /* ---------------- Foundry helpers ---------------- */

    async _getRollTable(uuidOrId) {
        if (!uuidOrId) return null;
        const ref = String(uuidOrId).trim();

        // UUID-ish
        if (ref.includes(".")) {
            const doc = await fromUuid(ref).catch(() => null);
            if (doc?.documentName === "RollTable") return doc;
        }

        // World table id
        return game.tables.get(ref) ?? null;
    }

    _pickDistinct(arr, n) {
        const pool = arr.slice();
        const out = [];
        for (let i = 0; i < Math.min(n, pool.length); i++) {
            const idx = Math.floor(Math.random() * pool.length);
            out.push(pool.splice(idx, 1)[0]);
        }
        return out;
    }

    _resultRawJSON(result) {
        const d = (result?.description ?? "").trim();
        if (d) return d;

        const t = (result?.text ?? "").trim(); // deprecated fallback
        if (t) return t;

        const n = (result?.name ?? "").trim();
        return n;
    }

    _parseJSONResultText(text, tableName = "RollTable") {
        const rawIn = String(text ?? "").trim();

        // 1) Strip HTML if the description was saved as rich text (<p>...</p>, <br>, etc.)
        //    and decode entities (&quot; etc.) using Foundry's helper.
        let raw = rawIn;

        // If it looks like HTML, convert to plain text
        if (raw.startsWith("<")) {
            const div = document.createElement("div");
            div.innerHTML = raw;
            raw = (div.textContent ?? "").trim();
        }

        // Decode HTML entities if present (safe even if none)
        raw = foundry.utils.unescapeHTML(raw).trim();

        // 2) Sometimes there's leading/trailing junk; try to extract the first JSON object.
        //    This helps if there are stray newlines or formatting around it.
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

        if (!obj?.choice?.title) throw new Error("Missing choice.title");
        if (!Array.isArray(obj.rewards) || !obj.rewards.length) throw new Error("Missing rewards[]");

        const rewards = obj.rewards.map((r, i) => {
            if (!r || typeof r !== "object") throw new Error(`rewards[${i}] must be an object`);
            const rr = foundry.utils.deepClone(r);

            return {
                ...rr,
                weight: Number.isFinite(Number(rr.weight)) ? Number(rr.weight) : 1,
                changes: Array.isArray(rr.changes) ? rr.changes : [],
                next: (rr.next && typeof rr.next === "object")
                    ? {
                        tableUuid: String(rr.next.tableUuid ?? "").trim(),
                        rolls: Number.isFinite(Number(rr.next.rolls)) ? Number(rr.next.rolls) : 0
                    }
                    : null
            };
        });

        return {
            choice: {
                title: String(obj.choice.title),
                text: obj.choice.text != null ? String(obj.choice.text) : "",
                icon: obj.choice.icon != null ? String(obj.choice.icon) : "",
                tags: Array.isArray(obj.choice.tags) ? obj.choice.tags.map(String) : []   // <-- add this
            },
            bio: obj.bio != null ? String(obj.bio) : "",
            rewards
        };
    }


    _pickWeightedReward(rewards) {
        const list = Array.isArray(rewards) ? rewards.filter(r => r && typeof r === "object") : [];
        if (!list.length) return null;

        const weightOf = (r) => {
            const w = Number(r.weight ?? 1);
            return Number.isFinite(w) ? Math.max(0, w) : 0;
        };

        const total = list.reduce((s, r) => s + weightOf(r), 0);
        if (total <= 0) return list[0];

        let roll = Math.random() * total;
        for (const r of list) {
            roll -= weightOf(r);
            if (roll <= 0) return r;
        }
        return list[list.length - 1];
    }

    /* ---------------- Biography helpers ---------------- */

    _getBioLines() {
        return String(this.actor.system?.props?.Biography ?? "")
            .split("\n")
            .map(s => s.trim())
            .filter(Boolean);
    }

    async _appendBiography(lineOrLines) {
        const add = Array.isArray(lineOrLines) ? lineOrLines : [lineOrLines];
        const cur = this._getBioLines();

        for (const line of add) {
            const t = String(line ?? "").trim();
            if (t) cur.push(t);
        }

        await this.actor.update({ "system.props.Biography": cur.join("\n") });
    }

    async _addBio(run, text) {
        if (!text) return;
        const line = String(text);
        run.bio.push(line);
        await this._appendBiography(line);
    }

    /* ---------------- SkillTree hook ---------------- */

    _getPropNumber(key) {
        const raw = this.actor.system?.props?.[key];
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
    }

    async _grantSkillToward(run, targetKey, targetLevel, fallback) {
        const st = globalThis.SkillTree;
        if (!st?.nextStepToward || !st?.NODES) {
            if (fallback?.type === "stat") {
                await advanceStat(this.actor, fallback.characteristic, Number(fallback.steps ?? 1));
            }
            return;
        }

        const step = st.nextStepToward(this.actor, targetKey, targetLevel, st.NODES, null);
        if (step === true) return;
        if (!step?.nodeName) return;
        if (String(step.nodeName).startsWith("Traits_")) return;

        const cur = this._getPropNumber(step.nodeName);
        const next = Math.max(cur, Number(step.nodeLevel ?? 0));

        await this.actor.update({ [`system.props.${step.nodeName}`]: String(next) });
        await this._addBio(run, `Learned ${step.nodeName} ${next}`);
    }

    /* ---------------- Reward helpers ---------------- */

    async _rollOnce(tableUuidOrId) {
        const table = await this._getRollTable(tableUuidOrId);
        if (!table) throw new Error(`RollTable not found: ${tableUuidOrId}`);

        const draw = await table.draw({ displayChat: false });
        const r = draw.results?.[0];
        return { result: r, raw: this._resultRawJSON(r) };
    }

    async _appendListProp(key, value) {
        const raw = String(this.actor.system?.props?.[key] ?? "");
        const list = raw ? raw.split("\n").filter(Boolean) : [];
        list.push(String(value));
        await this.actor.update({ [`system.props.${key}`]: list.join("\n") });
    }

    async _addMoney(amount) {
        const cur = Number(this.actor.system?.props?.Inventory_Money ?? 0);
        const next = cur + Number(amount ?? 0);
        await this.actor.update({ "system.props.Inventory_Money": String(next) });
        return { before: cur, after: next };
    }

    async _applyChanges(run, changes = []) {
        for (const ch of changes) {
            if (!ch || typeof ch !== "object") continue;

            if (ch.type === "money") {
                const { before, after } = await this._addMoney(ch.amount ?? 0);
                await this._addBio(run, `Received ${after - before} silver`);
                continue;
            }
            if (ch.type === "luck") {
                run.luckyStreak = Boolean(ch.on);

                const reason = ch.reason ? ` (${String(ch.reason)})` : "";
                await this._addBio(run, `Lucky streak: ${run.luckyStreak ? "ON" : "OFF"}${reason}`);
                continue;
            }
            if (ch.type === "contact") {
                const p = await this._rollOnce(run.contactTables.professionTable);
                const r = await this._rollOnce(run.contactTables.regionTable);
                const c = await this._rollOnce(run.contactTables.connectionTable);

                const pTxt = p.result?.name ?? p.raw ?? "Unknown";
                const rTxt = r.result?.name ?? r.raw ?? "Unknown";
                const cTxt = c.result?.name ?? c.raw ?? "Unknown";

                const txt = `${pTxt} from ${rTxt} (${cTxt})`;

                await this._appendListProp("Contacts", txt);
                await this._addBio(run, `Gained a contact: ${txt}`);
                continue;
            }

            if (ch.type === "body") {
                const rr = await this._rollOnce(run.bodyTable);
                const txt = rr.result?.name ?? rr.raw ?? "Unknown";
                await this._appendListProp("BodilyChanges", txt);
                await this._addBio(run, `Bodily change: ${txt}`);
                continue;
            }

            if (ch.type === "misc") {
                const rr = await this._rollOnce(run.miscTable);
                const txt = rr.result?.name ?? rr.raw ?? "Unknown";
                await this._addBio(run, `Misc: ${txt}`);
                continue;
            }
            if (ch.type === "social") {
                const amt = Number(ch.amount ?? 0);
                if (!Number.isFinite(amt) || amt === 0) continue;

                const key = "Stats_SocialStatus";
                const props = this.actor.system?.props ?? {};
                const before = Number(props[key] ?? 0);
                const after = Math.max(-2, Math.min(2, before + amt));

                await this.actor.update({ [`system.props.${key}`]: String(after) });

                const reason = ch.reason ? ` (${String(ch.reason)})` : "";
                await this._addBio(run, `Social Status ${before} → ${after}${reason}`);
                continue;
            }

            if (ch.type === "stat") {
                const steps = Number(ch.steps ?? 1);
                const characteristic = String(ch.characteristic ?? "").trim();
                if (!characteristic || steps <= 0) continue;

                const dKey = `Stats_${characteristic}Dice`;
                const mKey = `Stats_${characteristic}Mod`;

                const props = this.actor.system?.props ?? {};
                const beforeDice = Number(props[dKey] ?? 1);
                const beforeMod = Number(props[mKey] ?? 0);
                const before = `${beforeDice}d6+${beforeMod}`;

                const { dice, mod } = await advanceStat(this.actor, characteristic, steps);
                await this._addBio(run, `Improved ${characteristic} (${before} → ${dice}d6+${mod})`);
                continue;
            }

            if (ch.type === "skill") {
                await this._grantSkillToward(run, ch.targetKey, ch.targetLevel, ch.fallback);
            }
        }
    }

    /* ---------------- Flow ---------------- */

    async _rollCards(run) {
        const table = await this._getRollTable(run.tableUuid);
        if (!table) throw new Error(`RollTable not found: ${run.tableUuid}`);

        const pool = table.results.contents.slice();
        const out = [];

        // Helpers
        const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
        const hasStatusTag = (data) => {
            const tags = data?.choice?.tags ?? [];
            return Array.isArray(tags) && tags.some(t => String(t).toLowerCase() === "status");
        };

        const getSocialStatus = () => {
            const raw = this.actor.system?.props?.Stats_SocialStatus;
            const n = Number(raw);
            return clamp(Number.isFinite(n) ? n : 0, -2, 2);
        };

        const statusPassChance = () => {
            const s = getSocialStatus();                 // -2..+2
            const lucky = Boolean(run.luckyStreak);

            // Simple, gentle curve (always possible, never guaranteed):
            // base 55%, +/-12% per status step, +10% if lucky
            const p = 0.55 + (0.12 * s) + (lucky ? 0.10 : 0.0);
            return clamp(p, 0.10, 0.95);
        };

        while (out.length < Math.min(run.choices, table.results.contents.length) && pool.length) {
            const idx = Math.floor(Math.random() * pool.length);
            const r = pool.splice(idx, 1)[0];

            const raw = this._resultRawJSON(r);

            const data = this._parseJSONResultText(raw, table.name);

            // If this is a Status-gated choice, do the extra roll
            if (hasStatusTag(data)) {
                const p = statusPassChance();
                const roll = Math.floor(Math.random() * 100) + 1; // 1..100
                const target = Math.floor(p * 100);

                if (roll > target) {
                    // Log the miss in biography and discard, then continue rolling
                    const s = getSocialStatus();
                    const luckyTxt = run.luckyStreak ? " + Lucky" : "";
                    await this._addBio(
                        run,
                        `Missed: ${data.choice?.title ?? "Unknown"} (Status check failed: rolled ${roll} vs ≤${target}; Social ${s}${luckyTxt})`
                    );
                    continue;
                }
            }

            // Prefer row image, otherwise table image, otherwise empty
            const chosen = !isPlaceholderImg(r.img) ? r.img : table.img;
            const img = resolveImgPath(chosen);

            out.push({
                resultId: r.id,
                rawText: raw,
                img,
                data
            });
        }

        return out;
    }



    /* ---------------- FormApplication ---------------- */

    async getData() {
        const state = this._getState();
        const run = state.run;

        return {
            state: run ?? { remainingGlobal: 0},
            cards: (run?.cards ?? []).map(c => ({
                title: c.data.choice.title,
                text: c.data.choice.text ?? "",
                img: c.img ?? ""
            })),
            bio: run?.bio ?? []
        };
    }


    activateListeners(html) {
        super.activateListeners(html);

        html.find("[data-action='reset']").on("click", () => this._onReset());
        html.find("[data-action='reroll']").on("click", () => this._onReroll());
        html.find("[data-action='finish']").on("click", () => this._onFinish());

        html.on("click", ".chargen-card", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const idx = Number(ev.currentTarget.querySelector(".card-choose")?.dataset.index);
            if (Number.isNaN(idx)) return;
            this._onChoose(idx);
        });

        html.on("click", ".card-choose", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
        });
    }

    async _onReset() {
        const state = this._getState();
        const setup = state.setup ?? {};
        this.close();
        await SkillTreeChargenApp.open({
            startingTable: setup.tableUuid,
            choices: setup.choices,
            maxRolls: setup.maxRolls,
            contactTables: setup.contactTables,
            bodyTable: setup.bodyTable,
            miscTable: setup.miscTable
        });
    }

    async _onReroll() {
        const state = this._getState();
        if (!state.run) return;

        try {
            state.run.cards = await this._rollCards(state.run);
            await this._setState(state);
            this.render(true);
        } catch (e) {
            ui.notifications.error(e.message);
            console.error(e);
        }
    }

    async _onChoose(index) {
        const state = this._getState();
        if (!state.run) return;

        const run = state.run;
        if (run.remainingGlobal <= 0) {
            await this._finishWithSummary(run);
            return;
        }

        const picked = run.cards?.[index];
        if (!picked) return;

        try {
            const data = picked.data;

            await this._addBio(run, `Chose: ${data.choice?.title ?? "Unknown"}`);
            if (data.bio) await this._addBio(run, String(data.bio));

            const rewards = Array.isArray(data.rewards) ? data.rewards : [];
            if (!rewards.length) throw new Error("No rewards defined for this choice.");

            const reward = this._pickWeightedReward(rewards);
            if (!reward) throw new Error("No valid reward could be selected.");

            await this._applyChanges(run, reward.changes ?? []);

            const nextObj =
                (reward?.next?.tableUuid ? reward.next : null) ??
                rewards.find(r => r?.next?.tableUuid)?.next ??
                null;

            const nextUuid = String(nextObj?.tableUuid ?? "").trim();
            const nextRolls = Number(nextObj?.rolls ?? 0);

            run.remainingGlobal = Math.max(0, Number(run.remainingGlobal ?? 0) - 1);

            run.history.push({
                tableUuid: run.tableUuid,
                choiceTitle: data.choice?.title ?? "",
                rewardApplied: reward
            });

            if (!nextUuid) {
                await this._setState({ ...state, run });
                await this._finishWithSummary(run);
                return;
            }

            run.tableUuid = nextUuid;

            run.cards = await this._rollCards(run);

            await this._setState({ ...state, run });
            this.render(true);

        } catch (e) {
            ui.notifications.error(e.message);
            console.error(e);
        }
    }

    async _finishWithSummary(run) {
        const actor = this.actor;
        const bioHtml = (run.bio ?? []).map(s => `<li>${foundry.utils.escapeHTML(String(s))}</li>`).join("");

        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `
        <h3>Character Generation Finished</h3>
        <p><b>${foundry.utils.escapeHTML(actor.name)}</b> biography:</p>
        <ul>${bioHtml}</ul>
      `
        });

        ui.notifications.info("Character generation finished.");
    }

    async _onFinish() {
        const state = this._getState();
        if (!state.run) return;
        await this._finishWithSummary(state.run);
    }
}

/* ---------------- Stat helper ---------------- */

function getNumberProp(props, key, fallback = 0) {
    const v = props?.[key];
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

async function advanceStat(actor, characteristic, steps = 1) {
    const diceKey = `Stats_${characteristic}Dice`;
    const modKey = `Stats_${characteristic}Mod`;

    const props = actor.system?.props ?? {};
    let dice = Math.max(1, getNumberProp(props, diceKey, 1));
    let mod = Math.max(0, getNumberProp(props, modKey, 0));

    for (let i = 0; i < steps; i++) {
        if (mod < 3) mod += 1;
        else { dice += 1; mod = 0; }
    }

    await actor.update({
        [`system.props.${diceKey}`]: String(dice),
        [`system.props.${modKey}`]: String(mod)
    });

    return { dice, mod };
}
