import { promptAddDrive, promptRemoveDrive } from "./drive-prompts.js";
import { PRIMARY_STATS } from "/modules/chargen1547_v2/foundry-primary-stats/stats.js";
import { advanceStoryThread, getStoryLabel } from "./chargen-story.js";
import { getChargenSettings } from "./settings.js";
import {
    applyRewardChanges,
    parseRewardResult,
    pickWeightedEffectRow,
    pickWeightedReward,
    resolveRewardFromEffectTables,
    summarizeRewardChange
} from "./chargen-rewards.js";
console.log("CHARGEN.JS LOADED FROM", import.meta.url);

const UNKNOWN_EXTREME_EXCLUDED_TABLE_REFS = new Set([
    "RollTable.WqxPqlsw4LlVk5mp",
    "RollTable.DeL6AoYlpbZdonNB",
    "birth-horoscope-3d6",
    "birth-humors"
]);

const UNKNOWN_CARD_IMAGE = "media/home/games/1547/Cards/General Unknown.webp";

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

let BASELINE_MIN_ZERO_SKILLS_CACHE = null;


// ===================== APP =====================
export class SkillTreeChargenApp extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "skilltree-chargen",
            title: "The Life",
            template: "modules/chargen1547_v2/templates/chargen.hbs",
            width: 900,
            height: "auto",
            closeOnSubmit: false,
            resizable: true
        });
    }

    get title() {
        const actorName = String(this.actor?.name ?? "").trim();
        return actorName ? `The Life of ${actorName}` : "The Life";
    }
    static async _resolveRollTableRef(uuidOrId) {
        if (!uuidOrId || typeof uuidOrId !== "string") return null;
        const ref = String(uuidOrId).trim();
        if (!ref) return null;

        const doc = ref.includes(".")
            ? await fromUuid(ref).catch(() => null)
            : game.tables.get(ref);

        if (!doc || doc.documentName !== "RollTable") return null;
        return doc;
    }

    static async _resolveItemSpecDoc(spec) {
        const s = String(spec ?? "").trim();
        if (!s) return null;

        if (s.includes(".")) {
            const doc = await fromUuid(s).catch(() => null);
            if (doc?.documentName === "Item") return doc;
        }

        const byName = game.items?.contents?.find(
            i => i.name?.trim().toLowerCase() === s.toLowerCase()
        );
        return byName ?? null;
    }

    static _addIssue(report, level, code, message, meta = {}) {
        const issue = { level, code, message, ...meta };
        if (level === "error") report.errors.push(issue);
        else report.warnings.push(issue);
        return issue;
    }

    static _normalizeSetupTables(opts = {}) {
        const startingTable = String(opts.startingTable ?? "").trim();
        const explicitPreflightOnlyTables = Array.isArray(opts.preflightOnlyTables)
            ? opts.preflightOnlyTables.map(v => String(v ?? "").trim()).filter(Boolean)
            : [];
        const preflightOnlyTables = explicitPreflightOnlyTables.length
            ? explicitPreflightOnlyTables
            : (startingTable === "RollTable.WqxPqlsw4LlVk5mp"
                ? [startingTable, "RollTable.DeL6AoYlpbZdonNB"]
                : []);

        return {
            startingTable,
            preflightOnlyTables,
            contactTables: {
                roleTable: String(opts.contactTables?.roleTable ?? "").trim(),
                flavorTable: String(opts.contactTables?.flavorTable ?? "").trim(),
                toneTable: String(opts.contactTables?.toneTable ?? "").trim(),
                hookTable: String(opts.contactTables?.hookTable ?? "").trim(),
                quirkTable: String(opts.contactTables?.quirkTable ?? "").trim()
            },
            bodyTable: String(opts.bodyTable ?? "").trim(),
            miscTable: String(opts.miscTable ?? "").trim()
        };
    }

    static async validateEnvironment(opts = {}) {
        const setup = SkillTreeChargenApp._normalizeSetupTables(opts);
        const report = {
            ok: false,
            setup,
            checkedAt: new Date().toISOString(),
            errors: [],
            warnings: [],
            requiredTables: [],
            careerValidation: null
        };

        const requiredTables = [
            { key: "startingTable", label: "Starting Table", ref: setup.startingTable },
            { key: "contact.roleTable", label: "Contact Role Table", ref: setup.contactTables.roleTable },
            { key: "contact.flavorTable", label: "Contact Flavor Table", ref: setup.contactTables.flavorTable },
            { key: "contact.toneTable", label: "Contact Tone Table", ref: setup.contactTables.toneTable },
            { key: "contact.hookTable", label: "Contact Hook Table", ref: setup.contactTables.hookTable },
            { key: "contact.quirkTable", label: "Contact Quirk Table", ref: setup.contactTables.quirkTable },
            { key: "bodyTable", label: "Body Table", ref: setup.bodyTable },
            { key: "miscTable", label: "Misc Table", ref: setup.miscTable }
        ];

        for (const req of requiredTables) {
            if (!req.ref) {
                SkillTreeChargenApp._addIssue(
                    report,
                    "error",
                    "missing-table-ref",
                    `Missing required RollTable reference for "${req.label}".`,
                    { tableKey: req.key }
                );
                continue;
            }

            const doc = await SkillTreeChargenApp._resolveRollTableRef(req.ref);
            if (!doc) {
                SkillTreeChargenApp._addIssue(
                    report,
                    "error",
                    "invalid-table-ref",
                    `Invalid RollTable reference for "${req.label}": ${req.ref}`,
                    { tableKey: req.key, ref: req.ref }
                );
                continue;
            }

            report.requiredTables.push({
                tableKey: req.key,
                label: req.label,
                ref: req.ref,
                uuid: doc.uuid,
                name: doc.name
            });
        }

        const helper = globalThis.SkillTree;
        const helperModule = game.modules?.get("skilltreehelper");
        if (!helperModule?.active) {
            SkillTreeChargenApp._addIssue(
                report,
                "error",
                "required-module-inactive",
                "Required module \"skilltreehelper\" is not active."
            );
        }

        if (!helper) {
            SkillTreeChargenApp._addIssue(
                report,
                "warning",
                "skilltree-missing",
                "globalThis.SkillTree is not available. Skill rewards may fail."
            );
        } else {
            if (typeof helper.nextStepToward !== "function") {
                SkillTreeChargenApp._addIssue(
                    report,
                    "warning",
                    "skilltree-api-missing-nextstep",
                    "SkillTree.nextStepToward is missing. Skill progression rewards may fail."
                );
            }
            if (!helper.NODES) {
                SkillTreeChargenApp._addIssue(
                    report,
                    "warning",
                    "skilltree-api-missing-nodes",
                    "SkillTree.NODES is missing. Skill progression rewards may fail."
                );
            }
            if (typeof helper.grantFirstAvailableNode !== "function") {
                SkillTreeChargenApp._addIssue(
                    report,
                    "warning",
                    "skilltree-api-missing-first-available",
                    "SkillTree.grantFirstAvailableNode is missing. Prerequisite fallback for skills and maneuvers may fail."
                );
            }
        }

        if (
            setup.startingTable === "RollTable.WqxPqlsw4LlVk5mp" &&
            setup.preflightOnlyTables.length === 2 &&
            setup.preflightOnlyTables.includes("RollTable.DeL6AoYlpbZdonNB")
        ) {
            report.careerValidation = {
                ok: true,
                startingTable: setup.startingTable,
                checkedAt: new Date().toISOString(),
                visited: [],
                edges: [],
                auxiliaryRefs: [],
                terminalResults: [],
                errors: [],
                warnings: []
            };

            for (const tableRef of setup.preflightOnlyTables) {
                const tableDoc = await SkillTreeChargenApp._resolveRollTableRef(tableRef);
                if (!tableDoc) {
                    SkillTreeChargenApp._addIssue(
                        report,
                        "error",
                        "invalid-startup-preflight-table",
                        `Preflight table is invalid: ${tableRef}`,
                        { tableRef }
                    );
                    continue;
                }

                report.careerValidation.visited.push({ uuid: tableDoc.uuid, name: tableDoc.name });
                const tableValidation = await SkillTreeChargenApp.validateTableJSON(tableDoc.uuid);
                if (!tableValidation.ok) {
                    for (const bad of tableValidation.bad) {
                        SkillTreeChargenApp._addIssue(
                            report,
                            "error",
                            "career-table-schema-invalid",
                            `Invalid JSON schema in table "${tableDoc.name}" (${tableDoc.uuid}).`,
                            {
                                tableUuid: tableDoc.uuid,
                                tableName: tableDoc.name,
                                resultId: bad.id,
                                range: bad.range,
                                detail: bad.error
                            }
                        );
                    }
                }
            }

            report.careerValidation.ok = report.errors.length === 0;
            report.ok = report.errors.length === 0;
            return report;
        }

        if (setup.startingTable) {
            report.careerValidation = await SkillTreeChargenApp.validateCareerTableGraph({
                startingTable: setup.startingTable,
                preflightOnlyTables: setup.preflightOnlyTables
            });

            for (const e of report.careerValidation.errors) {
                report.errors.push(e);
            }
            for (const w of report.careerValidation.warnings) {
                report.warnings.push(w);
            }
        }

        report.ok = report.errors.length === 0;
        return report;
    }

    // ---- NEW: prompt for a name, create an actor, and start chargen ----
    static async open(opts = {}) {
        const settings = getChargenSettings();
        const mergedOpts = {
            ...opts,
            startingTable: String(opts.startingTable ?? "").trim() || settings.startingTable
        };

        const preflight = await this.validateEnvironment(mergedOpts);
        if (!preflight.ok) {
            const first = preflight.errors[0]?.message ?? "Character creator environment validation failed.";
            throw new Error(first);
        }

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
       // Run once per actor at the start of chargen
        const startingTable =
            mergedOpts.startingTable;

        const choices = mergedOpts.choices ?? 2;
        const maxRolls = mergedOpts.maxRolls ?? 10;

        const contactTables = {
            roleTable: mergedOpts.contactTables?.roleTable,
            flavorTable: mergedOpts.contactTables?.flavorTable,
            toneTable: mergedOpts.contactTables?.toneTable,
            hookTable: mergedOpts.contactTables?.hookTable,
            quirkTable: mergedOpts.contactTables?.quirkTable
        };
        const bodyTable = mergedOpts.bodyTable;
        const miscTable = mergedOpts.miscTable;

        const run = {
            startingTable,
            tableUuid: startingTable,
            choices,
            remainingGlobal: maxRolls,
            bio: [],
            history: [],
            luckyStreak: false,
            contactTables,
            bodyTable,
            miscTable,
            cards: [],
            story: {
                familySuspended: false,
                active: null,
                phase: null,
                transitionedToSelf: false
            }
        };
        if (!actor.getFlag("world", "baselineStatsApplied")) {
            const stats = ["Strength", "Stamina", "Dexterity", "Faith", "Charisma", "Intelligence"];

            for (const s of stats) {
                await advanceStat(actor, s, 1); // +1 step: 1d6+0 → 1d6+1
            }

            await actor.setFlag("world", "baselineStatsApplied", true);
            await app._addBio(run, "Baseline: all stats increased by 1 step (starting package).");
        }
        if (!actor.getFlag("world", "baselineMinZeroSkillsApplied")) {
            const baselineSkills = await app._getBaselineMinZeroSkills();
            for (const skillUuid of baselineSkills) {
                await app._grantSkillToward(run, skillUuid, 0, null, { silent: true });
            }

            await actor.setFlag("world", "baselineMinZeroSkillsApplied", true);
            await app._addBio(run, `Baseline: granted ${baselineSkills.length} skills at level 0 where minLevel is 0.`);
        }
        run.cards = await app._rollCards(run);

        await app._setState({
            setup: { startingTable, choices, maxRolls, contactTables, bodyTable, miscTable },
            run
        });

        app.render(true);
    }

    static async validateTablesInFolder(folderUuid, { recursive = true } = {}) {
        const folder = await fromUuid(folderUuid);
        if (!folder) throw new Error(`No document found for UUID: ${folderUuid}`);

        // Folder documents are "Folder"
        if (folder.documentName !== "Folder") {
            throw new Error(`UUID is ${folder.documentName}, expected Folder`);
        }

        // Make sure this folder is intended for RollTables (Foundry folders can be typed)
        // Some setups may have folder.type undefined; handle permissively.
        if (folder.type && folder.type !== "RollTable") {
            console.warn(`Folder type is "${folder.type}", not "RollTable". Validating tables anyway.`);
        }

        // Collect folder ids (optionally recursive)
        const folderIds = new Set([folder.id]);

        if (recursive) {
            // Foundry stores world folders in game.folders; iterate to gather descendants
            let added = true;
            while (added) {
                added = false;
                for (const f of game.folders.contents) {
                    if (f.type !== "RollTable") continue; // only follow RollTable folder trees
                    if (f.folder && folderIds.has(f.folder.id) && !folderIds.has(f.id)) {
                        folderIds.add(f.id);
                        added = true;
                    }
                }
            }
        }

        // All world RollTables (not compendiums) in those folders
        const tables = game.tables.contents.filter(t => t.folder && folderIds.has(t.folder.id));

        const perTable = [];
        for (const t of tables) {
            try {
                const rep = await SkillTreeChargenApp.validateTableJSON(t.uuid);
                perTable.push(rep);
            } catch (e) {
                perTable.push({
                    ok: false,
                    tableName: t.name,
                    uuid: t.uuid,
                    total: t.results?.size ?? 0,
                    bad: [{ id: "(table)", range: null, error: e?.message ?? String(e), raw: "" }],
                    skipped: []
                });
            }
        }

        // Summary
        const summary = {
            ok: perTable.every(r => r.ok),
            folderName: folder.name,
            folderUuid: folder.uuid,
            recursive,
            tableCount: perTable.length,
            totalResults: perTable.reduce((a, r) => a + (r.total ?? 0), 0),
            badTables: perTable.filter(r => !r.ok).length,
            badResults: perTable.reduce((a, r) => a + (r.bad?.length ?? 0), 0),
            reports: perTable
        };

        // Console output
        console.group(`Chargen folder validation: ${folder.name} (${perTable.length} tables)`);
        console.log(`Recursive: ${recursive}`);
        console.log(`Bad tables: ${summary.badTables}`);
        console.log(`Bad results: ${summary.badResults}`);

        if (summary.badTables > 0) {
            console.table(
                perTable
                    .filter(r => !r.ok)
                    .map(r => ({
                        tableName: r.tableName,
                        uuid: r.uuid,
                        total: r.total,
                        badResults: r.bad?.length ?? 0
                    }))
            );
        }
        console.groupEnd();

        return summary;
    }
    static VALID_STATS = new Set(PRIMARY_STATS.map(String));

    static CHANGE_TYPES = new Set([
        "stat",
        "skill",
        "maneuver",
        "money",
        "luck",
        "contact",
        "body",
        "social",
        "drive",
        "bio",
        "item",
        "language"
    ]);

    static _isObject(v) {
        return v && typeof v === "object" && !Array.isArray(v);
    }

    static _tableUsesUnknownExtremeReveal(table) {
        if (!table) return false;

        const refs = [
            String(table.uuid ?? "").trim(),
            String(table.id ?? "").trim(),
            normalizeTableKey(table.name)
        ].filter(Boolean);

        return !refs.some(ref => UNKNOWN_EXTREME_EXCLUDED_TABLE_REFS.has(ref));
    }

    static _resultHasExtremeUnknownReveal(result) {
        const range = Array.isArray(result?.range) ? result.range : [];
        if (range.length < 2) return false;

        const [min, max] = range.map(v => Number(v));
        if (!Number.isFinite(min) || !Number.isFinite(max)) return false;

        return (min <= 3 && max >= 3) || (min <= 18 && max >= 18);
    }

    static _isFiniteNumber(v) {
        const n = Number(v);
        return Number.isFinite(n);
    }

    static _requireString(v, msg) {
        if (typeof v !== "string" || !v.trim()) {
            throw new Error(msg);
        }
    }

    static _requireFiniteNumber(v, msg) {
        if (!SkillTreeChargenApp._isFiniteNumber(v)) {
            throw new Error(msg);
        }
    }

    static _validateChangeSchema(ch, tableName, rewardIdx, changeIdx) {
        if (!SkillTreeChargenApp._isObject(ch)) {
            throw new Error(`rewards[${rewardIdx}].changes[${changeIdx}] must be an object in "${tableName}".`);
        }

        const type = String(ch.type ?? "").trim();
        if (!SkillTreeChargenApp.CHANGE_TYPES.has(type)) {
            throw new Error(`Unknown change type "${type}" in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`);
        }

        if (type === "stat") {
            SkillTreeChargenApp._requireString(
                ch.characteristic,
                `Stat change requires "characteristic" in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`
            );
            if (!SkillTreeChargenApp.VALID_STATS.has(String(ch.characteristic).trim())) {
                throw new Error(`Invalid stat "${ch.characteristic}" in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`);
            }
            SkillTreeChargenApp._requireFiniteNumber(
                ch.steps,
                `Stat change requires numeric "steps" in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`
            );
            return;
        }

        if (type === "skill" || type === "maneuver") {
            const targetKey = String(ch.targetKey ?? ch.skill ?? ch.maneuver ?? "").trim();
            if (!targetKey) {
                throw new Error(
                    `${type === "maneuver" ? "Maneuver" : "Skill"} change requires "targetKey" in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`
                );
            }
            if (ch.targetLevel != null) {
                SkillTreeChargenApp._requireFiniteNumber(
                    ch.targetLevel,
                    `${type === "maneuver" ? "Maneuver" : "Skill"} change "targetLevel" must be numeric in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`
                );
            }
            return;
        }

        if (type === "money") {
            const hasAmount = ch.amount != null;
            const hasFormula = ch.formula != null && String(ch.formula).trim() !== "";
            if (!hasAmount && !hasFormula) {
                throw new Error(`Money change requires "amount" or "formula" in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`);
            }
            if (hasAmount) {
                SkillTreeChargenApp._requireFiniteNumber(
                    ch.amount,
                    `Money change "amount" must be numeric in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`
                );
            }
            if (hasFormula) {
                SkillTreeChargenApp._requireString(
                    ch.formula,
                    `Money change "formula" must be a string in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`
                );
            }
            return;
        }

        if (type === "luck") {
            if (typeof ch.on !== "boolean") {
                throw new Error(`Luck change requires boolean "on" in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`);
            }
            return;
        }

        if (type === "contact" || type === "body") {
            return;
        }

        if (type === "social") {
            SkillTreeChargenApp._requireFiniteNumber(
                ch.amount,
                `Social change requires numeric "amount" in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`
            );
            return;
        }

        if (type === "drive") {
            const action = String(ch.action ?? "").trim();
            if (action !== "add" && action !== "remove") {
                throw new Error(`Drive change requires "action" of "add" or "remove" in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`);
            }
            if (action === "add") {
                SkillTreeChargenApp._requireString(
                    ch.category,
                    `Drive change with action "add" requires "category" in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`
                );
            }
            return;
        }

        if (type === "bio") {
            const hasText = ch.text != null && String(ch.text).trim() !== "";
            const hasRoll = SkillTreeChargenApp._isObject(ch.roll) && String(ch.roll.tableUuid ?? "").trim() !== "";
            if (!hasText && !hasRoll) {
                throw new Error(`Bio change requires "text" and/or "roll.tableUuid" in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`);
            }
            return;
        }

        if (type === "item") {
            const hasItemUuid = ch.itemUuid != null && String(ch.itemUuid).trim() !== "";
            const hasName = ch.name != null && String(ch.name).trim() !== "";
            const hasTableUuid = ch.tableUuid != null && String(ch.tableUuid).trim() !== "";

            if (!hasItemUuid && !hasName && !hasTableUuid) {
                throw new Error(`Item change requires one of "itemUuid", "name", or "tableUuid" in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`);
            }

            if (ch.qty != null) {
                SkillTreeChargenApp._requireFiniteNumber(
                    ch.qty,
                    `Item change "qty" must be numeric in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`
                );
            }
            return;
        }

        if (type === "language") {
            if (ch.tableKey != null && typeof ch.tableKey !== "string") {
                throw new Error(`Language change "tableKey" must be a string in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`);
            }
        }
    }

    static _validateParsedResultSchema(parsed, tableName) {
        if (!SkillTreeChargenApp._isObject(parsed)) {
            throw new Error(`Parsed result must be an object in "${tableName}".`);
        }

        if (!SkillTreeChargenApp._isObject(parsed.choice)) {
            throw new Error(`Missing "choice" object in "${tableName}".`);
        }

        SkillTreeChargenApp._requireString(parsed.choice.title, `Missing choice.title in "${tableName}".`);
        if (parsed.choice.text != null && typeof parsed.choice.text !== "string") {
            throw new Error(`choice.text must be a string in "${tableName}".`);
        }
        if (parsed.choice.icon != null && typeof parsed.choice.icon !== "string") {
            throw new Error(`choice.icon must be a string in "${tableName}".`);
        }
        if (parsed.choice.tags != null && !Array.isArray(parsed.choice.tags)) {
            throw new Error(`choice.tags must be an array in "${tableName}".`);
        }

        if (parsed.bio != null && typeof parsed.bio !== "string") {
            throw new Error(`bio must be a string in "${tableName}".`);
        }

        const hasRewards = Array.isArray(parsed.rewards) && parsed.rewards.length > 0;
        const hasEffectTables = Array.isArray(parsed.effectTables) && parsed.effectTables.length > 0;
        if (!hasRewards && !hasEffectTables) {
            throw new Error(`Missing rewards[] or effectTables[] in "${tableName}".`);
        }

        if (hasRewards) {
            parsed.rewards.forEach((rw, rewardIdx) => {
                if (!SkillTreeChargenApp._isObject(rw)) {
                    throw new Error(`rewards[${rewardIdx}] must be an object in "${tableName}".`);
                }

                if (!Array.isArray(rw.changes)) {
                    throw new Error(`rewards[${rewardIdx}].changes must be an array in "${tableName}".`);
                }

                if (rw.weight != null && !SkillTreeChargenApp._isFiniteNumber(rw.weight)) {
                    throw new Error(`rewards[${rewardIdx}].weight must be numeric in "${tableName}".`);
                }

                if (rw.next != null) {
                    if (!SkillTreeChargenApp._isObject(rw.next)) {
                        throw new Error(`rewards[${rewardIdx}].next must be an object in "${tableName}".`);
                    }
                    SkillTreeChargenApp._requireString(
                        rw.next.tableUuid,
                        `rewards[${rewardIdx}].next.tableUuid must be a non-empty string in "${tableName}".`
                    );
                }

                rw.changes.forEach((ch, changeIdx) => {
                    SkillTreeChargenApp._validateChangeSchema(ch, tableName, rewardIdx, changeIdx);
                });
            });
        }

        if (hasEffectTables) {
            parsed.effectTables.forEach((tbl, tableIdx) => {
                if (!SkillTreeChargenApp._isObject(tbl)) {
                    throw new Error(`effectTables[${tableIdx}] must be an object in "${tableName}".`);
                }
                if (!Array.isArray(tbl.rows) || tbl.rows.length === 0) {
                    throw new Error(`effectTables[${tableIdx}].rows must be a non-empty array in "${tableName}".`);
                }
                tbl.rows.forEach((row, rowIdx) => {
                    if (!SkillTreeChargenApp._isObject(row)) {
                        throw new Error(`effectTables[${tableIdx}].rows[${rowIdx}] must be an object in "${tableName}".`);
                    }
                    SkillTreeChargenApp._requireFiniteNumber(
                        row.weight,
                        `effectTables[${tableIdx}].rows[${rowIdx}].weight must be numeric in "${tableName}".`
                    );
                    if (row.next != null) {
                        if (!SkillTreeChargenApp._isObject(row.next)) {
                            throw new Error(`effectTables[${tableIdx}].rows[${rowIdx}].next must be an object in "${tableName}".`);
                        }
                        SkillTreeChargenApp._requireString(
                            row.next.tableUuid,
                            `effectTables[${tableIdx}].rows[${rowIdx}].next.tableUuid must be a non-empty string in "${tableName}".`
                        );
                    }
                    if (row.change != null) {
                        SkillTreeChargenApp._validateChangeSchema(
                            row.change,
                            tableName,
                            tableIdx,
                            rowIdx
                        );
                    }
                });
            });
        }
    }

    static _sourceLabel({ rewardIdx = null, changeIdx = null, tableIdx = null, rowIdx = null } = {}) {
        if (tableIdx != null && rowIdx != null) return `effectTables[${tableIdx}].rows[${rowIdx}]`;
        if (rewardIdx != null && changeIdx != null) return `rewards[${rewardIdx}].changes[${changeIdx}]`;
        if (rewardIdx != null) return `rewards[${rewardIdx}]`;
        return "result";
    }

    static async _validateParsedResultReferences(parsed, tableName) {
        const errors = [];
        const pushError = (message, meta = {}) => errors.push({ message, ...meta });

        if (Array.isArray(parsed.effectTables)) {
            for (let tableIdx = 0; tableIdx < parsed.effectTables.length; tableIdx++) {
                const effectTable = parsed.effectTables[tableIdx];
                const rows = Array.isArray(effectTable?.rows) ? effectTable.rows : [];
                const totalWeight = rows.reduce((sum, row) => sum + Math.max(0, Number(row?.weight ?? 0)), 0);
                if (totalWeight !== 6) {
                    pushError(
                        `effectTables[${tableIdx}] in "${tableName}" must have total weight 6; got ${totalWeight}.`,
                        { code: "effect-table-weight-sum", tableIdx, totalWeight }
                    );
                }

                for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                    const row = rows[rowIdx];
                    const source = SkillTreeChargenApp._sourceLabel({ tableIdx, rowIdx });

                    const nextRef = String(row?.next?.tableUuid ?? "").trim();
                    if (nextRef) {
                        const nextDoc = await SkillTreeChargenApp._resolveRollTableRef(nextRef);
                        if (!nextDoc) {
                            pushError(
                                `${source}.next.tableUuid references missing RollTable "${nextRef}" in "${tableName}".`,
                                { code: "missing-next-rolltable", tableIdx, rowIdx, ref: nextRef }
                            );
                        }
                    }

                    const ch = row?.change;
                    if (!ch || typeof ch !== "object") continue;

                    if (ch.type === "bio") {
                        const bioRef = String(ch.roll?.tableUuid ?? "").trim();
                        if (bioRef) {
                            const bioDoc = await SkillTreeChargenApp._resolveRollTableRef(bioRef);
                            if (!bioDoc) {
                                pushError(
                                    `${source}.change.roll.tableUuid references missing RollTable "${bioRef}" in "${tableName}".`,
                                    { code: "missing-bio-rolltable", tableIdx, rowIdx, ref: bioRef }
                                );
                            }
                        }
                    }

                    if (ch.type === "item") {
                        const itemTableRef = String(ch.tableUuid ?? "").trim();
                        if (itemTableRef) {
                            const itemTableDoc = await SkillTreeChargenApp._resolveRollTableRef(itemTableRef);
                            if (!itemTableDoc) {
                                pushError(
                                    `${source}.change.tableUuid references missing RollTable "${itemTableRef}" in "${tableName}".`,
                                    { code: "missing-item-rolltable", tableIdx, rowIdx, ref: itemTableRef }
                                );
                            }
                        }

                        const itemRef = String(ch.itemUuid ?? "").trim();
                        if (itemRef) {
                            const itemDoc = await SkillTreeChargenApp._resolveItemSpecDoc(itemRef);
                            if (!itemDoc) {
                                pushError(
                                    `${source}.change.itemUuid references missing Item "${itemRef}" in "${tableName}".`,
                                    { code: "missing-item-uuid", tableIdx, rowIdx, ref: itemRef }
                                );
                            }
                        }

                        const itemName = String(ch.name ?? "").trim();
                        if (itemName) {
                            const itemDoc = await SkillTreeChargenApp._resolveItemSpecDoc(itemName);
                            if (!itemDoc) {
                                pushError(
                                    `${source}.change.name references missing Item "${itemName}" in "${tableName}".`,
                                    { code: "missing-item-name", tableIdx, rowIdx, ref: itemName }
                                );
                            }
                        }
                    }
                }
            }
        }

        if (Array.isArray(parsed.rewards)) {
            for (let rewardIdx = 0; rewardIdx < parsed.rewards.length; rewardIdx++) {
                const reward = parsed.rewards[rewardIdx];
                const rewardSource = SkillTreeChargenApp._sourceLabel({ rewardIdx });
                const nextRef = String(reward?.next?.tableUuid ?? "").trim();
                if (nextRef) {
                    const nextDoc = await SkillTreeChargenApp._resolveRollTableRef(nextRef);
                    if (!nextDoc) {
                        pushError(
                            `${rewardSource}.next.tableUuid references missing RollTable "${nextRef}" in "${tableName}".`,
                            { code: "missing-next-rolltable", rewardIdx, ref: nextRef }
                        );
                    }
                }

                const changes = Array.isArray(reward?.changes) ? reward.changes : [];
                for (let changeIdx = 0; changeIdx < changes.length; changeIdx++) {
                    const ch = changes[changeIdx];
                    if (!ch || typeof ch !== "object") continue;
                    const source = SkillTreeChargenApp._sourceLabel({ rewardIdx, changeIdx });

                    if (ch.type === "bio") {
                        const bioRef = String(ch.roll?.tableUuid ?? "").trim();
                        if (bioRef) {
                            const bioDoc = await SkillTreeChargenApp._resolveRollTableRef(bioRef);
                            if (!bioDoc) {
                                pushError(
                                    `${source}.roll.tableUuid references missing RollTable "${bioRef}" in "${tableName}".`,
                                    { code: "missing-bio-rolltable", rewardIdx, changeIdx, ref: bioRef }
                                );
                            }
                        }
                    }

                    if (ch.type === "item") {
                        const itemTableRef = String(ch.tableUuid ?? "").trim();
                        if (itemTableRef) {
                            const itemTableDoc = await SkillTreeChargenApp._resolveRollTableRef(itemTableRef);
                            if (!itemTableDoc) {
                                pushError(
                                    `${source}.tableUuid references missing RollTable "${itemTableRef}" in "${tableName}".`,
                                    { code: "missing-item-rolltable", rewardIdx, changeIdx, ref: itemTableRef }
                                );
                            }
                        }

                        const itemRef = String(ch.itemUuid ?? "").trim();
                        if (itemRef) {
                            const itemDoc = await SkillTreeChargenApp._resolveItemSpecDoc(itemRef);
                            if (!itemDoc) {
                                pushError(
                                    `${source}.itemUuid references missing Item "${itemRef}" in "${tableName}".`,
                                    { code: "missing-item-uuid", rewardIdx, changeIdx, ref: itemRef }
                                );
                            }
                        }

                        const itemName = String(ch.name ?? "").trim();
                        if (itemName) {
                            const itemDoc = await SkillTreeChargenApp._resolveItemSpecDoc(itemName);
                            if (!itemDoc) {
                                pushError(
                                    `${source}.name references missing Item "${itemName}" in "${tableName}".`,
                                    { code: "missing-item-name", rewardIdx, changeIdx, ref: itemName }
                                );
                            }
                        }
                    }
                }
            }
        }

        return errors;
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
        const warnings = [];

        for (const r of table.results.contents) {
            const raw = SkillTreeChargenApp._resultRawJSON(r);
            const linkedItem = await SkillTreeChargenApp._resolveItemFromRollResult(r);

            if (!raw && !linkedItem) {
                skipped.push({
                    id: r.id,
                    range: r.range,
                    reason: "Empty or non-text result",
                });
                continue;
            }

            try {
                const parsed = await SkillTreeChargenApp.parseRollTableResult(r, table.name);
                SkillTreeChargenApp._validateParsedResultSchema(parsed, table.name);
                const semanticErrors = await SkillTreeChargenApp._validateParsedResultReferences(parsed, table.name);
                for (const err of semanticErrors) {
                    bad.push({
                        id: r.id,
                        range: r.range,
                        error: err.message,
                        code: err.code ?? "semantic-validation-error",
                        raw,
                    });
                }
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
            warnings,
        };

        // Console output for devs / GMs
        console.group(`Chargen table validation: ${table.name}`);
        console.log(`Total: ${report.total}`);
        console.log(`Errors: ${bad.length}`);
        if (bad.length) {
            console.table(bad.map(b => ({
                id: b.id,
                range: JSON.stringify(b.range),
                code: b.code ?? "parse-error",
                error: b.error,
                rawPreview: String(b.raw ?? "").slice(0, 80),
            })));
        }
        console.groupEnd();

        return report;
    }

    static async validateCareerTableGraph({ startingTable, preflightOnlyTables = [] }) {
        const report = {
            ok: false,
            startingTable,
            checkedAt: new Date().toISOString(),
            visited: [],
            edges: [],
            auxiliaryRefs: [],
            terminalResults: [],
            errors: [],
            warnings: []
        };

        const startDoc = await SkillTreeChargenApp._resolveRollTableRef(startingTable);
        if (!startDoc) {
            SkillTreeChargenApp._addIssue(
                report,
                "error",
                "invalid-starting-table",
                `Starting table is invalid: ${startingTable}`,
                { tableRef: startingTable }
            );
            report.ok = false;
            return report;
        }

        const queue = [startDoc];
        const seen = new Set();
        const allowedRefs = Array.isArray(preflightOnlyTables)
            ? preflightOnlyTables.map(v => String(v ?? "").trim()).filter(Boolean)
            : [];
        const allowedUuids = new Set();

        for (const ref of allowedRefs) {
            const doc = await SkillTreeChargenApp._resolveRollTableRef(ref).catch(() => null);
            if (doc?.uuid) allowedUuids.add(doc.uuid);
            else if (ref.startsWith("RollTable.")) allowedUuids.add(ref);
        }
        if (allowedUuids.size) allowedUuids.add(startDoc.uuid);

        while (queue.length) {
            const table = queue.shift();
            if (!table || seen.has(table.uuid)) continue;
            if (allowedUuids.size && !allowedUuids.has(table.uuid)) continue;
            seen.add(table.uuid);

            report.visited.push({ uuid: table.uuid, name: table.name });

            const tableValidation = await SkillTreeChargenApp.validateTableJSON(table.uuid);
            if (!tableValidation.ok) {
                for (const bad of tableValidation.bad) {
                    SkillTreeChargenApp._addIssue(
                        report,
                        "error",
                        "career-table-schema-invalid",
                        `Invalid JSON schema in table "${table.name}" (${table.uuid}).`,
                        {
                            tableUuid: table.uuid,
                            tableName: table.name,
                            resultId: bad.id,
                            range: bad.range,
                            detail: bad.error
                        }
                    );
                }
                continue;
            }

            for (const r of table.results.contents) {
                let parsed;
                try {
                    parsed = await SkillTreeChargenApp.parseRollTableResult(r, table.name);
                } catch (_e) {
                    // validateTableJSON already recorded these, so skip duplicate messages.
                    continue;
                }

                const nextRefs = [];
                const rewardSources = parsed.effectTables?.length
                    ? parsed.effectTables.flatMap(tbl => tbl.rows ?? [])
                    : (parsed.rewards ?? []);
                for (const reward of rewardSources) {
                    const nextRef = String(reward?.next?.tableUuid ?? "").trim();
                    if (nextRef) nextRefs.push(nextRef);
                }

                if (nextRefs.length === 0) {
                    report.terminalResults.push({
                        tableUuid: table.uuid,
                        tableName: table.name,
                        resultId: r.id,
                        range: r.range,
                        title: parsed.choice?.title ?? ""
                    });
                    continue;
                }

                for (const nextRef of nextRefs) {
                    const nextDoc = await SkillTreeChargenApp._resolveRollTableRef(nextRef);
                    if (!nextDoc) {
                        SkillTreeChargenApp._addIssue(
                            report,
                            "error",
                            "invalid-next-table-ref",
                            `Invalid next.tableUuid "${nextRef}" from "${table.name}" (${table.uuid}).`,
                            {
                                tableUuid: table.uuid,
                                tableName: table.name,
                                resultId: r.id,
                                range: r.range,
                                nextRef
                            }
                        );
                        continue;
                    }

                    report.edges.push({
                        fromUuid: table.uuid,
                        fromName: table.name,
                        resultId: r.id,
                        toUuid: nextDoc.uuid,
                        toName: nextDoc.name
                    });

                    if (!allowedUuids.size || allowedUuids.has(nextDoc.uuid)) {
                        if (!seen.has(nextDoc.uuid)) queue.push(nextDoc);
                    }
                }

                const changeSources = parsed.effectTables?.length
                    ? parsed.effectTables.flatMap(tbl => (tbl.rows ?? []).map(rw => rw?.change).filter(Boolean))
                    : (parsed.rewards ?? []).flatMap(reward => reward?.changes ?? []);
                for (const ch of changeSources) {
                        if (!ch || typeof ch !== "object") continue;

                        if (ch.type === "bio") {
                            const bioRollRef = String(ch.roll?.tableUuid ?? "").trim();
                            if (!bioRollRef) continue;
                            const bioDoc = await SkillTreeChargenApp._resolveRollTableRef(bioRollRef);
                            if (!bioDoc) {
                                SkillTreeChargenApp._addIssue(
                                    report,
                                    "error",
                                    "invalid-bio-roll-table-ref",
                                    `Invalid bio.roll.tableUuid "${bioRollRef}" from "${table.name}" (${table.uuid}).`,
                                    {
                                        tableUuid: table.uuid,
                                        tableName: table.name,
                                        resultId: r.id,
                                        range: r.range,
                                        ref: bioRollRef
                                    }
                                );
                            } else {
                                report.auxiliaryRefs.push({
                                    sourceType: "bio.roll.tableUuid",
                                    fromUuid: table.uuid,
                                    fromName: table.name,
                                    resultId: r.id,
                                    toUuid: bioDoc.uuid,
                                    toName: bioDoc.name
                                });
                            }
                        }

                        if (ch.type === "item") {
                            const itemRollRef = String(ch.tableUuid ?? "").trim();
                            if (!itemRollRef) continue;
                            const itemDoc = await SkillTreeChargenApp._resolveRollTableRef(itemRollRef);
                            if (!itemDoc) {
                                SkillTreeChargenApp._addIssue(
                                    report,
                                    "error",
                                    "invalid-item-roll-table-ref",
                                    `Invalid item tableUuid "${itemRollRef}" from "${table.name}" (${table.uuid}).`,
                                    {
                                        tableUuid: table.uuid,
                                        tableName: table.name,
                                        resultId: r.id,
                                        range: r.range,
                                        ref: itemRollRef
                                    }
                                );
                            } else {
                                report.auxiliaryRefs.push({
                                    sourceType: "item.tableUuid",
                                    fromUuid: table.uuid,
                                    fromName: table.name,
                                    resultId: r.id,
                                    toUuid: itemDoc.uuid,
                                    toName: itemDoc.name
                                });
                            }
                        }
                }
            }
        }

        report.ok = report.errors.length === 0;
        return report;
    }

    static async classifyRollTable(tableUuidOrId, { mark = false } = {}) {
        const table = await SkillTreeChargenApp._resolveRollTableRef(tableUuidOrId);
        if (!table) throw new Error(`RollTable not found: ${tableUuidOrId}`);

        const details = [];
        let nonEmpty = 0;
        let careerValid = 0;
        let plainText = 0;
        let itemResolvable = 0;
        let itemUnresolvable = 0;
        let malformedJson = 0;
        let parseErrors = 0;

        for (const r of table.results.contents) {
            const raw = SkillTreeChargenApp._resultRawJSON(r);
            const txt = String(raw ?? "").trim();
            const linkedItem = await SkillTreeChargenApp._resolveItemFromRollResult(r);
            if (!txt && !linkedItem) continue;

            nonEmpty += 1;

            try {
                await SkillTreeChargenApp.parseRollTableResult(r, table.name);
                careerValid += 1;
                continue;
            } catch (e) {
                const looksJson = txt.startsWith("{") || txt.startsWith("[");
                if (looksJson) {
                    malformedJson += 1;
                    parseErrors += 1;
                    details.push({
                        resultId: r.id,
                        range: r.range,
                        kind: "malformed-json",
                        error: e?.message ?? String(e),
                        preview: txt.slice(0, 120)
                    });
                    continue;
                }

                if (linkedItem) {
                    parseErrors += 1;
                    details.push({
                        resultId: r.id,
                        range: r.range,
                        kind: "invalid-item-template",
                        error: e?.message ?? String(e),
                        itemUuid: linkedItem.uuid,
                        itemName: linkedItem.name
                    });
                    continue;
                }
            }

            plainText += 1;
            const itemDoc = linkedItem ?? await SkillTreeChargenApp._resolveItemSpecDoc(txt);
            if (itemDoc) {
                itemResolvable += 1;
            } else {
                itemUnresolvable += 1;
            }
        }

        let classification = "mixed";
        if (nonEmpty === 0) classification = "empty";
        else if (parseErrors > 0) classification = "invalid";
        else if (careerValid === nonEmpty) classification = "career";
        else if (plainText === nonEmpty && itemResolvable === plainText) classification = "item";
        else if (plainText === nonEmpty && malformedJson === 0) classification = "text";
        else if (careerValid === 0 && malformedJson > 0) classification = "invalid";

        const report = {
            ok: classification !== "invalid",
            tableUuid: table.uuid,
            tableName: table.name,
            classification,
            counts: {
                total: table.results.size,
                nonEmpty,
                careerValid,
                plainText,
                itemResolvable,
                itemUnresolvable,
                malformedJson,
                parseErrors
            },
            details
        };

        if (mark) {
            await table.update({
                "flags.chargen1547_v2.tableKind": classification,
                "flags.chargen1547_v2.validationSummary": {
                    at: new Date().toISOString(),
                    classification,
                    counts: report.counts
                }
            });
        }

        return report;
    }

    static async validateAndClassifyTablesInFolder(folderUuid, { recursive = true, mark = true } = {}) {
        const folder = await fromUuid(folderUuid);
        if (!folder) throw new Error(`No document found for UUID: ${folderUuid}`);
        if (folder.documentName !== "Folder") {
            throw new Error(`UUID is ${folder.documentName}, expected Folder`);
        }

        const folderIds = new Set([folder.id]);
        if (recursive) {
            let added = true;
            while (added) {
                added = false;
                for (const f of game.folders.contents) {
                    if (f.type !== "RollTable") continue;
                    if (f.folder && folderIds.has(f.folder.id) && !folderIds.has(f.id)) {
                        folderIds.add(f.id);
                        added = true;
                    }
                }
            }
        }

        const tables = game.tables.contents.filter(t => t.folder && folderIds.has(t.folder.id));
        const reports = [];
        for (const t of tables) {
            try {
                const rep = await SkillTreeChargenApp.classifyRollTable(t.uuid, { mark });
                const validation = await SkillTreeChargenApp.validateTableJSON(t.uuid).catch((e) => ({
                    ok: false,
                    tableName: t.name,
                    uuid: t.uuid,
                    total: t.results?.size ?? 0,
                    bad: [{ id: "(table)", range: null, code: "table-error", error: e?.message ?? String(e), raw: "" }],
                    skipped: []
                }));
                const validationSummary = SkillTreeChargenApp._summarizeValidationReport(validation);
                rep.validation = {
                    ok: Boolean(validation.ok),
                    issueCount: validationSummary.issueCount,
                    issuePreview: validationSummary.issuePreview,
                    issueLines: validationSummary.issueLines
                };
                reports.push(rep);
            } catch (e) {
                reports.push({
                    ok: false,
                    tableUuid: t.uuid,
                    tableName: t.name,
                    classification: "invalid",
                    counts: { total: t.results?.size ?? 0, nonEmpty: 0, careerValid: 0, plainText: 0, itemResolvable: 0, itemUnresolvable: 0, malformedJson: 0 },
                    details: [{ kind: "table-error", error: e?.message ?? String(e) }],
                    validation: {
                        ok: false,
                        issueCount: 1,
                        issuePreview: "Table error: 1",
                        issueLines: [String(e?.message ?? e)]
                    }
                });
            }
        }

        const byType = reports.reduce((acc, r) => {
            acc[r.classification] = (acc[r.classification] ?? 0) + 1;
            return acc;
        }, {});

        const summary = {
            ok: reports.every(r => r.ok),
            folderName: folder.name,
            folderUuid: folder.uuid,
            recursive,
            marked: mark,
            tableCount: reports.length,
            byType,
            reports
        };

        console.group(`Chargen folder classify: ${folder.name} (${reports.length} tables)`);
        console.table(
            reports.map(r => ({
                table: r.tableName,
                classification: r.classification,
                total: r.counts?.total ?? 0,
                nonEmpty: r.counts?.nonEmpty ?? 0,
                malformedJson: r.counts?.malformedJson ?? 0
            }))
        );
        console.log("By type:", byType);
        console.groupEnd();

        return summary;
    }

    static _validationNeededForClass(classification) {
        if (classification === "career") return "Career JSON schema + next.tableUuid graph";
        if (classification === "item") return "Item table text (UUID/name per entry)";
        if (classification === "text") return "Plain text entries (no JSON required)";
        if (classification === "mixed") return "Mixed; split or normalize entry formats";
        if (classification === "invalid") return "Fix malformed JSON entries";
        if (classification === "empty") return "No entries";
        return "Unknown";
    }

    static _validationCodeLabel(code) {
        const map = {
            "effect-table-weight-sum": "Bad weight sum",
            "missing-next-rolltable": "Missing next RollTable",
            "missing-bio-rolltable": "Missing bio RollTable",
            "missing-item-rolltable": "Missing item RollTable",
            "missing-item-uuid": "Missing Item UUID",
            "missing-item-name": "Missing Item name",
            "semantic-validation-error": "Semantic validation error",
            "table-error": "Table error",
            "parse-error": "Parse error"
        };
        return map[String(code ?? "").trim()] ?? String(code ?? "Validation error");
    }

    static _formatValidationIssue(issue = {}) {
        const label = SkillTreeChargenApp._validationCodeLabel(issue.code);
        const resultId = issue.id != null ? `Result ${issue.id}` : null;
        const range = issue.range ? `Range ${JSON.stringify(issue.range)}` : null;
        const head = [label, resultId, range].filter(Boolean).join(" | ");
        const body = String(issue.error ?? issue.message ?? "Unknown validation error");
        return head ? `${head}: ${body}` : body;
    }

    static _summarizeValidationReport(report) {
        const issues = Array.isArray(report?.bad) ? report.bad : [];
        if (!issues.length) {
            return {
                issueCount: 0,
                issuePreview: "OK",
                issueLines: []
            };
        }

        const counts = issues.reduce((acc, issue) => {
            const key = SkillTreeChargenApp._validationCodeLabel(issue.code);
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
        }, {});

        const issuePreview = Object.entries(counts)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 3)
            .map(([label, count]) => `${label}: ${count}`)
            .join(", ");

        return {
            issueCount: issues.length,
            issuePreview,
            issueLines: issues.slice(0, 6).map(issue => SkillTreeChargenApp._formatValidationIssue(issue))
        };
    }

    static async listRollTablesForValidation({ folderUuid = null, recursive = true } = {}) {
        let tables = game.tables.contents.slice();

        if (folderUuid) {
            const folder = await fromUuid(folderUuid);
            if (!folder) throw new Error(`No document found for UUID: ${folderUuid}`);
            if (folder.documentName !== "Folder") {
                throw new Error(`UUID is ${folder.documentName}, expected Folder`);
            }

            const folderIds = new Set([folder.id]);
            if (recursive) {
                let added = true;
                while (added) {
                    added = false;
                    for (const f of game.folders.contents) {
                        if (f.type !== "RollTable") continue;
                        if (f.folder && folderIds.has(f.folder.id) && !folderIds.has(f.id)) {
                            folderIds.add(f.id);
                            added = true;
                        }
                    }
                }
            }
            tables = tables.filter(t => t.folder && folderIds.has(t.folder.id));
        }

        const entries = [];
        for (const t of tables) {
            const rep = await SkillTreeChargenApp.classifyRollTable(t.uuid, { mark: false });
            const validation = await SkillTreeChargenApp.validateTableJSON(t.uuid).catch((e) => ({
                ok: false,
                tableName: t.name,
                uuid: t.uuid,
                total: t.results?.size ?? 0,
                bad: [{ id: "(table)", range: null, code: "table-error", error: e?.message ?? String(e), raw: "" }],
                skipped: []
            }));
            const validationSummary = SkillTreeChargenApp._summarizeValidationReport(validation);
            entries.push({
                tableUuid: t.uuid,
                tableId: t.id,
                tableName: t.name,
                folderName: t.folder?.name ?? "(No folder)",
                classification: rep.classification,
                validationNeeded: SkillTreeChargenApp._validationNeededForClass(rep.classification),
                counts: rep.counts,
                validation: {
                    ok: Boolean(validation.ok),
                    issueCount: validationSummary.issueCount,
                    issuePreview: validationSummary.issuePreview,
                    issueLines: validationSummary.issueLines
                }
            });
        }

        entries.sort((a, b) => {
            const byFolder = String(a.folderName).localeCompare(String(b.folderName));
            if (byFolder !== 0) return byFolder;
            return String(a.tableName).localeCompare(String(b.tableName));
        });

        const summary = entries.reduce((acc, e) => {
            acc[e.classification] = (acc[e.classification] ?? 0) + 1;
            return acc;
        }, {});

        return {
            tableCount: entries.length,
            folderUuid: folderUuid ?? null,
            recursive: Boolean(recursive),
            summary,
            entries
        };
    }

    static async showRollTableValidationList({ folderUuid = null, recursive = true } = {}) {
        const data = await SkillTreeChargenApp.listRollTablesForValidation({ folderUuid, recursive });
        const rows = data.entries.map(e => `
            <tr>
              <td>${foundry.utils.escapeHTML(e.folderName)}</td>
              <td>${foundry.utils.escapeHTML(e.tableName)}</td>
              <td><code>${foundry.utils.escapeHTML(e.classification)}</code></td>
              <td><strong>${e.validation?.ok ? "OK" : "Issues"}</strong>${e.validation?.issueCount ? ` (${e.validation.issueCount})` : ""}</td>
              <td>${foundry.utils.escapeHTML(e.validationNeeded)}</td>
              <td title="${foundry.utils.escapeHTML((e.validation?.issueLines ?? []).join("\n"))}">
                ${foundry.utils.escapeHTML(e.validation?.issuePreview ?? "OK")}
              </td>
              <td style="text-align:right;">${Number(e.counts?.total ?? 0)}</td>
            </tr>
        `).join("");

        const summaryText = Object.entries(data.summary)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" | ");

        const issueCount = data.entries.reduce((sum, e) => sum + Number(e.validation?.issueCount ?? 0), 0);

        const content = `
            <div class="chargen-validation-list">
              <p><strong>RollTables:</strong> ${data.tableCount}</p>
              <p><strong>Summary:</strong> ${foundry.utils.escapeHTML(summaryText || "No tables")}</p>
              <p><strong>Validation issues:</strong> ${issueCount}</p>
              <div style="max-height: 420px; overflow: auto;">
                <table class="table-striped" style="width:100%;">
                  <thead>
                    <tr>
                      <th>Folder</th>
                      <th>Table</th>
                      <th>Class</th>
                      <th>Status</th>
                      <th>Validation Needed</th>
                      <th>Issues</th>
                      <th style="text-align:right;">Entries</th>
                    </tr>
                  </thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>
            </div>
        `;

        new Dialog({
            title: "Chargen RollTable Validation List",
            content,
            buttons: {
                close: { label: "Close" }
            }
        }, { width: 1000, height: "auto" }).render(true);

        return data;
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
            setup: { startingTable: "", choices: 2, maxRolls: 10 },
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

    static _resultRawJSON(result) {
        const d = (result?.description ?? "").trim();
        if (d) return d;

        const t = (result?.text ?? "").trim(); // deprecated fallback
        if (t) return t;

        const n = (result?.name ?? "").trim();
        return n;
    }

    static _toBoolean(v) {
        if (typeof v === "boolean") return v;
        if (typeof v === "number") return v !== 0;
        const s = String(v ?? "").trim().toLowerCase();
        return s === "true" || s === "1" || s === "yes" || s === "on";
    }

    static _stringListFromCSV(v) {
        return String(v ?? "")
            .split(",")
            .map(s => s.trim())
            .filter(Boolean);
    }

    static _numberOrNull(v) {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    static _normalizeTemplateType(v) {
        const raw = String(v ?? "").trim();
        if (!raw) return "";
        const map = {
            stat: "stat",
            skill: "skill",
            maneuver: "maneuver",
            money: "money",
            luck: "luck",
            contact: "contact",
            body: "body",
            social: "social",
            drive: "drive",
            bio: "bio",
            item: "item",
            language: "language",
            nothing: "nothing"
        };
        return map[raw.toLowerCase()] ?? raw.toLowerCase();
    }

    static _isItemDocument(doc) {
        if (!doc || typeof doc !== "object") return false;
        if (doc.documentName === "Item") return true;
        if (doc.collectionName === "items") return true;
        if (typeof Item !== "undefined" && doc instanceof Item) return true;
        return false;
    }

    static _getTemplateProps(item) {
        return item?.system?.props ?? {};
    }

    static _rewardIndexesFromProps(props) {
        const idx = new Set();
        for (const k of Object.keys(props ?? {})) {
            const m = /^Reward(\d+)([A-Za-z].*)?$/.exec(k);
            if (m) idx.add(Number(m[1]));
        }
        return Array.from(idx).sort((a, b) => a - b);
    }

    static _effectIndexesForReward(props, rewardIndex) {
        const idx = new Set();
        const rx = new RegExp(`^Reward${rewardIndex}Effect(\\d+)Type$`);
        for (const k of Object.keys(props ?? {})) {
            const m = rx.exec(k);
            if (m) idx.add(Number(m[1]));
        }
        return Array.from(idx).sort((a, b) => a - b);
    }

    static _effectIndexesForLegacySingle(props) {
        const idx = new Set();
        const rx = /^Effect(\d+)Type$/;
        for (const k of Object.keys(props ?? {})) {
            const m = rx.exec(k);
            if (m) idx.add(Number(m[1]));
        }
        return Array.from(idx).sort((a, b) => a - b);
    }

    static _collectRewardChangesFromProps(props, rewardIndex) {
        const out = [];
        const effectIndexes = SkillTreeChargenApp._effectIndexesForReward(props, rewardIndex);
        if (effectIndexes.length) {
            for (const i of effectIndexes) {
                const prefix = `Reward${rewardIndex}Effect${i}`;
                const ch = SkillTreeChargenApp._buildChangeFromTemplateReward(props, prefix);
                if (ch) out.push(ch);
            }
            return out;
        }

        // Backward compatibility: single change fields like Reward1Type/Reward1Amount/...
        const fallback = SkillTreeChargenApp._buildChangeFromTemplateReward(props, `Reward${rewardIndex}`);
        if (fallback) out.push(fallback);
        return out;
    }

    static _buildChangeFromTemplateReward(props, prefix) {
        const type = SkillTreeChargenApp._normalizeTemplateType(props[`${prefix}Type`]);
        if (!type || type === "nothing") return null;

        const ch = { type };

        const characteristic = String(props[`${prefix}Characteristic`] ?? "").trim();
        const steps = SkillTreeChargenApp._numberOrNull(props[`${prefix}Steps`]);
        const targetKey = String(props[`${prefix}TargetKey`] ?? "").trim();
        const targetLevel = SkillTreeChargenApp._numberOrNull(props[`${prefix}TargetLevel`]);
        const amount = SkillTreeChargenApp._numberOrNull(props[`${prefix}Amount`]);
        const formula = String(props[`${prefix}Formula`] ?? "").trim();
        const on = SkillTreeChargenApp._toBoolean(props[`${prefix}On`]);
        const action = String(props[`${prefix}Action`] ?? "").trim();
        const category = String(props[`${prefix}Category`] ?? "").trim();
        const text = String(props[`${prefix}Text`] ?? "").trim();
        const tableUuid = String(props[`${prefix}TableUuid`] ?? "").trim();
        const itemUuid = String(props[`${prefix}ItemUuid`] ?? "").trim();
        const name = String(props[`${prefix}ItemName`] ?? "").trim();
        const qty = SkillTreeChargenApp._numberOrNull(props[`${prefix}Qty`]);
        const stack = SkillTreeChargenApp._toBoolean(props[`${prefix}Stack`]);
        const languageTableKey = String(props[`${prefix}LanguageTableKey`] ?? "").trim();

        if (type === "stat") {
            if (characteristic) ch.characteristic = characteristic;
            if (steps != null) ch.steps = steps;
            return ch;
        }
        if (type === "skill" || type === "maneuver") {
            if (targetKey) ch.targetKey = targetKey;
            if (targetLevel != null) ch.targetLevel = targetLevel;
            return ch;
        }
        if (type === "money") {
            if (amount != null) ch.amount = amount;
            if (formula) ch.formula = formula;
            return ch;
        }
        if (type === "luck") {
            ch.on = on;
            return ch;
        }
        if (type === "social") {
            if (amount != null) ch.amount = amount;
            return ch;
        }
        if (type === "drive") {
            if (action) ch.action = action;
            if (category) ch.category = category;
            return ch;
        }
        if (type === "bio") {
            if (text) ch.text = text;
            if (tableUuid) ch.roll = { tableUuid };
            return ch;
        }
        if (type === "item") {
            if (tableUuid) ch.tableUuid = tableUuid;
            if (itemUuid) ch.itemUuid = itemUuid;
            if (name) ch.name = name;
            if (qty != null) ch.qty = qty;
            ch.stack = stack;
            return ch;
        }
        if (type === "language") {
            if (languageTableKey) ch.tableKey = languageTableKey;
            return ch;
        }

        // contact/body currently carry no additional fields
        return ch;
    }

    static _rowsFromDynamicTable(tableData) {
        const rawRows = tableData && typeof tableData === "object" ? Object.values(tableData) : [];
        return rawRows.filter(r => r && typeof r === "object" && !Array.isArray(r) && !r.$deleted);
    }

    static _buildChangeFromEffectRow(row) {
        const type = SkillTreeChargenApp._normalizeTemplateType(row?.Type);
        if (!type || type === "nothing") return null;

        const targetKey = String(row?.TargetKey ?? "").trim();
        const amountRaw = String(row?.Amount ?? "").trim();
        const amountNum = SkillTreeChargenApp._numberOrNull(amountRaw);
        const ch = { type };

        if (type === "stat") {
            if (targetKey) ch.characteristic = targetKey;
            if (amountNum != null) ch.steps = amountNum;
            return ch;
        }
        if (type === "skill" || type === "maneuver") {
            if (targetKey) ch.targetKey = targetKey;
            if (amountNum != null) ch.targetLevel = amountNum;
            return ch;
        }
        if (type === "money") {
            if (amountRaw && amountNum == null) ch.formula = amountRaw;
            else if (amountNum != null) ch.amount = amountNum;
            return ch;
        }
        if (type === "luck") {
            ch.on = SkillTreeChargenApp._toBoolean(amountRaw || true);
            return ch;
        }
        if (type === "contact" || type === "body") return ch;
        if (type === "social") {
            if (amountNum != null) ch.amount = amountNum;
            return ch;
        }
        if (type === "drive") {
            const action = targetKey.toLowerCase();
            if (action === "add" || action === "remove") ch.action = action;
            if (action === "add" && amountRaw) ch.category = amountRaw;
            return ch;
        }
        if (type === "bio") {
            if (amountRaw) ch.text = amountRaw;
            if (targetKey) ch.roll = { tableUuid: targetKey };
            return ch;
        }
        if (type === "item") {
            if (targetKey.includes("RollTable.")) ch.tableUuid = targetKey;
            else if (targetKey.includes(".")) ch.itemUuid = targetKey;
            else if (targetKey) ch.name = targetKey;
            if (amountNum != null) ch.qty = amountNum;
            return ch;
        }
        if (type === "language") {
            if (targetKey) ch.tableKey = targetKey;
            return ch;
        }
        return ch;
    }

    static _buildEffectTableFromProps(props, tableKey) {
        const rows = SkillTreeChargenApp._rowsFromDynamicTable(props?.[tableKey]).map((row, idx) => {
            const weight = SkillTreeChargenApp._numberOrNull(row?.Weight) ?? 0;
            const nextTableUuid = String(row?.NextTable ?? "").trim();
            return {
                rowIndex: idx,
                weight,
                change: SkillTreeChargenApp._buildChangeFromEffectRow(row),
                next: nextTableUuid ? { tableUuid: nextTableUuid } : null,
                raw: row
            };
        }).filter(r => r.weight > 0);

        if (!rows.length) return null;
        return { key: tableKey, rows };
    }

    static _parseTemplateItemToChoiceData(item, tableName = "RollTable") {
        const props = SkillTreeChargenApp._getTemplateProps(item);
        const title = String(props.ChoiceTitle ?? item?.name ?? "").trim();
        const text = String(props.ChoiceText ?? "").trim();
        const icon = String(props.ChoiceCard ?? props.ChoiceIcon ?? item?.img ?? "").trim();
        const tags = SkillTreeChargenApp._stringListFromCSV(props.ChoiceTags);
        const bio = String(props.ChoiceBio ?? "").trim();

        const effectTables = ["Effects1", "Effects2", "Effects3"]
            .map(key => SkillTreeChargenApp._buildEffectTableFromProps(props, key))
            .filter(Boolean);

        if (effectTables.length) {
            const parsed = {
                choice: { title, text, icon, tags },
                bio,
                rewards: [{ weight: 1, changes: [] }],
                effectTables
            };
            SkillTreeChargenApp._validateParsedResultSchema(parsed, tableName);
            return parsed;
        }

        const rewards = [];
        const rewardIndexes = SkillTreeChargenApp._rewardIndexesFromProps(props);
        for (const n of rewardIndexes) {
            const prefix = `Reward${n}`;
            const changes = SkillTreeChargenApp._collectRewardChangesFromProps(props, n);
            const nextTableUuid = String(props[`${prefix}NextTableUuid`] ?? "").trim();
            const weightRaw = SkillTreeChargenApp._numberOrNull(props[`${prefix}Weight`]);

            if (!changes.length && !nextTableUuid) continue;
            const rw = {
                weight: weightRaw == null ? 1 : weightRaw,
                changes
            };
            if (nextTableUuid) rw.next = { tableUuid: nextTableUuid };
            rewards.push(rw);
        }

        // Backstop for the single-reward template variant.
        if (!rewards.length) {
            const weightRaw = SkillTreeChargenApp._numberOrNull(props.Weight);
            const nextTableUuid = String(props.NextTableUuid ?? "").trim();
            const changes = [];
            const legacyIdx = SkillTreeChargenApp._effectIndexesForLegacySingle(props);
            if (legacyIdx.length) {
                for (const i of legacyIdx) {
                    const ch = SkillTreeChargenApp._buildChangeFromTemplateReward(props, `Effect${i}`);
                    if (ch) changes.push(ch);
                }
            } else {
                const ch = SkillTreeChargenApp._buildChangeFromTemplateReward(props, "Effect1");
                if (ch) changes.push(ch);
            }
            if (changes.length || nextTableUuid) {
                const rw = {
                    weight: weightRaw == null ? 1 : weightRaw,
                    changes
                };
                if (nextTableUuid) rw.next = { tableUuid: nextTableUuid };
                rewards.push(rw);
            }
        }

        const parsed = {
            choice: { title, text, icon, tags },
            bio,
            rewards
        };
        SkillTreeChargenApp._validateParsedResultSchema(parsed, tableName);
        return parsed;
    }

    static async _resolveItemFromRollResult(result) {
        const direct = await result?.getDocument?.().catch(() => null);
        if (SkillTreeChargenApp._isItemDocument(direct)) return direct;

        const documentUuid = String(result?.documentUuid ?? "").trim();
        if (documentUuid) {
            const doc = await fromUuid(documentUuid).catch(() => null);
            if (SkillTreeChargenApp._isItemDocument(doc)) return doc;
        }

        const documentCollection = String(result?.documentCollection ?? "").trim();
        const documentId = String(result?.documentId ?? "").trim();
        if (documentCollection && documentId) {
            if (documentCollection === "Item") {
                const worldItem = game.items.get(documentId) ?? null;
                if (SkillTreeChargenApp._isItemDocument(worldItem)) return worldItem;
            }

            const compoundUuid = `${documentCollection}.${documentId}`;
            const doc = await fromUuid(compoundUuid).catch(() => null);
            if (SkillTreeChargenApp._isItemDocument(doc)) return doc;
        }

        const raw = String(SkillTreeChargenApp._resultRawJSON(result) ?? "").trim();
        if (!raw) return null;
        const resultType = String(result?.type ?? "").trim().toLowerCase();

        // Foundry document results can arrive partially normalized in a way that
        // omits a resolvable UUID but still preserves the authored item name.
        // Restrict this fallback to explicit document results so plain-text
        // tables are not misclassified as item-backed tables.
        if (resultType === "document") {
            const worldItem = game.items.contents.find(i => String(i?.name ?? "").trim() === raw) ?? null;
            if (SkillTreeChargenApp._isItemDocument(worldItem)) return worldItem;
        }

        if (!raw.includes(".")) return null;
        const doc = await fromUuid(raw).catch(() => null);
        return SkillTreeChargenApp._isItemDocument(doc) ? doc : null;
    }

    static async parseRollTableResult(result, tableName = "RollTable") {
        return parseRewardResult({
            result,
            tableName,
            resolveItemFromRollResult: (value) => SkillTreeChargenApp._resolveItemFromRollResult(value),
            parseTemplateItemToChoiceData: (item, name) => SkillTreeChargenApp._parseTemplateItemToChoiceData(item, name),
            resultRawJSON: (value) => SkillTreeChargenApp._resultRawJSON(value),
            validateParsedResultSchema: (parsed, name) => SkillTreeChargenApp._validateParsedResultSchema(parsed, name)
        });
    }


    _pickWeightedReward(rewards) {
        return pickWeightedReward(rewards);
    }

    _pickWeightedEffectRow(rows) {
        return pickWeightedEffectRow(rows);
    }

    _resolveRewardFromEffectTables(effectTables) {
        return resolveRewardFromEffectTables(effectTables);
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

    async _addStory(run, tableName, text) {
        if (!text) return;
        const label = getStoryLabel(tableName);
        const line = label ? `[${label}] ${String(text)}` : String(text);
        run.storyTimeline ??= [];
        run.storyTimeline.push(line);
        await this._appendListProp("Story", line);
    }

    /* ---------------- SkillTree hook ---------------- */

    _getPropNumber(key) {
        const raw = this.actor.system?.props?.[key];
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
    }

    async _grantSkillToward(run, targetKey, targetLevel, fallback, { silent = false } = {}) {
        const st = globalThis.SkillTree;
        if ((!st?.grantFirstAvailableNode && !st?.nextStepToward) || (!st?.grantFirstAvailableNode && !st?.NODES)) {
            if (fallback?.type === "stat") {
                await advanceStat(this.actor, fallback.characteristic, Number(fallback.steps ?? 1));
            }
            return;
        }

        if (typeof st.grantFirstAvailableNode === "function") {
            const result = await st.grantFirstAvailableNode(this.actor, targetKey, targetLevel, {
                graphData: st.NODES
            });

            if (!result?.ok || !result.granted) {
                if (fallback?.type === "stat") {
                    await advanceStat(this.actor, fallback.characteristic, Number(fallback.steps ?? 1));
                }
                return;
            }

            const grantedName = result.next?.name ?? result.granted.nodeId ?? targetKey;
            const grantedType = String(result.next?.type ?? "").toLowerCase();
            const grantedLevel = Number(result.granted.level);
            const showLevel = grantedType !== "maneuver" && Number.isFinite(grantedLevel);
            if (!silent) {
                await this._addBio(run, showLevel ? `Learned ${grantedName} ${grantedLevel}` : `Learned ${grantedName}`);
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
        if (!silent) {
            await this._addBio(run, `Learned ${step.nodeName} ${next}`);
        }
    }

    async _getBaselineMinZeroSkills() {
        if (Array.isArray(BASELINE_MIN_ZERO_SKILLS_CACHE)) return BASELINE_MIN_ZERO_SKILLS_CACHE;

        const url = foundry.utils.getRoute("modules/chargen1547_v2/skills/skills.js");
        const raw = await fetch(url).then(async r => {
            if (!r.ok) throw new Error(`Failed to load baseline skills from ${url}`);
            return await r.text();
        });
        const parsed = JSON.parse(raw);
        BASELINE_MIN_ZERO_SKILLS_CACHE = parsed
            .filter(entry => Number(entry?.minLevel) === 0 && String(entry?.uuid ?? "").trim() !== "")
            .map(entry => String(entry.uuid).trim());
        return BASELINE_MIN_ZERO_SKILLS_CACHE;
    }

    async _grantManeuverToward(run, targetKey, targetLevel, fallback) {
        await this._grantSkillToward(run, targetKey, targetLevel, fallback);
    }
    async _getTableName(uuidOrId) {
        this._tableNameCache ??= new Map();

        const key = String(uuidOrId ?? "").trim();
        if (!key) return "Unknown";

        if (this._tableNameCache.has(key)) return this._tableNameCache.get(key);

        const t = await this._getRollTable(key);
        const name = t?.name ?? key;

        this._tableNameCache.set(key, name);
        return name;
    }
    /* ---------------- Reward helpers ---------------- */

    async _rollOnce(tableUuidOrId) {
        const table = await this._getRollTable(tableUuidOrId);
        if (!table) throw new Error(`RollTable not found: ${tableUuidOrId}`);

        // Roll using the table's formula (e.g. "1d100")
        const roll = await (new Roll(table.formula)).evaluate({ async: true });

        // Get results for that roll WITHOUT drawing/consuming
        const results = table.getResultsForRoll?.(roll.total) ?? [];

        // If multiple results match (overlapping ranges), pick one
        const r = results.length ? results[Math.floor(Math.random() * results.length)] : null;

        if (!r) {
            throw new Error(
                `RollTable "${table.name}" produced no result for roll ${roll.total} (${table.formula}).`
            );
        }

        return { result: r, raw: SkillTreeChargenApp._resultRawJSON(r) };
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

    _languageReadWriteFlag(v) {
        if (typeof v === "boolean") return v;
        if (typeof v === "number") return v !== 0;
        const s = String(v ?? "").trim().toLowerCase();
        return s === "true" || s === "1" || s === "yes" || s === "on";
    }

    _isLanguageRow(row) {
        return row && typeof row === "object" && !Array.isArray(row)
            && ("Language" in row || "LanguageReadWrite" in row);
    }

    _resolveLanguageTable(tableKeyHint = null) {
        const props = this.actor.system?.props ?? {};
        const hint = String(tableKeyHint ?? "").trim();

        if (hint) {
            const hinted = props[hint];
            if (Array.isArray(hinted)) {
                return { tableKey: hint, rows: foundry.utils.deepClone(hinted) };
            }
        }

        for (const [k, v] of Object.entries(props)) {
            if (!Array.isArray(v) || !v.length) continue;
            if (v.some(row => this._isLanguageRow(row))) {
                return { tableKey: k, rows: foundry.utils.deepClone(v) };
            }
        }

        for (const [k, v] of Object.entries(props)) {
            if (!Array.isArray(v)) continue;
            if (k.toLowerCase().includes("language")) {
                return { tableKey: k, rows: foundry.utils.deepClone(v) };
            }
        }

        if (hint) return { tableKey: hint, rows: [] };
        if (Array.isArray(props.Languages)) {
            return { tableKey: "Languages", rows: foundry.utils.deepClone(props.Languages) };
        }

        return { tableKey: "Languages", rows: [] };
    }

    _getKnownLanguages(rows) {
        const out = [];
        rows.forEach((row, index) => {
            if (!this._isLanguageRow(row)) return;
            const name = String(row.Language ?? "").trim();
            if (!name) return;
            out.push({
                rowIndex: index,
                name,
                readWrite: this._languageReadWriteFlag(row.LanguageReadWrite)
            });
        });
        return out;
    }

    async _promptLanguageAwardAction({ canUpgrade = false } = {}) {
        return new Promise((resolve) => {
            const buttons = {
                add: {
                    label: "Add New Language",
                    callback: () => resolve("add")
                },
                cancel: {
                    label: "Cancel",
                    callback: () => resolve(null)
                }
            };

            if (canUpgrade) {
                buttons.upgrade = {
                    label: "Upgrade Read/Write",
                    callback: () => resolve("upgrade")
                };
            }

            new Dialog({
                title: "Language Award",
                content: `
                    <p>Choose how to apply this language award.</p>
                    <ul>
                      <li><strong>Add New Language</strong>: add a new spoken language.</li>
                      <li><strong>Upgrade Read/Write</strong>: improve literacy in a known language.</li>
                    </ul>
                `,
                buttons,
                default: canUpgrade ? "upgrade" : "add",
                close: () => resolve(null)
            }).render(true);
        });
    }

    async _promptNewLanguageName() {
        return new Promise((resolve) => {
            new Dialog({
                title: "Add New Language",
                content: `
                    <div class="form-group">
                      <label for="cg-language-name">Language</label>
                      <input id="cg-language-name" name="languageName" type="text" placeholder="e.g. Castilian" />
                    </div>
                `,
                buttons: {
                    ok: {
                        label: "Add",
                        callback: (html) => {
                            const value = String(html.find("[name='languageName']").val() ?? "").trim();
                            resolve(value || null);
                        }
                    },
                    cancel: {
                        label: "Cancel",
                        callback: () => resolve(null)
                    }
                },
                default: "ok",
                close: () => resolve(null)
            }).render(true);
        });
    }

    async _promptLanguageUpgradeChoice(upgradable) {
        const options = upgradable
            .map((l, i) => `<option value="${i}">${foundry.utils.escapeHTML(l.name)}</option>`)
            .join("");

        return new Promise((resolve) => {
            new Dialog({
                title: "Upgrade Language Read/Write",
                content: `
                    <div class="form-group">
                      <label for="cg-language-upgrade">Choose Language</label>
                      <select id="cg-language-upgrade" name="languageUpgrade">${options}</select>
                    </div>
                `,
                buttons: {
                    ok: {
                        label: "Upgrade",
                        callback: (html) => {
                            const idx = Number(html.find("[name='languageUpgrade']").val());
                            if (!Number.isInteger(idx) || idx < 0 || idx >= upgradable.length) {
                                resolve(null);
                                return;
                            }
                            resolve(upgradable[idx]);
                        }
                    },
                    cancel: {
                        label: "Cancel",
                        callback: () => resolve(null)
                    }
                },
                default: "ok",
                close: () => resolve(null)
            }).render(true);
        });
    }

    async _awardLanguage(run, ch) {
        const tableRef = this._resolveLanguageTable(ch?.tableKey);
        const rows = Array.isArray(tableRef.rows) ? tableRef.rows : [];
        const known = this._getKnownLanguages(rows);
        const upgradable = known.filter(l => !l.readWrite);

        const action = await this._promptLanguageAwardAction({ canUpgrade: upgradable.length > 0 });
        if (!action) {
            await this._addBio(run, "Language award canceled.");
            return;
        }

        if (action === "upgrade") {
            if (!upgradable.length) {
                ui.notifications.info("No known language can be upgraded to read/write.");
                await this._addBio(run, "Language award: no eligible language for read/write upgrade.");
                return;
            }

            const chosen = await this._promptLanguageUpgradeChoice(upgradable);
            if (!chosen) {
                await this._addBio(run, "Language award canceled.");
                return;
            }

            rows[chosen.rowIndex] = {
                ...(rows[chosen.rowIndex] ?? {}),
                Language: chosen.name,
                LanguageReadWrite: true
            };

            await this.actor.update({ [`system.props.${tableRef.tableKey}`]: rows });
            await this._addBio(run, `Language literacy gained: ${chosen.name} (read/write).`);
            return;
        }

        const newLanguage = await this._promptNewLanguageName();
        if (!newLanguage) {
            await this._addBio(run, "Language award canceled.");
            return;
        }

        const existing = known.find(l => l.name.toLowerCase() === newLanguage.toLowerCase());
        if (existing) {
            if (!existing.readWrite) {
                rows[existing.rowIndex] = {
                    ...(rows[existing.rowIndex] ?? {}),
                    Language: existing.name,
                    LanguageReadWrite: true
                };
                await this.actor.update({ [`system.props.${tableRef.tableKey}`]: rows });
                await this._addBio(run, `Language already known; upgraded ${existing.name} to read/write.`);
                return;
            }

            ui.notifications.info(`${existing.name} is already known with read/write.`);
            await this._addBio(run, `Language award skipped: ${existing.name} already has read/write.`);
            return;
        }

        rows.push({
            Language: newLanguage,
            LanguageReadWrite: false
        });
        await this.actor.update({ [`system.props.${tableRef.tableKey}`]: rows });
        await this._addBio(run, `Learned language: ${newLanguage}.`);
    }

    async _applyChanges(run, changes = []) {
        return applyRewardChanges(this, run, changes, {
            advanceStat,
            promptAddDrive,
            promptRemoveDrive
        });
    }
    async _rollLuckTable(run) {
        const luckTableUuid = "RollTable.mWI6zmHkHhQA84Yp";
        const rollResult = await this._rollOnce(luckTableUuid);
        const luckOutcome = SkillTreeChargenApp._resultRawJSON(rollResult.result).trim();
        return `A lucky turn of events occurred: ${luckOutcome}`;
    }
    /* ---------------- Flow ---------------- */

    async _rollCards(run) {
        const table = await this._getRollTable(run.tableUuid);
        if (!table) throw new Error(`RollTable not found: ${run.tableUuid}`);

        const pool = table.results.contents.slice();
        const out = [];
        const useUnknownExtremeReveal = SkillTreeChargenApp._tableUsesUnknownExtremeReveal(table);

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

        const drawRolledResult = async () => {
            if (!pool.length) return null;

            const maxAttempts = Math.max(20, pool.length * 12);
            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                const roll = await (new Roll(table.formula)).evaluate({ async: true });
                const matches = (table.getResultsForRoll?.(roll.total) ?? [])
                    .filter(result => pool.some(entry => entry.id === result.id));

                if (!matches.length) continue;

                const chosen = matches[Math.floor(Math.random() * matches.length)];
                const idx = pool.findIndex(entry => entry.id === chosen.id);
                if (idx < 0) continue;

                const r = pool.splice(idx, 1)[0];
                const data = await SkillTreeChargenApp.parseRollTableResult(r, table.name);
                return { r, data };
            }

            return null;
        };

        while (out.length < Math.min(run.choices, table.results.contents.length) && pool.length) {
            let drawn = await drawRolledResult();
            if (!drawn) break;

            // If this is a Status-gated choice, do the extra roll. On failure, redraw once and
            // accept the replacement without another social-status gate so the user keeps a full choice set.
            if (hasStatusTag(drawn.data)) {
                const p = statusPassChance();
                const roll = Math.floor(Math.random() * 100) + 1; // 1..100
                const target = Math.floor(p * 100);

                if (roll > target) {
                    const s = getSocialStatus();
                    const luckyTxt = run.luckyStreak ? " + Lucky" : "";
                    await this._addBio(
                        run,
                        `Missed: ${drawn.data.choice?.title ?? "Unknown"} (Status check failed: rolled ${roll} vs ${target}; Social ${s}${luckyTxt})`
                    );

                    const replacement = await drawRolledResult();
                    if (!replacement) continue;
                    drawn = replacement;
                }
            }

            const { r, data } = drawn;

            // Prefer the template/item card art, otherwise fall back to the table result or table image.
            const chosen =
                (!isPlaceholderImg(data?.choice?.icon) ? data.choice.icon : "") ||
                (!isPlaceholderImg(r.img) ? r.img : "") ||
                table.img;
            const img = resolveImgPath(chosen);

            out.push({
                resultId: r.id,
                rawText: SkillTreeChargenApp._resultRawJSON(r),
                img,
                data,
                isHiddenOutcome: useUnknownExtremeReveal && SkillTreeChargenApp._resultHasExtremeUnknownReveal(r),
                masked: useUnknownExtremeReveal && SkillTreeChargenApp._resultHasExtremeUnknownReveal(r)
            });
        }

        return out;
    }

    _summarizeChange(ch) {
        return summarizeRewardChange(ch);
    }

    async _buildRevealSummary(run, reward, nextUuid) {
        const lines = [];
        for (const ch of reward?.changes ?? []) {
            const line = this._summarizeChange(ch);
            if (line) lines.push(line);
        }

        const nextName = nextUuid ? await this._getTableName(nextUuid) : "";
        return {
            lines,
            nextUuid,
            nextName,
            terminal: !nextUuid,
            exhausted: Number(run?.remainingGlobal ?? 0) <= 0
        };
    }



    /* ---------------- FormApplication ---------------- */

    async getData() {
        const state = this._getState();
        const run = state.run;
        const relevantTables = await this._getRelevantTablesForView(state);
        const table = run?.tableUuid ? await this._getRollTable(run.tableUuid) : null;
        const rawTableDescription = String(
            table?.description ??
            foundry.utils.getProperty(table, "system.description") ??
            ""
        ).trim();
        const tableDescription = rawTableDescription
            ? await TextEditor.enrichHTML(rawTableDescription, { async: true })
            : "";
        const reveal = run?.reveal ?? null;
        const backImg = resolveImgPath("media/home/games/1547/Cards/backside.webp");
        const unknownImg = resolveImgPath(UNKNOWN_CARD_IMAGE);

        return {
            state: run ?? { remainingGlobal: 0 },
            actorName: this.actor?.name ?? "",
            currentTableName: table?.name ?? "",
            currentTableDescription: tableDescription,
            backImg,
            reveal,
            cards: (run?.cards ?? []).map((c, idx) => ({
                title: c.masked ? "Unknown" : c.data.choice.title,
                text: c.masked ? "" : (c.data.choice.text ?? ""),
                img: c.masked ? unknownImg : (c.img ?? ""),
                cardClass: reveal
                    ? (idx === reveal.chosenIndex ? "is-selected" : "is-flipped is-rejected")
                    : "",
                tooltip: reveal
                    ? (idx === reveal.chosenIndex ? "Click this card again to continue." : "Not chosen.")
                    : (c.masked
                        ? "Click to reveal this hidden result."
                        : "Click to choose this option. The reward is rolled immediately.")
            })),
            bio: run?.bio ?? [],
            relevantTables
        };
    }

    async _getRelevantTablesForView(state) {
        const setup = state?.setup ?? {};
        const defs = [
            {
                key: "startingTable",
                role: "Career Start",
                use: "Birth / career chain entry",
                ref: setup.startingTable
            },
            {
                key: "contact.roleTable",
                role: "Contact Role",
                use: "Contact generation",
                ref: setup.contactTables?.roleTable
            },
            {
                key: "contact.flavorTable",
                role: "Contact Flavor",
                use: "Contact generation",
                ref: setup.contactTables?.flavorTable
            },
            {
                key: "contact.toneTable",
                role: "Contact Tone",
                use: "Contact generation",
                ref: setup.contactTables?.toneTable
            },
            {
                key: "contact.hookTable",
                role: "Contact Hook",
                use: "Contact generation",
                ref: setup.contactTables?.hookTable
            },
            {
                key: "contact.quirkTable",
                role: "Contact Quirk",
                use: "Contact generation",
                ref: setup.contactTables?.quirkTable
            },
            {
                key: "bodyTable",
                role: "Body / Appearance",
                use: "Body change results",
                ref: setup.bodyTable
            },
            {
                key: "miscTable",
                role: "Misc",
                use: "Misc results",
                ref: setup.miscTable
            }
        ];

        const out = [];
        for (const d of defs) {
            const ref = String(d.ref ?? "").trim();
            if (!ref) continue;

            const doc = await this._getRollTable(ref);
            out.push({
                key: d.key,
                role: d.role,
                use: d.use,
                ref,
                tableName: doc?.name ?? "(Missing table)",
                ok: Boolean(doc)
            });
        }

        return out;
    }


    activateListeners(html) {
        super.activateListeners(html);

        html.find("[data-action='reroll']").on("click", () => this._onReroll());
        html.find("[data-action='finish']").on("click", () => this._onFinish());
        html.find("[data-action='table-list']").on("click", () => this._onShowTableList());
        html.find("[data-action='continue']").on("click", () => this._onContinue());

        html.on("click", ".chargen-card", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const state = this._getState();
            const cardEl = ev.currentTarget;
            const idx = Number(cardEl.dataset.index);
            if (Number.isNaN(idx)) return;

            if (state?.run?.reveal) {
                if (idx === state.run.reveal.chosenIndex) this._onContinue();
                return;
            }

            this._onChoose(idx, cardEl);
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

    async _onShowTableList() {
        try {
            const state = this._getState();
            const setup = state?.setup ?? {};
            let folderUuid = null;

            const startRef = String(setup.startingTable ?? "").trim();
            if (startRef) {
                const startTable = await this._getRollTable(startRef);
                folderUuid = startTable?.folder?.uuid ?? null;
            }

            await SkillTreeChargenApp.showRollTableValidationList({
                folderUuid,
                recursive: true
            });
        } catch (e) {
            ui.notifications.error(e?.message ?? "Unable to open validation list.");
            console.error(e);
        }
    }

    async _onChoose(index, cardEl) {
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
            if (picked.masked) {
                picked.masked = false;
                await this._setState({ ...state, run });
                this.render(true);
                return;
            }

            const cardNodes = Array.from(this.element?.find(".chargen-card") ?? []);
            for (const [i, node] of cardNodes.entries()) {
                if (!(node instanceof HTMLElement)) continue;
                if (i === index) node.classList.add("is-selected");
                else node.classList.add("is-flipped", "is-rejected");
            }

            const data = picked.data;

            await this._addBio(run, `Chose: ${data.choice?.title ?? "Unknown"}`);
            if (data.bio) await this._addBio(run, String(data.bio));

            const reward = Array.isArray(data.effectTables) && data.effectTables.length
                ? this._resolveRewardFromEffectTables(data.effectTables)
                : this._pickWeightedReward(Array.isArray(data.rewards) ? data.rewards : []);
            if (!reward) throw new Error("No valid reward could be selected.");

            await this._applyChanges(run, reward.changes ?? []);

            const fromUuid = run.tableUuid;
            const fromName = await this._getTableName(fromUuid);
            if (getChargenSettings().storyEnabled) {
                await advanceStoryThread(this, run, {
                    tableName: fromName,
                    choiceTitle: data.choice?.title ?? "",
                    choiceTags: Array.isArray(data.choice?.tags) ? data.choice.tags : []
                });
            }

            const nextUuid = String(reward?.next?.tableUuid ?? "").trim();

            run.remainingGlobal = Math.max(0, Number(run.remainingGlobal ?? 0) - 1);
            run.history.push({
                tableUuid: run.tableUuid,
                choiceTitle: data.choice?.title ?? "",
                rewardApplied: reward
            });
            if (!nextUuid) {
                await this._addBio(run, `Career ended with ${fromName}`);
            }

            if (nextUuid) {
                const toName = await this._getTableName(nextUuid);
                await this._addBio(run, `${toName}`);
            }

            run.reveal = {
                chosenIndex: index,
                fromUuid,
                fromName,
                ...(await this._buildRevealSummary(run, reward, nextUuid))
            };

            await new Promise(r => setTimeout(r, 520));
            await this._setState({ ...state, run });
            this.render(true);

        } catch (e) {
            ui.notifications.error(e.message);
            console.error(e);
        }
    }

    async _onContinue() {
        const state = this._getState();
        const run = state.run;
        const reveal = run?.reveal;
        if (!run || !reveal) return;

        if (reveal.exhausted) {
            await this._setState({ ...state, run: { ...run, reveal: null } });
            await this._finishWithSummary(run);
            return;
        }

        if (reveal.terminal || !reveal.nextUuid) {
            await this._setState({ ...state, run: { ...run, reveal: null } });
            await this._finishWithSummary(run);
            return;
        }

        run.tableUuid = reveal.nextUuid;
        run.reveal = null;
        run.cards = await this._rollCards(run);
        await this._setState({ ...state, run });
        this.render(true);
    }
    async _getItemDocFromSpec(spec) {
        return await SkillTreeChargenApp._resolveItemSpecDoc(spec);
    }

    /**
     * Grant an Item to the actor.
     * - If stack=true and an existing item with same name exists, tries to increment quantity.
     * - Otherwise creates a new embedded Item copy.
     */
    async _grantItemToActor(run, itemDoc, qty = 1, { stack = false, qtyPath = "system.props.Quantity" } = {}) {
        qty = Number(qty ?? 1);
        if (!Number.isFinite(qty) || qty === 0) return;

        const name = itemDoc?.name ?? "Unknown Item";

        // Try stacking (optional, depends on your system having a quantity field)
        if (stack) {
            const existing = this.actor.items.find(i => i.name === name);
            if (existing) {
                const cur = Number(foundry.utils.getProperty(existing, qtyPath) ?? 1);
                const next = Math.max(0, cur + qty);
                await existing.update({ [qtyPath]: next });
                await this._addBio(run, `Item: ${name} (${cur} → ${next})`);
                return;
            }
        }

        // Create embedded copy
        const data = itemDoc.toObject();
        // If your CSB item template uses a quantity field, set it
        foundry.utils.setProperty(data, "system.props.Quantity", Number.isFinite(qty) ? qty : 1);

        await this.actor.createEmbeddedDocuments("Item", [data]);
        await this._addBio(run, `Item: ${name}${qty !== 1 ? ` ×${qty}` : ""}`);
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
        await this._setState({ ...this._getState(), run: null });
        this.close();
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
function statIndex(dice, mod) {
    return (dice - 1) * 4 + mod;
}

function indexToStat(index) {
    const clamped = Math.max(0, index);
    return {
        dice: Math.floor(clamped / 4) + 1,
        mod: clamped % 4
    };
}
export async function advanceStat(actor, characteristic, steps) {
    const dKey = `Stats_${characteristic}Dice`;
    const mKey = `Stats_${characteristic}Mod`;

    const props = actor.system?.props ?? {};
    const beforeDice = Number(props[dKey] ?? 1);
    const beforeMod = Number(props[mKey] ?? 0);

    const beforeIndex = statIndex(beforeDice, beforeMod);

    // ✅ allow negative steps, but clamp to minimum
    const afterIndex = Math.max(0, beforeIndex + Number(steps ?? 0));

    const { dice, mod } = indexToStat(afterIndex);

    await actor.update({
        [`system.props.${dKey}`]: dice,
        [`system.props.${mKey}`]: mod
    });

    return { dice, mod };
}
