import { promptAddDrive, promptRemoveDrive } from "./drive-prompts.js";
import { PRIMARY_STATS } from "/modules/chargen1547_v2/foundry-primary-stats/stats.js";
import {
    advanceDeferredQueue,
    buildDeferredReveal,
    enqueueDeferred,
    extractDeferredFromChoice
} from "./chargen-deferred.js";
import { getChargenSettings, getLegacyMappedRef, getPackagesForStage } from "./settings.js";
import {
    applyRewardChanges,
    parseRewardResult,
    pickWeightedEffectRow,
    pickWeightedReward,
    resolveRewardFromEffectTables,
    summarizeRewardChange
} from "./chargen-rewards.js";
import {
    buildChargenInterfaceCatalog,
    DEFAULT_BODY_TABLE,
    DEFAULT_CONTACT_TABLES,
    normalizeInterfacePath,
    SPECIAL_BIO_TABLES,
    SPECIAL_ITEM_TABLES,
    UNKNOWN_CARD_IMAGE
} from "./interface-registry.js";
console.log("CHARGEN.JS LOADED FROM", import.meta.url);

const UNKNOWN_EXTREME_EXCLUDED_TABLE_REFS = new Set([
    "RollTable.BhHorosc3d6Q7mR4",
    "RollTable.BhHumors1d8Q7mRX",
    "birth-horoscope",
    "birth-humors"
]);

const DEFAULT_MANEUVERS_PATH = "modules/chargen1547_v2/default-maneuvers.json";

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
        .replace(/[â€“â€”]/g, "-")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}

let BASELINE_MIN_ZERO_SKILLS_CACHE = null;
let DEFAULT_MANEUVER_REFS_CACHE = null;

async function loadDefaultManeuverRefs() {
    if (Array.isArray(DEFAULT_MANEUVER_REFS_CACHE)) return DEFAULT_MANEUVER_REFS_CACHE;

    const route = foundry.utils.getRoute(DEFAULT_MANEUVERS_PATH);
    const response = await fetch(route, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`Failed to load default maneuvers from ${DEFAULT_MANEUVERS_PATH}`);
    }

    const entries = await response.json();
    if (!Array.isArray(entries)) {
        throw new Error(`Default maneuvers file must contain an array: ${DEFAULT_MANEUVERS_PATH}`);
    }

    DEFAULT_MANEUVER_REFS_CACHE = entries
        .map(entry => String(entry?.uuid ?? "").trim())
        .filter(Boolean);
    return DEFAULT_MANEUVER_REFS_CACHE;
}

async function preloadImages(urls = []) {
    const uniqueUrls = [...new Set(urls.map(url => String(url ?? "").trim()).filter(Boolean))];
    if (!uniqueUrls.length) return;

    await Promise.all(uniqueUrls.map(src => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = src;
    })));
}


// ===================== APP =====================
export class SkillTreeChargenApp extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "skilltree-chargen",
            classes: ["skilltree-chargen-window"],
            title: "The Life",
            template: "modules/chargen1547_v2/templates/chargen.hbs",
            width: Math.min(1380, window.innerWidth - 48),
            height: Math.min(940, window.innerHeight - 48),
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
        const ref = getLegacyMappedRef(String(uuidOrId).trim());
        if (!ref) return null;
        const doc = ref.includes(".")
            ? await fromUuid(ref).catch(() => null)
            : game.tables.get(ref);

        if (!doc || doc.documentName !== "RollTable") return null;
        return doc;
    }

    static async _resolveItemSpecDoc(spec) {
        const s = getLegacyMappedRef(String(spec ?? "").trim());
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
            : (startingTable === "RollTable.BhHorosc3d6Q7mR4"
                ? [startingTable, "RollTable.BhHumors1d8Q7mRX"]
                : []);

        return {
            startingTable,
            preflightOnlyTables,
            contactTables: {
                roleTable: String(opts.contactTables?.roleTable ?? DEFAULT_CONTACT_TABLES.roleTable).trim(),
                flavorTable: String(opts.contactTables?.flavorTable ?? DEFAULT_CONTACT_TABLES.flavorTable).trim(),
                toneTable: String(opts.contactTables?.toneTable ?? DEFAULT_CONTACT_TABLES.toneTable).trim(),
                hookTable: String(opts.contactTables?.hookTable ?? DEFAULT_CONTACT_TABLES.hookTable).trim(),
                quirkTable: String(opts.contactTables?.quirkTable ?? DEFAULT_CONTACT_TABLES.quirkTable).trim()
            },
            bodyTable: String(opts.bodyTable ?? DEFAULT_BODY_TABLE).trim()
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
            { key: "bodyTable", label: "Body Table", ref: setup.bodyTable }
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
            setup.startingTable === "RollTable.BhHorosc3d6Q7mR4" &&
            setup.preflightOnlyTables.length === 2 &&
            setup.preflightOnlyTables.includes("RollTable.BhHumors1d8Q7mRX")
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

    static _managedRootFolder(folderName, documentType) {
        return game.folders.contents.find(f =>
            f.type === documentType &&
            f.name === folderName &&
            !f.folder
        ) ?? null;
    }

    static _managedFolderIds(rootFolder, documentType) {
        if (!rootFolder) return new Set();
        const folderIds = new Set([rootFolder.id]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const folder of game.folders.contents) {
                if (folder.type !== documentType) continue;
                const parentId = String(folder.folder?._id ?? folder.folder?.id ?? folder.folder ?? "");
                if (parentId && folderIds.has(parentId) && !folderIds.has(folder.id)) {
                    folderIds.add(folder.id);
                    changed = true;
                }
            }
        }
        return folderIds;
    }

    static _collectManagedDocuments(folderName, documentType, collection) {
        const rootFolder = SkillTreeChargenApp._managedRootFolder(folderName, documentType);
        const folderIds = SkillTreeChargenApp._managedFolderIds(rootFolder, documentType);
        if (!folderIds.size) {
            return {
                rootFolder: null,
                folderIds,
                documents: []
            };
        }

        const documents = collection.contents.filter(doc => {
            const folderId = String(doc.folder?._id ?? doc.folder?.id ?? doc.folder ?? "");
            return folderId && folderIds.has(folderId);
        });

        return {
            rootFolder,
            folderIds,
            documents
        };
    }

    static _isChargenTemplateItem(item) {
        const props = SkillTreeChargenApp._getTemplateProps(item);
        if (!props || typeof props !== "object") return false;
        return Object.keys(props).some(key =>
            key === "ChoiceTitle" ||
            key === "ChoiceText" ||
            key === "ChoiceCard" ||
            key === "ChoiceBio" ||
            key === "DeferredType" ||
            /^Effects[1-3]$/.test(key) ||
            /^Reward\d+/.test(key) ||
            /^Effect\d+Type$/.test(key)
        );
    }

    static async _validateInstallInterfaceRef(ref, source, report, catalog, opts = {}) {
        const value = String(ref ?? "").trim();
        if (!value) return null;

        const mapped = getLegacyMappedRef(value);
        const doc = await SkillTreeChargenApp._resolveRollTableRef(mapped);
        if (doc) return { ref: mapped, doc, registry: catalog.rolltablesByUuid.get(mapped) ?? null };

        const registryEntry = catalog.rolltablesByUuid.get(mapped) ?? null;
        const level = opts.level ?? (registryEntry && catalog.externalItemTableRefs.has(mapped) ? "warning" : "error");
        SkillTreeChargenApp._addIssue(
            report,
            level,
            opts.code ?? "missing-install-rolltable-interface",
            opts.message ?? `Missing RollTable interface "${mapped}" from ${source}.`,
            {
                source,
                ref: mapped,
                registryKnown: Boolean(registryEntry),
                tableType: registryEntry?.tableType ?? null
            }
        );
        return null;
    }

    static async _validateParsedInstallInterfaces(parsed, sourceMeta, report, catalog) {
        const source = `${sourceMeta.kind} "${sourceMeta.name}" (${sourceMeta.uuid})`;
        const iconPaths = [
            String(parsed?.choice?.icon ?? "").trim(),
            String(parsed?.deferred?.image ?? "").trim()
        ].filter(Boolean);

        for (const iconPath of iconPaths) {
            if (isPlaceholderImg(iconPath)) continue;
            const normalized = normalizeInterfacePath(iconPath);
            if (!catalog.cardsByPath.has(normalized)) {
                SkillTreeChargenApp._addIssue(
                    report,
                    "error",
                    "missing-card-interface",
                    `Card asset is not registered in cards/cards.js: ${iconPath}`,
                    { source, path: iconPath }
                );
            }
        }

        const rewardSources = parsed?.effectTables?.length
            ? parsed.effectTables.flatMap(tbl => tbl?.rows ?? [])
            : (parsed?.rewards ?? []);

        for (const reward of rewardSources) {
            const nextRef = String(reward?.next?.tableUuid ?? "").trim();
            if (nextRef) {
                await SkillTreeChargenApp._validateInstallInterfaceRef(
                    nextRef,
                    source,
                    report,
                    catalog,
                    {
                        code: "missing-next-rolltable",
                        message: `Missing next RollTable "${nextRef}" from ${source}.`,
                        level: "error"
                    }
                );
            }
        }

        const changeSources = parsed?.effectTables?.length
            ? parsed.effectTables.flatMap(tbl => (tbl?.rows ?? []).map(row => row?.change).filter(Boolean))
            : (parsed?.rewards ?? []).flatMap(reward => reward?.changes ?? []);

        for (const change of changeSources) {
            if (!change || typeof change !== "object") continue;

            if (change.type === "skill") {
                const targetKey = getLegacyMappedRef(String(change.targetKey ?? "").trim());
                if (!catalog.skillsByUuid.has(targetKey)) {
                    SkillTreeChargenApp._addIssue(
                        report,
                        "error",
                        "missing-skill-interface",
                        `Missing skill interface "${targetKey}" from ${source}.`,
                        { source, targetKey }
                    );
                }
                continue;
            }

            if (change.type === "maneuver") {
                const targetKey = getLegacyMappedRef(String(change.targetKey ?? "").trim());
                const doc = await SkillTreeChargenApp._resolveItemSpecDoc(targetKey);
                if (!doc) {
                    SkillTreeChargenApp._addIssue(
                        report,
                        "warning",
                        "missing-maneuver-interface",
                        `Missing maneuver item interface "${targetKey}" from ${source}.`,
                        { source, targetKey }
                    );
                }
                continue;
            }

            if (change.type === "bio") {
                const ref = String(change.roll?.tableUuid ?? "").trim();
                if (ref) {
                    await SkillTreeChargenApp._validateInstallInterfaceRef(
                        ref,
                        source,
                        report,
                        catalog,
                        {
                            code: "missing-bio-rolltable",
                            message: `Missing biography RollTable "${ref}" from ${source}.`,
                            level: "error"
                        }
                    );
                }
                continue;
            }

            if (change.type === "item") {
                const itemUuid = getLegacyMappedRef(String(change.itemUuid ?? "").trim());
                const tableUuid = String(change.tableUuid ?? "").trim();

                if (itemUuid) {
                    const doc = await SkillTreeChargenApp._resolveItemSpecDoc(itemUuid);
                    if (!doc) {
                        SkillTreeChargenApp._addIssue(
                            report,
                            "warning",
                            "missing-item-interface",
                            `Missing item interface "${itemUuid}" from ${source}.`,
                            { source, itemUuid }
                        );
                    }
                }

                if (tableUuid) {
                    const mappedTableUuid = getLegacyMappedRef(tableUuid);
                    const registryEntry = catalog.rolltablesByUuid.get(mappedTableUuid) ?? null;
                    await SkillTreeChargenApp._validateInstallInterfaceRef(
                        mappedTableUuid,
                        source,
                        report,
                        catalog,
                        {
                            code: "missing-item-rolltable-interface",
                            message: `Missing item RollTable interface "${mappedTableUuid}" from ${source}.`,
                            level: registryEntry && catalog.externalItemTableRefs.has(mappedTableUuid) ? "warning" : "error"
                        }
                    );
                }
            }
        }
    }

    static async validateInstallInterfaces(opts = {}) {
        const settings = getChargenSettings();
        const rootFolderName = String(opts.rootFolderName ?? settings.contentFolderName).trim() || settings.contentFolderName;
        const catalog = buildChargenInterfaceCatalog();
        const report = {
            ok: false,
            checkedAt: new Date().toISOString(),
            rootFolderName,
            summary: {
                managedItems: 0,
                managedRolltables: 0
            },
            errors: [],
            warnings: []
        };

        const managedTables = SkillTreeChargenApp._collectManagedDocuments(rootFolderName, "RollTable", game.tables);
        const managedItems = SkillTreeChargenApp._collectManagedDocuments(rootFolderName, "Item", game.items);

        report.summary.managedRolltables = managedTables.documents.length;
        report.summary.managedItems = managedItems.documents.length;

        if (!managedTables.rootFolder) {
            SkillTreeChargenApp._addIssue(
                report,
                "warning",
                "missing-managed-rolltable-root",
                `Managed RollTable folder "${rootFolderName}" was not found.`
            );
        }

        if (!managedItems.rootFolder) {
            SkillTreeChargenApp._addIssue(
                report,
                "warning",
                "missing-managed-item-root",
                `Managed Item folder "${rootFolderName}" was not found.`
            );
        }

        for (const table of managedTables.documents) {
            const validation = await SkillTreeChargenApp.validateTableJSON(table.uuid);
            if (!validation.ok) {
                for (const bad of validation.bad) {
                    SkillTreeChargenApp._addIssue(
                        report,
                        "error",
                        "invalid-managed-rolltable-result",
                        `Invalid RollTable result in "${table.name}" (${table.uuid}).`,
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

            for (const result of table.results.contents) {
                const raw = SkillTreeChargenApp._resultRawJSON(result);
                const linkedItem = await SkillTreeChargenApp._resolveItemFromRollResult(result);
                if (!linkedItem && !SkillTreeChargenApp._looksLikeRewardJsonResult(raw)) {
                    continue;
                }
                try {
                    const parsed = await SkillTreeChargenApp.parseRollTableResult(result, table.name);
                    await SkillTreeChargenApp._validateParsedInstallInterfaces(
                        parsed,
                        { kind: "RollTable", name: table.name, uuid: table.uuid },
                        report,
                        catalog
                    );
                } catch (err) {
                    SkillTreeChargenApp._addIssue(
                        report,
                        "error",
                        "unparseable-managed-rolltable-result",
                        `Could not parse RollTable result in "${table.name}" (${table.uuid}).`,
                        {
                            tableUuid: table.uuid,
                            tableName: table.name,
                            detail: err?.message ?? String(err)
                        }
                    );
                }
            }
        }

        for (const item of managedItems.documents) {
            if (!SkillTreeChargenApp._isChargenTemplateItem(item)) continue;
            try {
                const parsed = SkillTreeChargenApp._parseTemplateItemToChoiceData(item, item.name);
                await SkillTreeChargenApp._validateParsedInstallInterfaces(
                    parsed,
                    { kind: "Item", name: item.name, uuid: item.uuid },
                    report,
                    catalog
                );
            } catch (err) {
                SkillTreeChargenApp._addIssue(
                    report,
                    "error",
                    "invalid-managed-item-template",
                    `Could not parse managed item "${item.name}" (${item.uuid}).`,
                    {
                        itemUuid: item.uuid,
                        itemName: item.name,
                        detail: err?.message ?? String(err)
                    }
                );
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
        const setup = preflight.setup ?? this._normalizeSetupTables(mergedOpts);

        const identity = opts.identity?.name
            ? {
                name: String(opts.identity.name).trim(),
                nativeLanguage: String(opts.identity.nativeLanguage ?? "").trim()
            }
            : await this._promptForIdentity();
        if (!identity?.name) return;
        const name = identity.name;

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
        const app = new SkillTreeChargenApp(actor, {
            simulation: opts.simulation ?? null
        });
        await app._ensureLanguage(identity.nativeLanguage, { readWrite: false });
        await actor.setFlag("world", "chargenNativeLanguage", String(identity.nativeLanguage ?? "").trim());
       // Run once per actor at the start of chargen
        const startingTable =
            mergedOpts.startingTable;

        const choices = mergedOpts.choices ?? 2;
        const maxRolls = mergedOpts.maxRolls ?? 14;

        const contactTables = {
            roleTable: setup.contactTables?.roleTable,
            flavorTable: setup.contactTables?.flavorTable,
            toneTable: setup.contactTables?.toneTable,
            hookTable: setup.contactTables?.hookTable,
            quirkTable: setup.contactTables?.quirkTable
        };
        const bodyTable = setup.bodyTable;

        const run = {
            startingTable,
            tableUuid: startingTable,
            choices,
            remainingGlobal: maxRolls,
            bio: [],
            bioEvents: [],
            history: [],
            luckyStreak: false,
            contactTables,
            bodyTable,
            cards: [],
            deferredQueue: [],
            deferredReady: [],
            packageProgress: {}
        };
        if (!actor.getFlag("world", "baselineStatsApplied")) {
            for (const s of PRIMARY_STATS) {
                await advanceStat(actor, s, 1); // +1 step: 1d6+0 â†’ 1d6+1
            }

            await actor.setFlag("world", "baselineStatsApplied", true);
        }
        if (!actor.getFlag("world", "baselineMinZeroSkillsApplied")) {
            const baselineSkills = await app._getBaselineMinZeroSkills();
            const baselineGrantResults = [];
            for (const skillUuid of baselineSkills) {
                baselineGrantResults.push(
                    await app._grantBaselineSkill(skillUuid)
                );
            }

            const baselineValidation = await app._validateBaselineMinZeroSkillsProvisioning(baselineGrantResults);
            if (baselineValidation.ok) {
                await actor.setFlag("world", "baselineMinZeroSkillsApplied", true);
            } else {
                console.warn("Chargen: baseline min-zero skills were not fully provisioned at level 0.", baselineValidation);
                ui.notifications?.warn?.("Some default skills were not provisioned at level 0. See console for details.");
            }
        }
        if (!actor.getFlag("world", "baselineStartingManeuversApplied")) {
            await app._grantStartingManeuvers();
            await actor.setFlag("world", "baselineStartingManeuversApplied", true);
        }
        await app._maybeGrantCareerLiteracy(run, startingTable);
        run.cards = await app._rollCards(run);

        await app._setState({
            setup: { startingTable, choices, maxRolls, contactTables, bodyTable },
            run
        });

        if (opts.render !== false) {
            app.render(true);
        }
        return app;
    }

    static _defaultSimulationIdentity(index = 0) {
        return {
            name: `Simulated Character ${index + 1}`,
            nativeLanguage: "Common Tongue"
        };
    }

    static _summarizeSimulationOutcomes(outcomes = []) {
        const list = Array.isArray(outcomes) ? outcomes.filter(Boolean) : [];
        const totalRuns = list.length;
        const withDrive = list.filter(o => Number(o.driveCount ?? 0) >= 1).length;
        const withTwoDrives = list.filter(o => Number(o.driveCount ?? 0) >= 2).length;
        const withCareer = list.filter(o => Number(o.careerCardsSeen ?? 0) >= 1).length;
        const careerEndedPrematurely = list.filter(o => o.careerEndedPrematurely).length;
        const avgDrives = totalRuns ? (list.reduce((sum, o) => sum + Number(o.driveCount ?? 0), 0) / totalRuns) : 0;
        const avgCareerCards = withCareer
            ? (list.filter(o => Number(o.careerCardsSeen ?? 0) >= 1).reduce((sum, o) => sum + Number(o.careerCardsSeen ?? 0), 0) / withCareer)
            : 0;

        const terminalCards = new Map();
        const driveCategories = new Map();
        const effectRolls = new Map();

        for (const outcome of list) {
            const terminalKey = String(outcome.terminalCareerChoiceTitle ?? "").trim();
            if (terminalKey) {
                terminalCards.set(terminalKey, (terminalCards.get(terminalKey) ?? 0) + 1);
            }

            for (const category of outcome.driveCategories ?? []) {
                const key = String(category ?? "").trim();
                if (!key) continue;
                driveCategories.set(key, (driveCategories.get(key) ?? 0) + 1);
            }

            for (const effect of outcome.effectRolls ?? []) {
                const key = `${effect.choiceTitle} | Effects${effect.tableIndex} | Row ${effect.rowIndex + 1} | ${effect.type || "unknown"}${effect.targetKey ? ` | ${effect.targetKey}` : ""}`;
                effectRolls.set(key, (effectRolls.get(key) ?? 0) + 1);
            }
        }

        const topTerminalCards = Array.from(terminalCards.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([choiceTitle, count]) => ({ choiceTitle, count }));

        const topDriveCategories = Array.from(driveCategories.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([category, count]) => ({ category, count }));

        const topEffectRolls = Array.from(effectRolls.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([effect, count]) => ({ effect, count }));

        return {
            totalRuns,
            withDrive,
            withTwoDrives,
            withCareer,
            careerEndedPrematurely,
            driveRate: totalRuns ? withDrive / totalRuns : 0,
            twoDriveRate: totalRuns ? withTwoDrives / totalRuns : 0,
            prematureCareerEndRate: withCareer ? careerEndedPrematurely / withCareer : 0,
            avgDrives,
            avgCareerCards,
            topTerminalCards,
            topDriveCategories,
            topEffectRolls
        };
    }

    static async runBatchSimulation(opts = {}) {
        const count = Math.max(1, Number(opts.count ?? 100) || 100);
        const cleanupActors = opts.cleanupActors !== false;
        const render = opts.render === true;
        const results = [];
        const failures = [];

        for (let i = 0; i < count; i += 1) {
            let app = null;
            try {
                app = await this.open({
                    ...opts,
                    identity: opts.identityFactory
                        ? await opts.identityFactory(i)
                        : this._defaultSimulationIdentity(i),
                    render,
                    simulation: {
                        enabled: true,
                        runIndex: i,
                        suppressChat: true,
                        suppressNotifications: true,
                        ...(opts.simulation ?? {})
                    }
                });

                if (!app) {
                    failures.push({ runIndex: i, error: "Simulation failed to initialize." });
                    continue;
                }

                const outcome = await app.runSimulationToCompletion();
                results.push(outcome);
            } catch (err) {
                failures.push({
                    runIndex: i,
                    error: err?.message ?? String(err)
                });
                console.error(`Chargen batch simulation failed on run ${i + 1}:`, err);
            } finally {
                const actor = app?.actor ?? null;
                if (cleanupActors && actor) {
                    await actor.delete().catch((err) => {
                        console.warn("Failed to delete simulation actor:", actor?.name, err);
                    });
                }
            }
        }

        const summary = this._summarizeSimulationOutcomes(results);
        console.group(`SkillTreeChargen.simulate: ${summary.totalRuns} run(s)`);
        console.log("Summary:", summary);
        if (summary.topTerminalCards.length) console.table(summary.topTerminalCards);
        if (summary.topDriveCategories.length) console.table(summary.topDriveCategories);
        if (summary.topEffectRolls.length) console.table(summary.topEffectRolls);
        if (failures.length) console.table(failures);
        console.groupEnd();

        return {
            summary,
            outcomes: results,
            failures
        };
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

        if (type === "contact") {
            if (ch.text != null && typeof ch.text !== "string") {
                throw new Error(`Contact change "text" must be a string in "${tableName}" (rewards[${rewardIdx}].changes[${changeIdx}]).`);
            }
            return;
        }

        if (type === "body") {
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

        if (parsed.deferred != null) {
            if (!SkillTreeChargenApp._isObject(parsed.deferred)) {
                throw new Error(`deferred must be an object in "${tableName}".`);
            }
            SkillTreeChargenApp._requireString(parsed.deferred.type, `deferred.type must be a non-empty string in "${tableName}".`);
            if (parsed.deferred.origin != null && typeof parsed.deferred.origin !== "string") {
                throw new Error(`deferred.origin must be a string in "${tableName}".`);
            }
            if (parsed.deferred.delay != null && typeof parsed.deferred.delay !== "string") {
                throw new Error(`deferred.delay must be a string in "${tableName}".`);
            }
            if (parsed.deferred.image != null && typeof parsed.deferred.image !== "string") {
                throw new Error(`deferred.image must be a string in "${tableName}".`);
            }
            if (parsed.deferred.stage != null && !SkillTreeChargenApp._isFiniteNumber(parsed.deferred.stage)) {
                throw new Error(`deferred.stage must be numeric in "${tableName}".`);
            }
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
                if (rw.transitionMode != null && String(rw.transitionMode).trim() !== "") {
                    const mode = String(rw.transitionMode).trim().toLowerCase();
                    if (mode !== "forced" && mode !== "optional") {
                        throw new Error(`rewards[${rewardIdx}].transitionMode must be "forced" or "optional" in "${tableName}".`);
                    }
                }
                if (rw.transitionPrompt != null && typeof rw.transitionPrompt !== "string") {
                    throw new Error(`rewards[${rewardIdx}].transitionPrompt must be a string in "${tableName}".`);
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
                    if (row.transitionText != null && typeof row.transitionText !== "string") {
                        throw new Error(`effectTables[${tableIdx}].rows[${rowIdx}].transitionText must be a string in "${tableName}".`);
                    }
                    if (row.transitionMode != null && String(row.transitionMode).trim() !== "") {
                        const mode = String(row.transitionMode).trim().toLowerCase();
                        if (mode !== "forced" && mode !== "optional") {
                            throw new Error(`effectTables[${tableIdx}].rows[${rowIdx}].transitionMode must be "forced" or "optional" in "${tableName}".`);
                        }
                    }
                    if (row.transitionPrompt != null && typeof row.transitionPrompt !== "string") {
                        throw new Error(`effectTables[${tableIdx}].rows[${rowIdx}].transitionPrompt must be a string in "${tableName}".`);
                    }
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

            if (!linkedItem && !SkillTreeChargenApp._looksLikeRewardJsonResult(raw)) {
                skipped.push({
                    id: r.id,
                    range: r.range,
                    reason: "Plain-text support result",
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
        const visitedCareerStageKeys = new Set();
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

            const folderName = String(table?.folder?.name ?? "").trim().toLowerCase();
            if (folderName.startsWith("career-") || folderName.startsWith("advanced-")) {
                const stageKey = String(
                    foundry.utils.getProperty(table, "flags.chargen1547_v2.entryKey") ?? ""
                ).trim() || folderName;
                if (stageKey) visitedCareerStageKeys.add(stageKey);
            }

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

        const packageRegistry = game.settings.get("chargen1547_v2", "packageRegistry") ?? {};
        const KNOWN_PACKAGE_GAIN_TYPES = new Set(["stat", "skill", "maneuver", "money", "item", "luck", "contact", "body", "social", "drive", "bio", "language"]);
        for (const stageKey of visitedCareerStageKeys) {
            const packages = Array.isArray(packageRegistry[stageKey]) ? packageRegistry[stageKey] : [];
            if (!packages.length) {
                SkillTreeChargenApp._addIssue(
                    report,
                    "warning",
                    "stage-missing-packages",
                    `Career/advanced stage "${stageKey}" has no packages.json (deterministic gains will be skipped).`,
                    { stageKey }
                );
                continue;
            }
            for (const [i, pkg] of packages.entries()) {
                const gainType = String(pkg?.gain?.type ?? "").trim().toLowerCase();
                if (!gainType) {
                    SkillTreeChargenApp._addIssue(
                        report,
                        "error",
                        "package-missing-gain-type",
                        `Package ${i} for stage "${stageKey}" has no gain.type.`,
                        { stageKey, packageIndex: i }
                    );
                } else if (!KNOWN_PACKAGE_GAIN_TYPES.has(gainType)) {
                    SkillTreeChargenApp._addIssue(
                        report,
                        "warning",
                        "package-unknown-gain-type",
                        `Package ${i} for stage "${stageKey}" has unknown gain.type "${gainType}".`,
                        { stageKey, packageIndex: i, gainType }
                    );
                }
            }
        }
        for (const stageKey of Object.keys(packageRegistry)) {
            if (visitedCareerStageKeys.has(stageKey)) continue;
            SkillTreeChargenApp._addIssue(
                report,
                "warning",
                "orphan-package-stage",
                `packages.json declares stage "${stageKey}" but no reachable career/advanced table matches it.`,
                { stageKey }
            );
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


    static async _promptForIdentity() {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            const content = `
        <div class="chargen-dialog">
          <div class="chargen-dialog__eyebrow">First Chapter</div>
          <h2 class="chargen-dialog__title">Create New Character</h2>
          <p class="chargen-dialog__copy">Set the name by which the world knows this person, and the language they first learned at home.</p>
          <form class="chargen-dialog__section">
            <div class="chargen-dialog__field">
              <label>Character Name</label>
              <input type="text" name="name" placeholder="Enter a name..." autofocus />
            </div>
            <div class="chargen-dialog__field">
              <label>Native Language</label>
              <input type="text" name="nativeLanguage" placeholder="Enter a native language..." />
              <div class="chargen-dialog__hint">This language will be added to the actor at the start of creation.</div>
            </div>
          </form>
        </div>
      `;

            new Dialog({
                title: "Create New Character",
                content,
                buttons: {
                    create: {
                        label: "Create",
                        callback: (html) => {
                            const name = String(html.find("input[name='name']").val() ?? "").trim();
                            const nativeLanguage = String(html.find("input[name='nativeLanguage']").val() ?? "").trim();
                            finish(name ? { name, nativeLanguage } : null);
                        }
                    },
                    cancel: { label: "Cancel", callback: () => finish(null) }
                },
                default: "create",
                close: () => finish(null)
            }, { width: 480, classes: ["skilltree-chargen-dialog"] }).render(true);
        });
    }

    constructor(actor, options = {}) {
        super({}, options);
        this.actor = actor;
        this._actionInFlight = false;
        this._simulation = options.simulation ?? null;
    }

    /* ---------------- State helpers ---------------- */

    _flagPath() { return "flags.chargen1547_v2.chargen"; }

    _getState() {
        return foundry.utils.getProperty(this.actor, this._flagPath()) ?? {
            setup: { startingTable: "", choices: 2, maxRolls: 14 },
            run: null
        };
    }

    async _setState(next) {
        await this.actor.update({ [this._flagPath()]: next });
    }

    _isSetupMode(state) {
        return !state.run;
    }

    _simulationEnabled() {
        return Boolean(this._simulation?.enabled);
    }

    _simulationOption(key, fallback = null) {
        if (!this._simulationEnabled()) return fallback;
        return this._simulation?.[key] ?? fallback;
    }

    _shouldRenderInteractiveUi() {
        return !this._simulationEnabled() || Boolean(this._simulationOption("render", false));
    }

    _randomChoice(list = []) {
        if (!Array.isArray(list) || !list.length) return null;
        return list[Math.floor(Math.random() * list.length)] ?? null;
    }

    _normalizeSkillTreeEntryName(value, fallback = "") {
        if (typeof value === "string") return value.trim();
        if (value && typeof value === "object") {
            const scopeName = String(value?.scope?.name ?? "").trim();
            if (scopeName) return scopeName;
            const name = String(value?.name ?? "").trim();
            if (name) return name;
            const uuid = String(value?.scope?.uuid ?? value?.uuid ?? "").trim();
            if (uuid) return uuid;
        }
        return String(fallback ?? "").trim();
    }

    _generateSimulationDriveText(category) {
        const label = String(category ?? "Conviction").trim() || "Conviction";
        const lower = label.toLowerCase();
        return `I will live by ${lower} when the next hard choice comes.`;
    }

    _getDriveLinesFromActor() {
        const raw = String(this.actor.system?.props?.Drives ?? "").trim();
        return raw
            ? raw.split("\n").map(line => line.trim()).filter(Boolean)
            : [];
    }

    _buildSimulationOutcome(run) {
        const history = Array.isArray(run?.history) ? run.history : [];
        const driveLines = this._getDriveLinesFromActor();
        const driveCategories = driveLines
            .map(line => /^\[(.+?)\]/.exec(line)?.[1] ?? "")
            .filter(Boolean);
        const careerHistory = history.filter(entry => entry?.fromIsCareerAdvancementTable);
        const terminalCareerEntry = careerHistory.find(entry => entry?.terminal);

        return {
            actorName: this.actor.name,
            totalChoices: history.length,
            driveCount: driveLines.length,
            driveCategories,
            careerCardsSeen: careerHistory.length,
            careerEndedPrematurely: Boolean(terminalCareerEntry),
            terminalCareerTable: terminalCareerEntry?.fromName ?? "",
            terminalCareerChoiceTitle: terminalCareerEntry?.choiceTitle ?? "",
            bioEntries: Array.isArray(run?.bio) ? run.bio.length : 0,
            remainingGlobal: Number(run?.remainingGlobal ?? 0),
            finalTableUuid: String(run?.tableUuid ?? "").trim(),
            effectRolls: history.flatMap(entry =>
                Array.isArray(entry?.rewardApplied?.chosenEffects)
                    ? entry.rewardApplied.chosenEffects.map(effect => ({
                        choiceTitle: String(entry.choiceTitle ?? "").trim(),
                        tableIndex: Number(effect.tableIndex ?? 0),
                        rowIndex: Number(effect.rowIndex ?? -1),
                        type: String(effect.type ?? "").trim(),
                        targetKey: String(effect.targetKey ?? "").trim(),
                        nextTableUuid: String(effect.nextTableUuid ?? "").trim()
                    }))
                    : []
            )
        };
    }

    async runSimulationToCompletion() {
        if (!this._simulationEnabled()) {
            throw new Error("Simulation mode is not enabled for this chargen app.");
        }

        const maxSteps = Math.max(25, Number(this._simulationOption("maxSteps", 250)) || 250);

        for (let step = 0; step < maxSteps; step += 1) {
            const state = this._getState();
            const run = state.run;

            if (!run) {
                return this._simulation?.lastOutcome ?? null;
            }

            if (run.reveal) {
                await this._onContinue();
                continue;
            }

            if (!Array.isArray(run.cards) || run.cards.length === 0) {
                await this._finishWithSummary(run);
                continue;
            }

            const index = Math.max(0, Number(this._simulationOption("pickCardIndex", NaN)));
            const chosenIndex = Number.isFinite(index) && index < run.cards.length
                ? index
                : Math.floor(Math.random() * run.cards.length);

            if (run.cards[chosenIndex]?.masked) {
                await this._onChoose(chosenIndex);
            }
            await this._onChoose(chosenIndex);
        }

        throw new Error(`Simulation exceeded safety limit of ${maxSteps} steps.`);
    }

    /* ---------------- Foundry helpers ---------------- */

    async _getRollTable(uuidOrId) {
        if (!uuidOrId) return null;
        const ref = getLegacyMappedRef(String(uuidOrId).trim());

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

        if (SPECIAL_BIO_TABLES[type]) {
            return { type: "bio", roll: { tableUuid: SPECIAL_BIO_TABLES[type] } };
        }
        if (SPECIAL_ITEM_TABLES[type]) {
            const out = { type: "item", tableUuid: SPECIAL_ITEM_TABLES[type] };
            if (qty != null) out.qty = qty;
            return out;
        }

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

        if (type === "contact") {
            if (text) ch.text = text;
            return ch;
        }

        // body currently carries no additional fields
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
        const targetText = String(row?.TargetText ?? "").trim();
        const amountNum = SkillTreeChargenApp._numberOrNull(amountRaw);
        const ch = { type };

        if (SPECIAL_BIO_TABLES[type]) {
            return { type: "bio", roll: { tableUuid: SPECIAL_BIO_TABLES[type] } };
        }
        if (SPECIAL_ITEM_TABLES[type]) {
            const out = { type: "item", tableUuid: SPECIAL_ITEM_TABLES[type] };
            if (amountNum != null) out.qty = amountNum;
            return out;
        }

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
        if (type === "contact") {
            if (targetText) ch.text = targetText;
            return ch;
        }
        if (type === "body") return ch;
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
            if (targetKey.startsWith("RollTable.")) ch.tableUuid = targetKey;
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
            const transitionText = String(row?.TransitionText ?? "").trim();
            const transitionMode = String(row?.TransitionMode ?? "").trim().toLowerCase();
            const transitionPrompt = String(row?.TransitionPrompt ?? "").trim();
            return {
                rowIndex: idx,
                weight,
                change: SkillTreeChargenApp._buildChangeFromEffectRow(row),
                next: nextTableUuid ? { tableUuid: nextTableUuid } : null,
                transitionText,
                transitionMode,
                transitionPrompt,
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
        const deferredType = String(props.DeferredType ?? "").trim().toLowerCase();
        const deferredOrigin = String(props.DeferredOrigin ?? "").trim();
        const deferredDelay = String(props.DeferredDelay ?? "").trim();
        const deferredImage = String(props.DeferredImage ?? "").trim();
        const deferredStage = SkillTreeChargenApp._numberOrNull(props.DeferredStage);
        const deferred = deferredType
            ? {
                type: deferredType,
                origin: deferredOrigin,
                delay: deferredDelay || "1d6",
                image: deferredImage || icon,
                stage: deferredStage == null ? 1 : deferredStage
            }
            : null;

        const effectTables = ["Effects1", "Effects2", "Effects3"]
            .map(key => SkillTreeChargenApp._buildEffectTableFromProps(props, key))
            .filter(Boolean);

        if (effectTables.length) {
            const parsed = {
                choice: { title, text, icon, tags },
                bio,
                deferred,
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
                    changes,
                    transitionMode: String(props[`${prefix}TransitionMode`] ?? "").trim().toLowerCase(),
                    transitionPrompt: String(props[`${prefix}TransitionPrompt`] ?? "").trim()
                };
                if (nextTableUuid) rw.next = { tableUuid: nextTableUuid };
                rewards.push(rw);
            }
        }

        const parsed = {
            choice: { title, text, icon, tags },
            bio,
            deferred,
            rewards
        };
        SkillTreeChargenApp._validateParsedResultSchema(parsed, tableName);
        return parsed;
    }

    static _tableStageType(table = null) {
        return String(
            foundry.utils.getProperty(table, "flags.chargen1547_v2.stageType") ?? ""
        ).trim().toLowerCase();
    }

    static _cardHintBadge(label, tone, detail) {
        return { label, tone, detail };
    }

    static _looksLikeRewardJsonResult(rawText = "") {
        const raw = String(rawText ?? "").trim();
        if (!raw) return false;
        if (raw.startsWith("{")) return true;
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        return start !== -1 && end !== -1 && end > start;
    }

    _inferChoiceHintBadges(choiceData, currentTable = null) {
        const badges = [];
        const tags = Array.isArray(choiceData?.choice?.tags)
            ? choiceData.choice.tags.map(tag => String(tag ?? "").trim().toLowerCase()).filter(Boolean)
            : [];
        const effectTables = Array.isArray(choiceData?.effectTables) ? choiceData.effectTables : [];
        const rewardRows = Array.isArray(choiceData?.rewards)
            ? choiceData.rewards.map((reward, idx) => ({
                rowIndex: idx,
                change: null,
                changes: Array.isArray(reward?.changes) ? reward.changes.filter(Boolean) : [],
                next: reward?.next ?? null
            }))
            : [];
        const rows = effectTables.length
            ? effectTables.flatMap(tbl => tbl?.rows ?? [])
            : rewardRows;
        const changes = rows.flatMap(row => {
            if (Array.isArray(row?.changes) && row.changes.length) return row.changes;
            return row?.change ? [row.change] : [];
        }).filter(Boolean);
        const tableName = String(currentTable?.name ?? "").trim();
        const currentTableUuid = String(currentTable?.uuid ?? "").trim();
        const loweredTableName = tableName.toLowerCase();
        const tableStageType = SkillTreeChargenApp._tableStageType(currentTable);
        const isCareerStage = tableStageType === "career" || tableStageType === "advanced";
        const nextRefs = rows
            .map(row => String(row?.next?.tableUuid ?? "").trim())
            .filter(Boolean);
        const uniqueNextRefs = Array.from(new Set(nextRefs));
        const loweredNextRefs = uniqueNextRefs.map(ref => ref.toLowerCase());
        const deferred = choiceData?.deferred && typeof choiceData.deferred === "object" ? choiceData.deferred : null;
        const hasChangeType = (type) => changes.some(change => String(change?.type ?? "").trim().toLowerCase() === type);
        const matchesAnyNeedle = (needles = []) => {
            const haystacks = [loweredTableName, ...loweredNextRefs, ...tags];
            return needles.some(needle => haystacks.some(hay => hay.includes(needle)));
        };

        const addBadge = (label, tone, detail) => {
            if (badges.some(entry => entry.label === label)) return;
            badges.push(SkillTreeChargenApp._cardHintBadge(label, tone, detail));
        };

        const hasDriveChance = changes.some(change =>
            String(change?.type ?? "").trim().toLowerCase() === "drive"
            && String(change?.action ?? "add").trim().toLowerCase() === "add"
        );
        if (hasDriveChance) {
            addBadge("Emotional", "growth", "May define or deepen a personal drive.");
        }

        const hasStatusSignal = tags.includes("status")
            || hasChangeType("social");
        if (hasStatusSignal) {
            addBadge("Privileged", "status", "Often affects reputation, standing, or social position.");
        }

        const hasCareerDeadEnd = isCareerStage
            && rows.some(row => !String(row?.next?.tableUuid ?? "").trim());

        const hasRiskSignal = tags.includes("risk")
            || changes.some(change => {
                const type = String(change?.type ?? "").trim().toLowerCase();
                if (type === "body") return true;
                if (type === "social") return Number(change?.amount ?? 0) < 0;
                if (type === "bio") {
                    const rollRef = String(change?.roll?.tableUuid ?? "").trim().toLowerCase();
                    return rollRef.includes("secrets")
                        || rollRef.includes("suspicion")
                        || rollRef.includes("esteem");
                }
                return false;
            })
            || nextRefs.some(ref => {
                const lowered = ref.toLowerCase();
                return lowered.includes("suspicion") || lowered.includes("secrets");
            })
            || hasCareerDeadEnd;
        if (hasRiskSignal) {
            addBadge("Risky", "risk", "The outcome can bring fallout, loss, or lasting trouble.");
        }

        const shiftsAwayFromCurrent = isCareerStage && uniqueNextRefs.some(ref => ref !== currentTableUuid);
        if (shiftsAwayFromCurrent || (isCareerStage && uniqueNextRefs.length > 1)) {
            addBadge("Possibilities", "shift", "May redirect you into a different career path.");
        }

        if (hasChangeType("skill")) {
            addBadge("Training", "growth", "Often leads to practical training or increased competence.");
        }

        if (hasChangeType("maneuver")) {
            addBadge("Combat Training", "growth", "May unlock a combat technique or special move.");
        }

        if (hasChangeType("item")) {
            addBadge("Provision", "reward", "May yield gear, loot, or an equipment roll.");
        }

        if (hasChangeType("money")) {
            addBadge("Lucrative", "reward", "Can improve your finances or material footing.");
        }

        if (hasChangeType("stat")) {
            addBadge("Character", "growth", "Changes your core character or natural strengths.");
        }

        if (hasChangeType("body")) {
            addBadge("Rough", "risk", "May leave a physical mark or bodily consequence.");
        }

        if (hasChangeType("bio")) {
            addBadge("Memorable", "story", "This can add a narrative turn to your life story.");
        }

        if (changes.some(change =>
            String(change?.type ?? "").trim().toLowerCase() === "social"
            && Number(change?.amount ?? 0) < 0
        )) {
            addBadge("Unconventional", "warning", "One outcome can damage your standing or reputation.");
        }

        const likelyOpportunity = !hasRiskSignal
            && !deferred
            && !rows.some(row => !String(row?.next?.tableUuid ?? "").trim())
            && changes.some(change => {
                const type = String(change?.type ?? "").trim().toLowerCase();
                if (type === "skill" || type === "maneuver" || type === "item" || type === "money" || type === "luck") return true;
                if (type === "stat") return Number(change?.steps ?? 0) > 0;
                if (type === "social") return Number(change?.amount ?? 0) > 0;
                return false;
            });
        if (likelyOpportunity) {
            addBadge("Opportunity", "reward", "Mostly promises advancement, gain, or useful openings.");
        }

        if (matchesAnyNeedle(["career-infantry", "career-mercenary", "advanced-officer", "advanced-cavalry", "advanced-musketeer", "advanced-veteran", "war"])) {
            addBadge("War", "theme-war", "Pulls toward soldiering, campaigns, or martial hardship.");
        } else if (matchesAnyNeedle(["advanced-courtier", "advanced-knight", "court", "noble", "status"])) {
            addBadge("Court", "theme-court", "Leans toward rank, patronage, etiquette, or courtly maneuvering.");
        } else if (matchesAnyNeedle(["career-criminal", "advanced-assassin", "advanced-master-thief", "advanced-imprisoned", "crime", "smuggl", "underworld"])) {
            addBadge("Crime", "theme-crime", "Touches secrets, theft, smuggling, or the underworld.");
        } else if (matchesAnyNeedle(["advanced-occultist", "advanced-astrologer", "advanced-cunning-folk", "advanced-alchemist", "mystic", "occult", "astrolog"])) {
            addBadge("Mystic", "theme-mystic", "Hints at strange knowledge, omens, or occult entanglement.");
        } else if (matchesAnyNeedle(["career-religious", "advanced-inquisitioner", "faith", "relic", "saint", "pilgrim"])) {
            addBadge("Faith", "theme-faith", "Concerns devotion, doctrine, relics, or moral judgment.");
        } else if (matchesAnyNeedle(["career-sailor", "advanced-explorer", "career-merchant", "travel", "route", "border", "pilgrim"])) {
            addBadge("Travel", "theme-travel", "Leads toward roads, voyages, escorts, or uncertain passage.");
        }

        return badges.slice(0, 3);
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

    _getBiographyHtml() {
        return String(this.actor.system?.props?.Biography ?? "");
    }

    _getBioLines() {
        return this._getBiographyHtml()
            .replace(/<[^>]+>/g, "\n")
            .split("\n")
            .map(s => {
                let text = String(s ?? "").trim();
                if (!text) return "";

                // Normalize previously escaped rich-text content so repeated
                // biography appends do not accumulate &amp;#x27;-style artifacts.
                for (let i = 0; i < 4; i += 1) {
                    const next = foundry.utils.unescapeHTML(text).trim();
                    if (!next || next === text) break;
                    text = next;
                }
                return text;
            })
            .filter(Boolean);
    }

    _isBioStageHeading(text) {
        const t = String(text ?? "").trim();
        return /^(Birth|Childhood|Adolescence|Career|Advanced)\s+-\s+/.test(t);
    }

    _isBioMechanicalLine(text) {
        const t = String(text ?? "").trim();
        return /^(Baseline:|Improved |Learned |Received |Language |Social Status |Item:|Appearance:|Gained a contact:|Lucky streak:|Missed:|Language award|Language already known;|Career ended)/.test(t);
    }

    _escapeRegex(text) {
        return String(text ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    _renderBiographyBlock(text) {
        const t = String(text ?? "").trim();
        if (!t) return "";

        const escaped = foundry.utils.escapeHTML(t);
        if (this._isBioStageHeading(t)) {
            return "";
        }
        if (this._isBioMechanicalLine(t)) {
            return "";
        }
        return `<p class="cg-bio-entry">${escaped}</p>`;
    }

    _renderBiographyHtmlBlock(innerHtml) {
        const html = String(innerHtml ?? "").trim();
        if (!html) return "";
        return `<p class="cg-bio-entry">${html}</p>`;
    }

    _getStageLabelFromContext(context = {}) {
        const raw = String(context.stage ?? "").trim().toLowerCase();
        if (raw === "birth" || raw === "origin") return "Birth and Upbringing";
        if (raw === "childhood") return "Childhood";
        if (raw === "adolescence") return "Adolescence";
        if (raw === "career") return "Career";
        if (raw === "advanced") return "Later Life";
        if (raw === "deferred") return "What Returned";
        return "Life";
    }

    _getBioStageFromTable(table = null) {
        const flagged = SkillTreeChargenApp._tableStageType(table);
        if (flagged) return flagged;

        const folderName = String(table?.folder?.name ?? "").trim().toLowerCase();
        if (folderName.startsWith("birth-")) return "birth";
        if (folderName.startsWith("childhood-")) return "childhood";
        if (folderName.startsWith("adolescence-")) return "adolescence";
        if (folderName.startsWith("career-")) return "career";
        if (folderName.startsWith("advanced-")) return "advanced";
        return "";
    }

    _buildBioContext(run, table = null, card = null, extra = {}) {
        const choiceTitle = String(card?.data?.choice?.title ?? extra.choiceTitle ?? "").trim();
        const score = Array.isArray(card?.range) ? Number(card.range[0]) : Number(extra.score ?? NaN);
        const stage = this._getBioStageFromTable(table);
        return {
            stage,
            stageLabel: this._getStageLabelFromContext({ stage }),
            tableUuid: String(table?.uuid ?? run?.tableUuid ?? extra.tableUuid ?? "").trim(),
            tableName: String(table?.name ?? extra.tableName ?? "").trim(),
            choiceTitle,
            score: Number.isFinite(score) ? score : null,
            rare: Number.isFinite(score) ? (score <= 4 || score >= 17) : false,
            ...extra
        };
    }

    _normalizeBioSentence(text) {
        const value = String(text ?? "").trim();
        if (!value) return "";
        return /[.!?]$/.test(value) ? value : `${value}.`;
    }

    _isMemorableBioEvent(event = {}) {
        if (event.memorable) return true;
        if (event.rare) return true;

        const kind = String(event.kind ?? "").trim().toLowerCase();
        if (["body", "drive", "bio", "deferred", "rare-career", "transition"].includes(kind)) return true;

        if (kind === "money" && Math.abs(Number(event.amount ?? 0)) >= 50) return true;
        if (kind === "social" && Math.abs(Number(event.amount ?? 0)) >= 2) return true;
        if (kind === "transition" && String(event.toStage ?? "").trim().toLowerCase() === "advanced") return true;

        return false;
    }

    _buildCompiledBiography(events = []) {
        const memorable = (Array.isArray(events) ? events : [])
            .filter(event => this._isMemorableBioEvent(event));
        if (!memorable.length) return [];

        const grouped = new Map();
        for (const event of memorable) {
            const label = this._getStageLabelFromContext(event);
            if (!grouped.has(label)) grouped.set(label, []);
            grouped.get(label).push(event);
        }

        const intros = {
            "Birth and Upbringing": "Your earliest life was marked by",
            Childhood: "In youth,",
            Adolescence: "As you came of age,",
            Career: "Your working life was shaped by",
            "Later Life": "Later, your path was defined by",
            "What Returned": "What refused to stay buried was"
        };

        const paragraphs = [];
        for (const [label, items] of grouped.entries()) {
            const chosen = items
                .slice()
                .sort((a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0))
                .slice(0, 3);
            const intro = intros[label] ?? "In time,";
            const lines = chosen
                .map(event => this._normalizeBioSentence(event.summaryText || event.text))
                .filter(Boolean);
            if (!lines.length) continue;

            if (lines.length === 1) {
                paragraphs.push(`${intro} ${lines[0].charAt(0).toLowerCase()}${lines[0].slice(1)}`);
            } else {
                const [first, ...rest] = lines;
                paragraphs.push(`${intro} ${first.charAt(0).toLowerCase()}${first.slice(1)} ${rest.join(" ")}`);
            }
        }

        return paragraphs;
    }

    _renderCompiledBiographyHtml(events = []) {
        return this._buildCompiledBiography(events)
            .map(text => `<p class="cg-bio-entry">${foundry.utils.escapeHTML(String(text))}</p>`)
            .join("\n");
    }

    _formatDeferredBiographyText(text, sourceTitle = "") {
        const plain = String(text ?? "").trim();
        if (!plain) return "";

        const escaped = foundry.utils.escapeHTML(plain);
        const title = String(sourceTitle ?? "").trim();
        if (!title) return escaped;

        const escapedTitle = foundry.utils.escapeHTML(title);
        const pattern = new RegExp(this._escapeRegex(escapedTitle), "g");
        return escaped.replace(pattern, `<strong>${escapedTitle}</strong>`);
    }

    async _appendBiography(lineOrLines) {
        const add = Array.isArray(lineOrLines) ? lineOrLines : [lineOrLines];
        const baseHtml = this._getBioLines()
            .map(line => this._renderBiographyBlock(line))
            .filter(Boolean)
            .join("\n");
        const blocks = [];

        for (const line of add) {
            const t = String(line ?? "").trim();
            const block = this._renderBiographyBlock(t);
            if (block) blocks.push(block);
        }

        if (!blocks.length) return;

        const nextHtml = [baseHtml, ...blocks]
            .filter(Boolean)
            .join("\n");

        await this.actor.update({ "system.props.Biography": nextHtml });
    }

    async _appendBiographyHtmlBlock(innerHtml) {
        const baseHtml = this._getBioLines()
            .map(line => this._renderBiographyBlock(line))
            .filter(Boolean)
            .join("\n");
        const block = this._renderBiographyHtmlBlock(innerHtml);
        if (!block) return;

        const nextHtml = [baseHtml, block]
            .filter(Boolean)
            .join("\n");

        await this.actor.update({ "system.props.Biography": nextHtml });
    }

    async _addBio(run, text, meta = {}) {
        if (!text) return;
        const line = String(text);
        run.bio.push(line);
        const context = run?._bioContext && typeof run._bioContext === "object" ? run._bioContext : {};
        const event = {
            text: line,
            summaryText: String(meta.summaryText ?? "").trim() || line,
            kind: String(meta.kind ?? context.kind ?? "").trim(),
            stage: String(meta.stage ?? context.stage ?? "").trim(),
            stageLabel: this._getStageLabelFromContext({ stage: meta.stage ?? context.stage }),
            tableUuid: String(meta.tableUuid ?? context.tableUuid ?? "").trim(),
            tableName: String(meta.tableName ?? context.tableName ?? "").trim(),
            choiceTitle: String(meta.choiceTitle ?? context.choiceTitle ?? "").trim(),
            score: Number.isFinite(Number(meta.score ?? context.score)) ? Number(meta.score ?? context.score) : null,
            rare: Boolean(meta.rare ?? context.rare),
            memorable: Boolean(meta.memorable),
            priority: Number(meta.priority ?? 0),
            amount: Number.isFinite(Number(meta.amount)) ? Number(meta.amount) : null,
            toStage: String(meta.toStage ?? "").trim(),
            toTableName: String(meta.toTableName ?? "").trim()
        };
        if (Array.isArray(run.bioEvents)) run.bioEvents.push(event);
        const block = this._renderBiographyBlock(line);
        if (block) {
            await this._appendBiography(line);
        }
    }

    /* ---------------- SkillTree hook ---------------- */

    _getPropNumber(key) {
        const raw = this.actor.system?.props?.[key];
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
    }

    _isCareerAdvancementTable(table) {
        const folderName = String(table?.folder?.name ?? "").trim().toLowerCase();
        return folderName.startsWith("career-") || folderName.startsWith("advanced-");
    }

    _currentStageKey(table) {
        if (!table) return "";
        const flagKey = String(
            foundry.utils.getProperty(table, "flags.chargen1547_v2.entryKey") ?? ""
        ).trim();
        if (flagKey) return flagKey;
        return String(table?.folder?.name ?? "").trim().toLowerCase();
    }

    _getNextPackageInfo(run, table) {
        if (!run || !this._isCareerAdvancementTable(table)) return null;
        const stageKey = this._currentStageKey(table);
        if (!stageKey) return null;
        const packages = getPackagesForStage(stageKey);
        if (!packages.length) return null;
        const claimed = Number(run?.packageProgress?.[stageKey] ?? 0);
        if (claimed >= packages.length) return null;
        return { stageKey, index: claimed, package: packages[claimed], total: packages.length };
    }

    async _getSkillTreeGraphData() {
        const st = globalThis.SkillTree;
        if (!st) return null;

        if (typeof st.getGraphData === "function") {
            const graphData = await st.getGraphData();
            if (graphData) return graphData;
        }

        if (typeof st.exportGraphData === "function" && st?.NODES instanceof Map) {
            try {
                return st.exportGraphData({ nodes: st.NODES });
            } catch (_err) {
                // Fall through to legacy behavior.
            }
        }

        return st?.NODES ?? null;
    }

    async _ensureSkillTreeActorRefs(graphData) {
        const st = globalThis.SkillTree;
        if (typeof st?.ensureActorNodeRefs !== "function" || !graphData) return;
        await st.ensureActorNodeRefs(this.actor, graphData);
    }

    async _listAvailableNodeIncreases(kinds) {
        const st = globalThis.SkillTree;
        if (typeof st?.listAvailableNodeIncreases !== "function") return [];
        const graphData = await this._getSkillTreeGraphData();
        await this._ensureSkillTreeActorRefs(graphData);
        const requested = Array.isArray(kinds) ? kinds : [kinds];
        const result = await st.listAvailableNodeIncreases(this.actor, {
            kind: requested.length === 1 ? requested[0] : requested,
            kinds: requested,
            graphData
        });
        return Array.isArray(result)
            ? result.map(entry => ({
                ...entry,
                name: this._normalizeSkillTreeEntryName(entry?.name, entry?.nodeId)
            }))
            : [];
    }

    async _promptCareerAdvancementStatPick(title, picksRemaining) {
        if (this._simulationEnabled()) {
            return this._randomChoice(PRIMARY_STATS);
        }
        const statChoices = PRIMARY_STATS
            .map((stat, idx) => `
                <label class="chargen-dialog__choice">
                  <input type="radio" name="careerStatPick" value="${foundry.utils.escapeHTML(stat)}" ${idx === 0 ? "checked" : ""}>
                  <span class="chargen-dialog__choice-body">
                    <span class="chargen-dialog__choice-mark"></span>
                    <span>
                      <span class="chargen-dialog__choice-title">${foundry.utils.escapeHTML(stat)}</span>
                      <span class="chargen-dialog__choice-meta">Increase ${foundry.utils.escapeHTML(stat)} by one step.</span>
                    </span>
                  </span>
                </label>
            `)
            .join("");

        return await new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            new Dialog({
                title: "Career Advancement",
                content: `
                  <div class="chargen-dialog">
                    <div class="chargen-dialog__eyebrow">Advancement</div>
                    <h2 class="chargen-dialog__title">${foundry.utils.escapeHTML(title)}</h2>
                    <p class="chargen-dialog__copy">${picksRemaining} stat increase${picksRemaining === 1 ? "" : "s"} remaining.</p>
                    <div class="chargen-dialog__choice-list">${statChoices}</div>
                  </div>
                `,
                buttons: {
                    apply: {
                        label: "Apply",
                        callback: (html) => {
                            const value = String(html[0]?.querySelector('input[name="careerStatPick"]:checked')?.value ?? "").trim();
                            finish(value || null);
                        }
                    },
                    cancel: {
                        label: "Skip",
                        callback: () => finish(null)
                    }
                },
                default: "apply",
                close: () => finish(null)
            }, { width: 520, classes: ["skilltree-chargen-dialog"] }).render(true);
        });
    }

    async _promptCareerAdvancementIncreasePick({ title, picksRemaining, entries = [], alternativeOptions = [] }) {
        if (this._simulationEnabled()) {
            const options = [
                ...entries.map(entry => String(entry.nodeId ?? "").trim()).filter(Boolean),
                ...alternativeOptions.map(option => String(option.value ?? "").trim()).filter(Boolean)
            ];
            return this._randomChoice(options);
        }
        const optionRows = [
            ...entries.map((entry, idx) => `
                <label class="chargen-dialog__choice">
                  <input type="radio" name="careerAdvancePick" value="${foundry.utils.escapeHTML(entry.nodeId)}" ${idx === 0 ? "checked" : ""}>
                  <span class="chargen-dialog__choice-body">
                    <span class="chargen-dialog__choice-mark"></span>
                    <span>
                      <span class="chargen-dialog__choice-title">${foundry.utils.escapeHTML(entry.name)}</span>
                      <span class="chargen-dialog__choice-meta">${foundry.utils.escapeHTML(String(entry.kind ?? "skill"))} • ${entry.currentLevel} -> ${entry.nextLevel}</span>
                    </span>
                  </span>
                </label>
            `),
            ...alternativeOptions.map((option, idx) => `
                <label class="chargen-dialog__choice">
                  <input type="radio" name="careerAdvancePick" value="${foundry.utils.escapeHTML(option.value)}" ${(entries.length === 0 && idx === 0) ? "checked" : ""}>
                  <span class="chargen-dialog__choice-body">
                    <span class="chargen-dialog__choice-mark"></span>
                    <span>
                      <span class="chargen-dialog__choice-title">${foundry.utils.escapeHTML(option.label)}</span>
                      <span class="chargen-dialog__choice-meta">Alternative reward</span>
                    </span>
                  </span>
                </label>
            `)
        ].join("");

        return await new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            new Dialog({
                title: "Career Advancement",
                content: `
                  <div class="chargen-dialog">
                    <div class="chargen-dialog__eyebrow">Advancement</div>
                    <h2 class="chargen-dialog__title">${foundry.utils.escapeHTML(title)}</h2>
                    <p class="chargen-dialog__copy">${picksRemaining} pick${picksRemaining === 1 ? "" : "s"} remaining.</p>
                    <div class="chargen-dialog__choice-list">${optionRows}</div>
                  </div>
                `,
                buttons: {
                    apply: {
                        label: "Apply",
                        callback: (html) => {
                            const value = String(html[0]?.querySelector('input[name="careerAdvancePick"]:checked')?.value ?? "").trim();
                            finish(value || null);
                        }
                    },
                    cancel: {
                        label: "Skip",
                        callback: () => finish(null)
                    }
                },
                default: "apply",
                close: () => finish(null)
            }, { width: 560, classes: ["skilltree-chargen-dialog"] }).render(true);
        });
    }

    async _applyListedIncrease(run, entry, { silent = false } = {}) {
        const st = globalThis.SkillTree;
        if (!entry?.nodeId || typeof st?.grantFirstAvailableNode !== "function") return false;
        const graphData = await this._getSkillTreeGraphData();
        await this._ensureSkillTreeActorRefs(graphData);
        const result = await st.grantFirstAvailableNode(this.actor, entry.nodeId, entry.nextLevel, {
            graphData
        });
        if (!result?.ok || !result.granted) return false;

        await this._ensureVisibleActorItemForNode(entry.nodeId, graphData);
        const grantedLevel = Number(result.granted.level);
        if (Number.isFinite(grantedLevel)) {
            if (entry.kind === "skill" && typeof st.setSkillLevel === "function") {
                await st.setSkillLevel(this.actor, entry.nodeId, grantedLevel);
            } else if (typeof st.setNodeLevel === "function") {
                await st.setNodeLevel(this.actor, entry.nodeId, grantedLevel);
            }
            await this._ensureSkillTreeActorRefs(graphData);
        }

        const showLevel = entry.kind !== "maneuver" && Number.isFinite(grantedLevel);
        if (!silent) {
            await this._addBio(run, showLevel ? `Career advancement learned ${entry.name} ${grantedLevel}` : `Career advancement learned ${entry.name}`);
        }
        return true;
    }

    async _applyCareerAdvancementAlternative(run, value) {
        const ref = String(value ?? "").trim();
        if (!ref) return false;

        if (ref === "alt:money:50") {
            const money = await this._addMoney(50);
            await this._addBio(run, `Career advancement granted 50 money (${money.before} -> ${money.after}).`);
            return true;
        }

        if (!ref.startsWith("alt:table:")) return false;
        const tableUuid = ref.slice("alt:table:".length);
        const rr = await this._rollOnce(tableUuid);
        const spec = SkillTreeChargenApp._resultRawJSON(rr.result).trim();
        const doc = await this._getItemDocFromSpec(spec);
        if (!doc) {
            await this._addBio(run, `Career advancement item reward failed from ${tableUuid}.`);
            return false;
        }

        await this._grantItemToActor(run, doc, 1);
        return true;
    }

    async _runCareerAdvancementWizard(run, reveal) {
        const tableName = String(reveal?.fromName ?? "Career").trim() || "Career";
        const settings = getChargenSettings();
        const statPickCount = Math.max(0, Number(settings.careerStatPicks ?? 3) || 0);
        const skillPickCount = Math.max(0, Number(settings.careerSkillPicks ?? 3) || 0);
        const maneuverPickCount = Math.max(0, Number(settings.careerManeuverPicks ?? 2) || 0);

        for (let i = 0; i < statPickCount; i += 1) {
            const stat = await this._promptCareerAdvancementStatPick(`How Did This Career Change You?`, statPickCount - i);
            if (!stat) {
                await this._addBio(run, `Career advancement ended early during stat picks after ${tableName}.`);
                return false;
            }

            const props = this.actor.system?.props ?? {};
            const dKey = `Stats_${stat}Dice`;
            const mKey = `Stats_${stat}Mod`;
            const beforeDice = Number(props[dKey] ?? 1);
            const beforeMod = Number(props[mKey] ?? 0);
            const before = `${beforeDice}d6+${beforeMod}`;
            const after = await advanceStat(this.actor, stat, 1);
            await this._addBio(run, `Career advancement improved ${stat} (${before} -> ${after.dice}d6+${after.mod})`);
        }

        for (let i = 0; i < skillPickCount; i += 1) {
            const allSkills = await this._listAvailableNodeIncreases("skill");
            const availableSkills = allSkills
                .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));

            if (!availableSkills.length) {
                await this._addBio(run, "Career advancement ended early: no more available skill increases.");
                break;
            }

            const pickedNodeId = await this._promptCareerAdvancementIncreasePick({
                title: "How Did This Career Change You?",
                picksRemaining: skillPickCount - i,
                entries: availableSkills
            });
            if (!pickedNodeId) {
                await this._addBio(run, `Career advancement ended early during skill picks after ${tableName}.`);
                return false;
            }

            const picked = availableSkills.find(entry => String(entry.nodeId) === pickedNodeId);
            if (!picked) {
                await this._addBio(run, "Career advancement skill pick was invalid.");
                return false;
            }

            const applied = await this._applyListedIncrease(run, picked);
            if (!applied) {
                await this._addBio(run, `Career advancement could not apply ${picked.name}.`);
                return false;
            }
        }

        const maneuverAlternatives = [
            { value: "alt:money:50", label: "Gain 50 money" },
            { value: "alt:table:RollTable.4Xbki12nYfJHAIdX", label: "Roll on Items - Military" },
            { value: "alt:table:RollTable.weXLb9rAqFMsHe6W", label: "Roll on Items - Occult" },
            { value: "alt:table:RollTable.L6GjkyWmF3QsMezU", label: "Roll on Spells - Random Minor" }
        ];

        for (let i = 0; i < maneuverPickCount; i += 1) {
            const availableManeuvers = (await this._listAvailableNodeIncreases("maneuver"))
                .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));

            const pick = await this._promptCareerAdvancementIncreasePick({
                title: "How Did This Career Change You?",
                picksRemaining: maneuverPickCount - i,
                entries: availableManeuvers,
                alternativeOptions: maneuverAlternatives
            });
            if (!pick) {
                await this._addBio(run, `Career advancement ended early during maneuver rewards after ${tableName}.`);
                return false;
            }

            if (pick.startsWith("alt:")) {
                const applied = await this._applyCareerAdvancementAlternative(run, pick);
                if (!applied) {
                    await this._addBio(run, `Career advancement alternative reward failed: ${pick}.`);
                    return false;
                }
                continue;
            }

            const picked = availableManeuvers.find(entry => String(entry.nodeId) === pick);
            if (!picked) {
                await this._addBio(run, "Career advancement maneuver pick was invalid.");
                return false;
            }

            const applied = await this._applyListedIncrease(run, picked);
            if (!applied) {
                await this._addBio(run, `Career advancement could not apply ${picked.name}.`);
                return false;
            }
        }

        await this._addBio(run, `Career advancement completed after ${tableName}.`);
        return true;
    }

    async _applyCareerAdvancementBundle(run, reveal) {
        return await this._runCareerAdvancementWizard(run, reveal);
    }

    async _maybeApplyCareerAdvancementBundle(state, run, reveal = null) {
        if (!run?.careerAdvancementEligible || run?.careerAdvancementApplied) return false;
        const sourceName = String(reveal?.fromName ?? run.careerAdvancementSource ?? "Career").trim() || "Career";
        await this._applyCareerAdvancementBundle(run, { fromName: sourceName });
        run.careerAdvancementApplied = true;
        await this._setState({ ...state, run });
        return true;
    }

    async _ensureVisibleActorItemForNode(nodeId, graphData = null, opts = {}) {
        const ref = String(nodeId ?? "").trim();
        if (!ref.startsWith("Item.")) return false;

        const sourceDoc = await this._getItemDocFromSpec(ref);
        if (!sourceDoc) return false;

        let embedded = this.actor.items.find(item =>
            String(item.flags?.chargen1547_v2?.skilltreeNodeRef ?? "").trim() === ref
            || (item.name === sourceDoc.name && item.type === sourceDoc.type)
        ) ?? null;

        if (!embedded) {
            const data = sourceDoc.toObject();
            foundry.utils.setProperty(data, "flags.chargen1547_v2.skilltreeNodeRef", ref);
            if (Number.isFinite(Number(opts.level))) {
                foundry.utils.setProperty(data, "system.props.CurrentLevel", String(Number(opts.level)));
            }
            const created = await this.actor.createEmbeddedDocuments("Item", [data]);
            embedded = Array.isArray(created) ? created[0] ?? null : null;
        }

        if (embedded && Number.isFinite(Number(opts.level))) {
            const currentLevel = Number(foundry.utils.getProperty(embedded, "system.props.CurrentLevel"));
            const targetLevel = Number(opts.level);
            if (!Number.isFinite(currentLevel) || currentLevel !== targetLevel) {
                await embedded.update({ "system.props.CurrentLevel": String(targetLevel) });
            }
        }

        if (embedded && typeof globalThis.SkillTree?.ensureActorItemNodeRef === "function" && graphData) {
            await globalThis.SkillTree.ensureActorItemNodeRef(embedded, graphData);
        }

        return embedded;
    }

    async _grantStartingManeuvers() {
        const refs = await loadDefaultManeuverRefs();
        for (const ref of refs) {
            const doc = await this._getItemDocFromSpec(ref);
            if (!doc) continue;

            const alreadyHas = this.actor.items.some(item =>
                String(item.flags?.chargen1547_v2?.startingManeuverRef ?? "").trim() === ref
                || (item.name === doc.name && item.type === doc.type)
            );
            if (alreadyHas) continue;

            const data = doc.toObject();
            foundry.utils.setProperty(data, "flags.chargen1547_v2.startingManeuverRef", ref);
            await this.actor.createEmbeddedDocuments("Item", [data]);
        }
    }

    async _grantBaselineSkill(targetKey) {
        const st = globalThis.SkillTree;
        const graphData = await this._getSkillTreeGraphData();
        await this._ensureSkillTreeActorRefs(graphData);

        const embedded = await this._ensureVisibleActorItemForNode(targetKey, graphData, { level: 0 });
        if (!embedded) {
            return { ok: false, targetKey, reason: "missing-item" };
        }

        if (typeof st?.setSkillLevel === "function") {
            await st.setSkillLevel(this.actor, targetKey, 0);
        } else if (typeof st?.setNodeLevel === "function") {
            await st.setNodeLevel(this.actor, targetKey, 0);
        }

        await embedded.update({ "system.props.CurrentLevel": "0" });
        await this._ensureSkillTreeActorRefs(graphData);

        const nodeRef = String(
            embedded.flags?.chargen1547_v2?.skilltreeNodeRef
            ?? globalThis.SkillTree?.resolveNodeIdForItem?.(embedded, graphData)
            ?? targetKey
        ).trim();

        return {
            ok: true,
            targetKey,
            nodeName: nodeRef,
            level: 0,
            itemId: embedded.id,
            itemName: embedded.name
        };
    }

    async _grantSkillToward(run, targetKey, targetLevel, fallback, { silent = false } = {}) {
        const st = globalThis.SkillTree;
        if ((!st?.grantFirstAvailableNode && !st?.nextStepToward) || (!st?.grantFirstAvailableNode && !st?.NODES)) {
            if (fallback?.type === "stat") {
                await advanceStat(this.actor, fallback.characteristic, Number(fallback.steps ?? 1));
            }
            return { ok: false, targetKey, targetLevel, reason: "skilltree-unavailable" };
        }

        const graphData = await this._getSkillTreeGraphData();
        await this._ensureSkillTreeActorRefs(graphData);

        const numericTargetLevel = Number(targetLevel);
        if (numericTargetLevel === 0 && typeof st?.nextStepToward === "function" && graphData) {
            const baselineStep = st.nextStepToward(this.actor, targetKey, numericTargetLevel, graphData, null);
            if (baselineStep?.nodeName && !String(baselineStep.nodeName).startsWith("Traits_")) {
                const existing = this.actor.system?.props?.[baselineStep.nodeName];
                if (existing == null || String(existing).trim() === "") {
                    await this.actor.update({ [`system.props.${baselineStep.nodeName}`]: "0" });
                }
                await this._ensureVisibleActorItemForNode(targetKey, graphData);
                await this._ensureSkillTreeActorRefs(graphData);
                return {
                    ok: true,
                    targetKey,
                    targetLevel: numericTargetLevel,
                    nodeName: String(baselineStep.nodeName),
                    level: 0
                };
            }
        }

        if (typeof st.grantFirstAvailableNode === "function") {
            const result = await st.grantFirstAvailableNode(this.actor, targetKey, targetLevel, {
                graphData
            });

            if (!result?.ok || !result.granted) {
                if (fallback?.type === "stat") {
                    await advanceStat(this.actor, fallback.characteristic, Number(fallback.steps ?? 1));
                }
                return { ok: false, targetKey, targetLevel, reason: "grant-failed", result };
            }

            const grantedType = String(result.next?.type ?? "").toLowerCase();
            const grantedLevel = Number(result.granted.level);
            if (Number.isFinite(grantedLevel)) {
                if (grantedType === "skill" && typeof st.setSkillLevel === "function") {
                    await st.setSkillLevel(this.actor, targetKey, grantedLevel);
                } else if (typeof st.setNodeLevel === "function") {
                    await st.setNodeLevel(this.actor, targetKey, grantedLevel);
                }
                await this._ensureVisibleActorItemForNode(targetKey, graphData);
                await this._ensureSkillTreeActorRefs(graphData);
            }

            const grantedName = await this._resolveLearnedLabel(
                result.granted?.nodeId ?? targetKey,
                result.next?.name ?? result.granted?.nodeId ?? targetKey
            );
            const showLevel = grantedType !== "maneuver" && Number.isFinite(grantedLevel);
            if (!silent) {
                await this._addBio(run, showLevel ? `Learned ${grantedName} ${grantedLevel}` : `Learned ${grantedName}`);
            }
            return {
                ok: true,
                targetKey,
                targetLevel: Number.isFinite(numericTargetLevel) ? numericTargetLevel : null,
                nodeName: String(result.granted?.nodeName ?? result.granted?.nodeId ?? targetKey),
                level: grantedLevel,
                grantedType
            };
        }

        const step = st.nextStepToward(this.actor, targetKey, targetLevel, graphData, null);
        if (step === true) {
            return { ok: true, targetKey, targetLevel, reason: "already-satisfied" };
        }
        if (!step?.nodeName) {
            return { ok: false, targetKey, targetLevel, reason: "missing-node" };
        }
        if (String(step.nodeName).startsWith("Traits_")) {
            return { ok: false, targetKey, targetLevel, reason: "trait-node" };
        }

        const cur = this._getPropNumber(step.nodeName);
        const next = Math.max(cur, Number(step.nodeLevel ?? 0));

        await this.actor.update({ [`system.props.${step.nodeName}`]: String(next) });
        await this._ensureVisibleActorItemForNode(targetKey, graphData);
        await this._ensureSkillTreeActorRefs(graphData);
        if (!silent) {
            const learnedName = await this._resolveLearnedLabel(targetKey, step.nodeName);
            await this._addBio(run, `Learned ${learnedName} ${next}`);
        }
        return {
            ok: true,
            targetKey,
            targetLevel: Number.isFinite(numericTargetLevel) ? numericTargetLevel : null,
            nodeName: String(step.nodeName),
            level: next
        };
    }

    async _getBaselineMinZeroSkills() {
        if (Array.isArray(BASELINE_MIN_ZERO_SKILLS_CACHE)) return BASELINE_MIN_ZERO_SKILLS_CACHE;

        const catalog = buildChargenInterfaceCatalog();
        BASELINE_MIN_ZERO_SKILLS_CACHE = catalog.skills
            .filter(entry => Number(entry?.minLevel) === 0 && String(entry?.uuid ?? "").trim() !== "")
            .map(entry => String(entry.uuid).trim());
        return BASELINE_MIN_ZERO_SKILLS_CACHE;
    }

    async _validateBaselineMinZeroSkillsProvisioning(grantResults = null) {
        const results = Array.isArray(grantResults)
            ? grantResults
            : (await this._getBaselineMinZeroSkills()).map(uuid => ({ targetKey: uuid }));
        const report = {
            ok: true,
            checked: [],
            missing: [],
            invalid: []
        };

        for (const entry of results) {
            const skillUuid = String(entry?.targetKey ?? entry?.uuid ?? "").trim();
            const nodeName = String(entry?.nodeName ?? "").trim();
            const itemId = String(entry?.itemId ?? "").trim();

            if (!entry?.ok || !nodeName) {
                report.ok = false;
                report.missing.push({
                    uuid: skillUuid,
                    nodeName: nodeName || null,
                    reason: entry?.reason ?? "missing-node"
                });
                continue;
            }

            const embedded = itemId
                ? (this.actor.items.get(itemId) ?? null)
                : (this.actor.items.find(item =>
                    String(item.flags?.chargen1547_v2?.skilltreeNodeRef ?? "").trim() === skillUuid
                ) ?? null);

            if (!embedded) {
                report.ok = false;
                report.missing.push({
                    uuid: skillUuid,
                    nodeName,
                    reason: "missing-embedded-item"
                });
                continue;
            }

            const value = foundry.utils.getProperty(embedded, "system.props.CurrentLevel");
            report.checked.push({
                uuid: skillUuid,
                nodeName,
                itemId: embedded.id,
                itemName: embedded.name,
                value: value ?? null
            });

            if (String(value ?? "").trim() !== "0") {
                report.ok = false;
                report.invalid.push({
                    uuid: skillUuid,
                    nodeName,
                    itemId: embedded.id,
                    itemName: embedded.name,
                    value: value ?? null
                });
            }
        }

        return report;
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

        const allResults = Array.from(table.results ?? []);
        let roll = null;
        let matched = [];

        const formula = String(table.formula ?? "").trim();
        if (formula) {
            try {
                roll = await (new Roll(formula)).evaluate({ async: true });
                matched = table.getResultsForRoll?.(roll.total) ?? [];
            } catch (err) {
                console.warn(`Chargen: failed to evaluate rolltable formula for "${table.name}" (${tableUuidOrId}). Falling back to weighted pick.`, err);
            }
        }

        // If multiple results match (overlapping ranges), pick one
        let r = matched.length ? matched[Math.floor(Math.random() * matched.length)] : null;

        // Fallback for malformed imported tables with missing/bad formulas.
        if (!r && allResults.length) {
            const weighted = [];
            for (const result of allResults) {
                const copies = Math.max(1, Number(result?.weight ?? 1) || 1);
                for (let i = 0; i < copies; i += 1) weighted.push(result);
            }
            r = weighted[Math.floor(Math.random() * weighted.length)] ?? allResults[0] ?? null;
        }

        if (!r) {
            if (roll) {
                throw new Error(
                    `RollTable "${table.name}" produced no result for roll ${roll.total} (${table.formula}).`
                );
            }
            throw new Error(`RollTable "${table.name}" has no usable results.`);
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

    _cloneLanguageRows(value) {
        if (Array.isArray(value)) {
            return {
                storage: "array",
                rows: foundry.utils.deepClone(value)
            };
        }

        if (value && typeof value === "object") {
            const entries = Object.entries(value)
                .filter(([, row]) => row && typeof row === "object" && !Array.isArray(row) && !row.$deleted)
                .sort((a, b) => Number(a[0]) - Number(b[0]));

            return {
                storage: "object",
                rows: entries.map(([, row]) => foundry.utils.deepClone(row))
            };
        }

        return null;
    }

    _serializeLanguageRows(rows, storage = "array") {
        const cleanRows = Array.isArray(rows)
            ? rows
                .filter(row => row && typeof row === "object" && !Array.isArray(row))
                .map(row => {
                    const cloned = foundry.utils.deepClone(row);
                    if (storage === "object") cloned.$deleted = false;
                    return cloned;
                })
            : [];

        if (storage === "object") {
            const out = {};
            cleanRows.forEach((row, index) => {
                out[String(index)] = row;
            });
            return out;
        }

        return cleanRows;
    }

    _resolveLanguageTable(tableKeyHint = null) {
        const props = this.actor.system?.props ?? {};
        const hint = String(tableKeyHint ?? "").trim();

        if (hint) {
            const hinted = props[hint];
            const cloned = this._cloneLanguageRows(hinted);
            if (cloned) {
                return { tableKey: hint, rows: cloned.rows, storage: cloned.storage };
            }
        }

        const preferred = this._cloneLanguageRows(props.LanguageTable);
        if (preferred) {
            return { tableKey: "LanguageTable", rows: preferred.rows, storage: "object" };
        }

        const defaultCloned = this._cloneLanguageRows(props.Languages);
        if (defaultCloned) {
            return { tableKey: "Languages", rows: defaultCloned.rows, storage: defaultCloned.storage };
        }

        for (const [k, v] of Object.entries(props)) {
            const cloned = this._cloneLanguageRows(v);
            if (!cloned || !cloned.rows.length) continue;
            if (cloned.rows.some(row => this._isLanguageRow(row))) {
                return { tableKey: k, rows: cloned.rows, storage: cloned.storage };
            }
        }

        for (const [k, v] of Object.entries(props)) {
            const cloned = this._cloneLanguageRows(v);
            if (!cloned) continue;
            if (k.toLowerCase().includes("language")) {
                return { tableKey: k, rows: cloned.rows, storage: cloned.storage };
            }
        }

        if (hint) return { tableKey: hint, rows: [], storage: "object" };
        return { tableKey: "LanguageTable", rows: [], storage: "object" };
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

    _nextDynamicTableRowKey(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return "0";
        const keys = Object.keys(value)
            .map(k => Number(k))
            .filter(n => Number.isInteger(n) && n >= 0);
        return String(keys.length ? Math.max(...keys) + 1 : 0);
    }

    async _ensureLanguage(languageName, { readWrite = false, tableKeyHint = null } = {}) {
        const name = String(languageName ?? "").trim();
        if (!name) return false;

        const tableRef = this._resolveLanguageTable(tableKeyHint);
        const rows = Array.isArray(tableRef.rows) ? tableRef.rows : [];
        const existing = this._getKnownLanguages(rows)
            .find(l => l.name.toLowerCase() === name.toLowerCase());

        const rawTable = this.actor.system?.props?.[tableRef.tableKey];
        const isObjectTable = rawTable && typeof rawTable === "object" && !Array.isArray(rawTable);

        if (existing) {
            if (!readWrite || existing.readWrite) return false;
            if (isObjectTable) {
                const matchingKey = Object.entries(rawTable).find(([, row]) =>
                    this._isLanguageRow(row)
                    && String(row.Language ?? "").trim().toLowerCase() === existing.name.toLowerCase()
                )?.[0];
                if (matchingKey != null) {
                    await this.actor.update({
                        [`system.props.${tableRef.tableKey}.${matchingKey}.$deleted`]: false,
                        [`system.props.${tableRef.tableKey}.${matchingKey}.Language`]: existing.name,
                        [`system.props.${tableRef.tableKey}.${matchingKey}.LanguageReadWrite`]: true
                    });
                    return true;
                }
            }

            rows[existing.rowIndex] = {
                ...(rows[existing.rowIndex] ?? {}),
                Language: existing.name,
                LanguageReadWrite: true
            };
            await this.actor.update({
                [`system.props.${tableRef.tableKey}`]: this._serializeLanguageRows(rows, tableRef.storage)
            });
            return true;
        }

        if (isObjectTable || tableRef.storage === "object") {
            const rowKey = this._nextDynamicTableRowKey(rawTable);
            await this.actor.update({
                [`system.props.${tableRef.tableKey}.${rowKey}.$deleted`]: false,
                [`system.props.${tableRef.tableKey}.${rowKey}.Language`]: name,
                [`system.props.${tableRef.tableKey}.${rowKey}.LanguageReadWrite`]: Boolean(readWrite)
            });
            return true;
        }

        rows.push({
            Language: name,
            LanguageReadWrite: Boolean(readWrite)
        });
        await this.actor.update({
            [`system.props.${tableRef.tableKey}`]: this._serializeLanguageRows(rows, tableRef.storage)
        });
        return true;
    }

    _getNativeLanguageName() {
        const flagged = String(this.actor.getFlag("world", "chargenNativeLanguage") ?? "").trim();
        if (flagged) return flagged;

        const tableRef = this._resolveLanguageTable();
        const known = this._getKnownLanguages(Array.isArray(tableRef.rows) ? tableRef.rows : []);
        return String(known[0]?.name ?? "").trim();
    }

    async _maybeGrantCareerLiteracy(run, tableUuid) {
        const ref = String(tableUuid ?? "").trim();
        if (!ref) return false;

        const table = await this._getRollTable(ref);
        const tableName = String(table?.name ?? "").trim();
        const grantsNativeLiteracy = Boolean(
            foundry.utils.getProperty(table, "flags.chargen1547_v2.onEntry.nativeLiteracy")
        );
        if (!grantsNativeLiteracy) return false;

        const bioLine = String(
            foundry.utils.getProperty(table, "flags.chargen1547_v2.onEntry.nativeLiteracyBio") ?? ""
        ).trim();
        const tableKey = String(
            foundry.utils.getProperty(table, "flags.chargen1547_v2.entryKey") ?? normalizeTableKey(tableName)
        ).trim();
        const flagKey = `careerLiteracyGranted.${tableKey}`;
        if (this.actor.getFlag("world", flagKey)) return false;

        const nativeLanguage = this._getNativeLanguageName();
        if (!nativeLanguage) return false;

        const granted = await this._ensureLanguage(nativeLanguage, { readWrite: true });
        await this.actor.setFlag("world", flagKey, true);
        if (granted && bioLine) {
            await this._addBio(run, bioLine);
        }
        return granted;
    }

    async _promptLanguageAwardAction({ canUpgrade = false } = {}) {
        if (this._simulationEnabled()) {
            return canUpgrade && Math.random() < 0.35 ? "upgrade" : "add";
        }
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            const options = [
                {
                    value: "add",
                    title: "Add New Language",
                    meta: "Add a new spoken language to the character."
                }
            ];
            if (canUpgrade) {
                options.unshift({
                    value: "upgrade",
                    title: "Upgrade Read/Write",
                    meta: "Improve literacy in a language the character already knows."
                });
            }
            const optionRows = options.map((option, idx) => `
                <label class="chargen-dialog__choice">
                  <input type="radio" name="languageAwardAction" value="${option.value}" ${idx === 0 ? "checked" : ""}>
                  <span class="chargen-dialog__choice-body">
                    <span class="chargen-dialog__choice-mark"></span>
                    <span>
                      <span class="chargen-dialog__choice-title">${foundry.utils.escapeHTML(option.title)}</span>
                      <span class="chargen-dialog__choice-meta">${foundry.utils.escapeHTML(option.meta)}</span>
                    </span>
                  </span>
                </label>
            `).join("");

            new Dialog({
                title: "Language Award",
                content: `
                  <div class="chargen-dialog">
                    <div class="chargen-dialog__eyebrow">Tongues</div>
                    <h2 class="chargen-dialog__title">Language Award</h2>
                    <p class="chargen-dialog__copy">Choose how this language gain should shape the character.</p>
                    <div class="chargen-dialog__choice-list">${optionRows}</div>
                  </div>
                `,
                buttons: {
                    apply: {
                        label: "Apply",
                        callback: (html) => {
                            const value = String(html[0]?.querySelector('input[name="languageAwardAction"]:checked')?.value ?? "").trim();
                            finish(value || null);
                        }
                    },
                    cancel: {
                        label: "Cancel",
                        callback: () => finish(null)
                    }
                },
                default: "apply",
                close: () => finish(null)
            }, { width: 560, classes: ["skilltree-chargen-dialog"] }).render(true);
        });
    }

    async _promptNewLanguageName() {
        if (this._simulationEnabled()) {
            const index = Number(this._simulationOption("runIndex", 0)) + this._getKnownLanguages(this._resolveLanguageTable().rows).length + 1;
            return `SimLanguage${index}`;
        }
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            new Dialog({
                title: "Add New Language",
                content: `
                  <div class="chargen-dialog">
                    <div class="chargen-dialog__eyebrow">Tongues</div>
                    <h2 class="chargen-dialog__title">Add New Language</h2>
                    <p class="chargen-dialog__copy">Name a language the character can now speak.</p>
                    <div class="chargen-dialog__field">
                      <label for="cg-language-name">Language</label>
                      <input id="cg-language-name" name="languageName" type="text" placeholder="e.g. Castilian" />
                    </div>
                  </div>
                `,
                buttons: {
                    ok: {
                        label: "Add",
                        callback: (html) => {
                            const value = String(html.find("[name='languageName']").val() ?? "").trim();
                            finish(value || null);
                        }
                    },
                    cancel: {
                        label: "Cancel",
                        callback: () => finish(null)
                    }
                },
                default: "ok",
                close: () => finish(null)
            }, { width: 480, classes: ["skilltree-chargen-dialog"] }).render(true);
        });
    }

    async _promptLanguageUpgradeChoice(upgradable) {
        if (this._simulationEnabled()) {
            return this._randomChoice(upgradable);
        }
        const options = upgradable
            .map((l, i) => `
                <label class="chargen-dialog__choice">
                  <input type="radio" name="languageUpgrade" value="${i}" ${i === 0 ? "checked" : ""}>
                  <span class="chargen-dialog__choice-body">
                    <span class="chargen-dialog__choice-mark"></span>
                    <span>
                      <span class="chargen-dialog__choice-title">${foundry.utils.escapeHTML(l.name)}</span>
                      <span class="chargen-dialog__choice-meta">Known language, upgrade to read and write.</span>
                    </span>
                  </span>
                </label>
            `)
            .join("");

        return new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            new Dialog({
                title: "Upgrade Language Read/Write",
                content: `
                  <div class="chargen-dialog">
                    <div class="chargen-dialog__eyebrow">Tongues</div>
                    <h2 class="chargen-dialog__title">Upgrade Language Read/Write</h2>
                    <p class="chargen-dialog__copy">Choose which known language should become fully literate.</p>
                    <div class="chargen-dialog__choice-list">${options}</div>
                  </div>
                `,
                buttons: {
                    ok: {
                        label: "Upgrade",
                        callback: (html) => {
                            const idx = Number(html[0]?.querySelector('input[name="languageUpgrade"]:checked')?.value);
                            if (!Number.isInteger(idx) || idx < 0 || idx >= upgradable.length) {
                                finish(null);
                                return;
                            }
                            finish(upgradable[idx]);
                        }
                    },
                    cancel: {
                        label: "Cancel",
                        callback: () => finish(null)
                    }
                },
                default: "ok",
                close: () => finish(null)
            }, { width: 560, classes: ["skilltree-chargen-dialog"] }).render(true);
        });
    }

    async _promptOptionalTransition({ fromName = "", toUuid = "", prompt = "" } = {}) {
        const targetRef = String(toUuid ?? "").trim();
        if (!targetRef) return false;

        if (this._simulationEnabled()) {
            return Math.random() < 0.5;
        }

        const toName = await this._getTableName(targetRef) || targetRef;
        const fromLabel = String(fromName ?? "").trim() || "your current path";
        const promptText = String(prompt ?? "").trim()
            || `You may move to ${toName}, or remain on ${fromLabel}.`;

        return new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                resolve(Boolean(value));
            };
            new Dialog({
                title: "A New Path Opens",
                content: `
                  <div class="chargen-dialog">
                    <div class="chargen-dialog__eyebrow">Transition</div>
                    <h2 class="chargen-dialog__title">A New Path Opens</h2>
                    <p class="chargen-dialog__copy">${foundry.utils.escapeHTML(promptText)}</p>
                    <div class="chargen-dialog__section">
                      <p class="chargen-dialog__copy"><strong>Current:</strong> ${foundry.utils.escapeHTML(fromLabel)}</p>
                      <p class="chargen-dialog__copy"><strong>New path:</strong> ${foundry.utils.escapeHTML(toName)}</p>
                    </div>
                  </div>
                `,
                buttons: {
                    take: {
                        label: "Take the New Path",
                        callback: () => finish(true)
                    },
                    stay: {
                        label: "Remain Where You Are",
                        callback: () => finish(false)
                    }
                },
                default: "take",
                close: () => finish(false)
            }, { width: 560, classes: ["skilltree-chargen-dialog"] }).render(true);
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

            await this._ensureLanguage(chosen.name, {
                readWrite: true,
                tableKeyHint: tableRef.tableKey
            });
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
                await this._ensureLanguage(existing.name, {
                    readWrite: true,
                    tableKeyHint: tableRef.tableKey
                });
                await this._addBio(run, `Language already known; upgraded ${existing.name} to read/write.`);
                return;
            }

            ui.notifications.info(`${existing.name} is already known with read/write.`);
            await this._addBio(run, `Language award skipped: ${existing.name} already has read/write.`);
            return;
        }

        await this._ensureLanguage(newLanguage, {
            readWrite: false,
            tableKeyHint: tableRef.tableKey
        });
        await this._addBio(run, `Learned language: ${newLanguage}.`);
    }

    async _applyChanges(run, changes = []) {
        return applyRewardChanges(this, run, changes, {
            advanceStat,
            promptAddDrive: async (actor, category) => {
                if (this._simulationEnabled()) {
                    const line = `[${category}] ${this._generateSimulationDriveText(category)}`;
                    const existing = String(actor.system?.props?.Drives ?? "").trim();
                    const updated = existing ? `${existing}\n${line}` : line;
                    await actor.update({ "system.props.Drives": updated });
                    return true;
                }
                return await promptAddDrive(actor, category);
            },
            promptRemoveDrive: async (actor) => {
                if (this._simulationEnabled()) {
                    const lines = this._getDriveLinesFromActor();
                    if (!lines.length) return false;
                    const updated = lines.slice(1).join("\n");
                    await actor.update({ "system.props.Drives": updated });
                    return true;
                }
                return await promptRemoveDrive(actor);
            }
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

        const statusCheckTarget = () => {
            const s = getSocialStatus();                 // -2..+2
            const lucky = Boolean(run.luckyStreak);
            const target = 7 + s + (lucky ? 1 : 0);
            return clamp(target, 2, 12);
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
                const target = statusCheckTarget();
                const roll = (await (new Roll("2d6")).evaluate({ async: true })).total;

                if (roll > target) {
                    const s = getSocialStatus();
                    const luckyTxt = run.luckyStreak ? " + Lucky" : "";
                    await this._addBio(
                        run,
                        `Missed: ${drawn.data.choice?.title ?? "Unknown"} (Status check failed: rolled ${roll} on 2d6 vs ${target}; Social ${s}${luckyTxt})`
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
                (!isPlaceholderImg(table.img) ? table.img : "");
            const img = resolveImgPath(chosen) || resolveImgPath(UNKNOWN_CARD_IMAGE);

            out.push({
                resultId: r.id,
                range: Array.isArray(r.range) ? [...r.range] : [],
                rawText: SkillTreeChargenApp._resultRawJSON(r),
                img,
                data,
                isHiddenOutcome: useUnknownExtremeReveal && SkillTreeChargenApp._resultHasExtremeUnknownReveal(r),
                masked: useUnknownExtremeReveal && SkillTreeChargenApp._resultHasExtremeUnknownReveal(r)
            });
        }

        await preloadImages([
            resolveImgPath("media/home/games/1547/Cards/backside.webp"),
            ...out.map(card => card.img)
        ]);

        return out;
    }

    async _resolveSummaryLabelForItemSpec(spec) {
        const raw = String(spec ?? "").trim();
        if (!raw) return "";
        const doc = await this._getItemDocFromSpec(raw);
        return String(doc?.name ?? raw.replace(/^Item\./, "")).trim();
    }

    async _resolveLearnedLabel(spec, fallback = "") {
        const raw = String(spec ?? "").trim();
        if (!raw) return String(fallback ?? "").trim();

        const resolved = await this._resolveSummaryLabelForItemSpec(raw);
        if (resolved) return resolved;

        return String(fallback || raw).replace(/^Item\./, "").trim();
    }

    async _resolveSummaryLabelForTableRef(tableUuidOrId) {
        const raw = String(tableUuidOrId ?? "").trim();
        if (!raw) return "";
        const name = await this._getTableName(raw);
        return String(name ?? raw.replace(/^RollTable\./, "")).trim();
    }

    async _summarizeChange(ch) {
        if (!ch || typeof ch !== "object") return null;

        if (ch.type === "skill" || ch.type === "maneuver") {
            const kind = ch.type === "maneuver" ? "Maneuver" : "Skill";
            const label = await this._resolveSummaryLabelForItemSpec(ch.targetKey ?? ch.skill ?? ch.maneuver ?? "");
            const level = Number(ch.targetLevel);
            if (Number.isFinite(level) && level !== 0) {
                return `${kind}: ${label} ${level > 0 ? "+" : ""}${level}`;
            }
            return `${kind}: ${label}`;
        }

        if (ch.type === "bio") {
            if (ch.text) return `Biography: ${ch.text}`;
            if (ch.roll?.tableUuid) {
                const tableName = await this._resolveSummaryLabelForTableRef(ch.roll.tableUuid);
                return tableName ? `Biography: roll on ${tableName}` : "Roll biography entry";
            }
            return "Roll biography entry";
        }

        if (ch.type === "item") {
            if (ch.name) return `Item: ${ch.name}`;
            if (ch.itemUuid) {
                const itemName = await this._resolveSummaryLabelForItemSpec(ch.itemUuid);
                return itemName ? `Item: ${itemName}` : "Item reward";
            }
            if (ch.tableUuid) {
                const tableName = await this._resolveSummaryLabelForTableRef(ch.tableUuid);
                return tableName ? `Item: roll on ${tableName}` : "Item reward";
            }
        }

        return summarizeRewardChange(ch);
    }

    async _buildRevealSummary(run, reward, nextUuid, transitionState = "", fromName = "") {
        const lines = [];
        for (const ch of reward?.changes ?? []) {
            const line = await this._summarizeChange(ch);
            if (line) lines.push(line);
        }

        const nextName = nextUuid ? await this._getTableName(nextUuid) : "";
        const transitionKind = String(transitionState ?? "").trim().toLowerCase();
        const fromTableName = String(fromName ?? "").trim();
        const hasPathChange = Boolean(nextUuid && nextUuid !== run?.tableUuid);
        const fromTable = run?.tableUuid ? await this._getRollTable(run.tableUuid) : null;
        const nextTable = nextUuid ? await this._getRollTable(nextUuid) : null;
        const isCareerPathTurn = Boolean(
            hasPathChange &&
            transitionKind === "forced" &&
            this._isCareerAdvancementTable(fromTable) &&
            this._isCareerAdvancementTable(nextTable)
        );
        const isTransitionInterstitial = isCareerPathTurn;
        let nextDetail = nextName;
        if (nextName && transitionKind === "chosen") {
            nextDetail = `You chose a new path: ${nextName}`;
        } else if (nextName && transitionKind === "forced") {
            nextDetail = `Your path was forced toward ${nextName}`;
        }
        return {
            lines,
            nextUuid,
            nextName,
            nextDetail,
            transitionKind,
            isTransitionInterstitial,
            fromTableName,
            transitionText: String(reward?.transitionText ?? "").trim(),
            transitionModeLabel:
                transitionKind === "chosen"
                    ? "Chosen Path"
                    : transitionKind === "forced"
                        ? (isCareerPathTurn ? "Forced Turn" : "")
                        : "",
            terminal: !nextUuid,
            exhausted: Number(run?.remainingGlobal ?? 0) <= 0
        };
    }



    /* ---------------- FormApplication ---------------- */

    async getData() {
        const state = this._getState();
        const run = state.run;
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

        const revealDeferredLines = reveal?.isDeferred
            ? (await Promise.all((reveal.payload?.changes ?? []).map(ch => this._summarizeChange(ch)))).filter(Boolean)
            : [];
        const revealDeferredHtml = reveal?.isDeferred && reveal?.text
            ? this._formatDeferredBiographyText(reveal.text, reveal.sourceTitle)
            : "";
        const revealTransitionText = reveal?.isTransitionInterstitial
            ? String(reveal?.transitionText ?? "").trim()
            : "";

        const nextPackageInfo = this._getNextPackageInfo(run, table);
        const nextPackage = nextPackageInfo
            ? {
                label: String(nextPackageInfo.package?.label ?? "").trim()
                    || summarizeRewardChange(nextPackageInfo.package?.gain)
                    || "Career package",
                summary: summarizeRewardChange(nextPackageInfo.package?.gain) ?? "",
                indexHuman: nextPackageInfo.index + 1,
                total: nextPackageInfo.total
            }
            : null;

        return {
            revealDeferredLines,
            revealDeferredHtml,
            revealTransitionText,
            state: run ?? { remainingGlobal: 0 },
            actorName: this.actor?.name ?? "",
            currentTableName: table?.name ?? "",
            currentTableDescription: tableDescription,
            nextPackage,
            backImg,
            reveal,
            cards: (run?.cards ?? []).map((c, idx) => {
                const badges = c.masked ? [] : this._inferChoiceHintBadges(c.data, table);
                const badgeTip = badges.length
                    ? ` Hints: ${badges.map(entry => entry.detail).join(" ")}`
                    : "";
                return {
                    title: c.masked ? "Unknown" : c.data.choice.title,
                    text: c.masked ? "" : (c.data.choice.text ?? ""),
                    img: c.masked ? unknownImg : (c.img ?? ""),
                    masked: Boolean(c.masked),
                    badges,
                    cardClass: reveal
                        ? (idx === reveal.chosenIndex ? "is-selected" : "is-flipped is-rejected")
                        : "",
                    tooltip: reveal
                        ? (idx === reveal.chosenIndex ? "Click this card again to continue." : "Not chosen.")
                        : (c.masked
                            ? "Click to reveal this hidden result."
                            : `Click to choose this option. The reward is rolled immediately.${badgeTip}`)
                };
            }),
            bio: run?.bio ?? [],
            compiledBio: this._buildCompiledBiography(run?.bioEvents ?? [])
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

        const bioCount = Number(this._getState()?.run?.bio?.length ?? 0);
        requestAnimationFrame(() => {
            const bioScroller = html[0]?.querySelector(".chargen-bio-scroll");
            if (bioScroller && this._lastBioScrollCount != null && bioCount > this._lastBioScrollCount) {
                bioScroller.scrollTop = bioScroller.scrollHeight;
            }
            this._lastBioScrollCount = bioCount;
        });

        html.find("[data-action='settings']").on("click", () => this._onOpenSettings());
        html.find("[data-action='finish']").on("click", () => this._onFinish());
        html.find("[data-action='continue']").on("click", () => this._onContinue());

        html.on("keydown", ".deferred-overlay", (ev) => {
            if (ev.key !== "Enter" && ev.key !== " ") return;
            ev.preventDefault();
            this._onContinue();
        });

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

    async _onOpenSettings() {
        const content = `
            <div class="chargen-dialog">
              <div class="chargen-dialog__eyebrow">Table Tools</div>
              <h2 class="chargen-dialog__title">Chargen Settings</h2>
              <p class="chargen-dialog__copy">Recovery, validation, and diagnostic tools live here so the main life screen can stay focused on choosing cards and reading biography.</p>
            </div>
        `;

        new Dialog({
            title: "Chargen Settings",
            content,
            buttons: {
                reroll: {
                    label: '<i class="fas fa-dice"></i> Reroll Current Spread',
                    callback: () => this._onReroll()
                },
                relevant: {
                    label: '<i class="fas fa-table"></i> Relevant Tables',
                    callback: () => this._onShowRelevantTables()
                },
                validation: {
                    label: '<i class="fas fa-list-check"></i> Validation List',
                    callback: () => this._onShowTableList()
                },
                close: {
                    label: "Close"
                }
            }
        }, { width: 620, classes: ["skilltree-chargen-dialog"] }).render(true);
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

    async _onShowRelevantTables() {
        try {
            const state = this._getState();
            const relevantTables = await this._getRelevantTablesForView(state);
            const rows = relevantTables.map((entry) => `
                <tr>
                  <td>${foundry.utils.escapeHTML(String(entry.role ?? ""))}</td>
                  <td>${foundry.utils.escapeHTML(String(entry.use ?? ""))}</td>
                  <td title="${foundry.utils.escapeHTML(String(entry.ref ?? ""))}">${foundry.utils.escapeHTML(String(entry.tableName ?? ""))}</td>
                  <td>${entry.ok ? "OK" : "Missing"}</td>
                </tr>
            `).join("");

            const content = `
                <div class="chargen-dialog">
                  <div class="chargen-dialog__eyebrow">Diagnostics</div>
                  <h2 class="chargen-dialog__title">Relevant Tables and Usage</h2>
                  <p class="chargen-dialog__copy">This view is mainly useful for validation and troubleshooting.</p>
                  <div style="max-height: 420px; overflow: auto;">
                    <table class="table-striped" style="width:100%;">
                      <thead>
                        <tr>
                          <th>Role</th>
                          <th>Use</th>
                          <th>Table</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>${rows}</tbody>
                    </table>
                  </div>
                </div>
            `;

            new Dialog({
                title: "Chargen Relevant Tables",
                content,
                buttons: {
                    close: { label: "Close" }
                }
            }, { width: 960, height: "auto", classes: ["skilltree-chargen-dialog"] }).render(true);
        } catch (e) {
            ui.notifications.error(e?.message ?? "Unable to open relevant tables.");
            console.error(e);
        }
    }

    async _onChoose(index, cardEl) {
        if (this._actionInFlight) return;
        this._actionInFlight = true;
        const state = this._getState();
        if (!state.run) {
            this._actionInFlight = false;
            return;
        }

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
                if (this._shouldRenderInteractiveUi()) this.render(true);
                return;
            }

            const cardNodes = Array.from(this.element?.find(".chargen-card") ?? []);
            for (const [i, node] of cardNodes.entries()) {
                if (!(node instanceof HTMLElement)) continue;
                if (i === index) node.classList.add("is-selected");
                else node.classList.add("is-flipped", "is-rejected");
            }

            const data = picked.data;
            const currentTable = await this._getRollTable(run.tableUuid);
            run._bioContext = this._buildBioContext(run, currentTable, picked);
            if (data.bio) await this._addBio(run, String(data.bio));

            const reward = Array.isArray(data.effectTables) && data.effectTables.length
                ? this._resolveRewardFromEffectTables(data.effectTables)
                : this._pickWeightedReward(Array.isArray(data.rewards) ? data.rewards : []);
            if (!reward) throw new Error("No valid reward could be selected.");

            await this._applyChanges(run, reward.changes ?? []);

            const packageInfo = this._getNextPackageInfo(run, currentTable);
            if (packageInfo) {
                await this._applyChanges(run, [packageInfo.package.gain]);
                if (!run.packageProgress || typeof run.packageProgress !== "object") {
                    run.packageProgress = {};
                }
                run.packageProgress[packageInfo.stageKey] =
                    Number(run.packageProgress[packageInfo.stageKey] ?? 0) + 1;

                const packageLabel = String(packageInfo.package.label ?? "").trim()
                    || summarizeRewardChange(packageInfo.package.gain)
                    || "Career package";
                await this._addBio(run, `Career package: ${packageLabel}`, {
                    kind: "package",
                    stageKey: packageInfo.stageKey,
                    packageIndex: packageInfo.index
                });
            }

            const fromUuid = run.tableUuid;
            const fromName = await this._getTableName(fromUuid);
            const fromTable = currentTable;
            if (this._isCareerAdvancementTable(fromTable)) {
                run.careerAdvancementEligible = true;
                run.careerAdvancementSource = fromName;
            }
            advanceDeferredQueue(run);
            const deferred = extractDeferredFromChoice(data, fromName);
            if (deferred) {
                await enqueueDeferred(run, deferred);
            }

            const rewardNextUuid = String(reward?.next?.tableUuid ?? "").trim();
            let nextUuid = rewardNextUuid;
            let transitionState = "";
            if (
                rewardNextUuid
                && rewardNextUuid !== fromUuid
                && String(reward?.transitionMode ?? "").trim().toLowerCase() === "optional"
            ) {
                const takeTransition = await this._promptOptionalTransition({
                    fromName,
                    toUuid: rewardNextUuid,
                    prompt: reward?.transitionPrompt
                });
                if (!takeTransition) {
                    nextUuid = fromUuid;
                    transitionState = "declined";
                    const declinedTargetName = await this._getTableName(rewardNextUuid);
                    await this._addBio(
                        run,
                        declinedTargetName
                            ? `You chose to remain on ${fromName} instead of moving to ${declinedTargetName}.`
                            : `You chose to remain on ${fromName}.`,
                        {
                            kind: "transition",
                            toTableName: declinedTargetName,
                            memorable: false
                        }
                    );
                } else {
                    transitionState = "chosen";
                }
            } else if (rewardNextUuid && rewardNextUuid !== fromUuid) {
                transitionState = "forced";
            }

            run.remainingGlobal = Math.max(0, Number(run.remainingGlobal ?? 0) - 1);
            run.history.push({
                tableUuid: run.tableUuid,
                fromIsCareerAdvancementTable: this._isCareerAdvancementTable(fromTable),
                fromName,
                choiceTitle: data.choice?.title ?? "",
                rewardApplied: reward,
                transitionState,
                terminal: !nextUuid
            });
            if (nextUuid && nextUuid !== fromUuid) {
                if (reward.transitionText) {
                    const toTable = await this._getRollTable(nextUuid);
                    const toStage = this._getBioStageFromTable(toTable);
                    await this._addBio(run, String(reward.transitionText), {
                        kind: "transition",
                        memorable: toStage === "advanced",
                        priority: toStage === "advanced" ? 3 : 1,
                        toStage,
                        toTableName: String(toTable?.name ?? "").trim()
                    });
                }
            } else if (!nextUuid) {
                const choiceTitle = String(data.choice?.title ?? "").trim();
                const terminalReason = reward.transitionText
                    ? String(reward.transitionText).trim()
                    : (choiceTitle
                        ? `${choiceTitle} brought this chapter of your life to an end.`
                        : `${fromName} came to an end here.`);
                if (terminalReason) {
                    await this._addBio(run, terminalReason, {
                        kind: "transition",
                        memorable: true,
                        priority: 2
                    });
                }
            }

            run.reveal = {
                isDeferred: false,
                chosenIndex: index,
                fromUuid,
                fromName,
                image: String(data?.choice?.icon ?? "").trim(),
                ...(await this._buildRevealSummary(run, reward, nextUuid, transitionState))
            };

            await new Promise(r => setTimeout(r, 520));
            await this._setState({ ...state, run });
            if (this._shouldRenderInteractiveUi()) this.render(true);

        } catch (e) {
            ui.notifications.error(e.message);
            console.error(e);
        } finally {
            delete run._bioContext;
            this._actionInFlight = false;
        }
    }

    async _onContinue() {
        if (this._actionInFlight) return;
        this._actionInFlight = true;
        const state = this._getState();
        const run = state.run;
        const reveal = run?.reveal;
        if (!run || !reveal) {
            this._actionInFlight = false;
            return;
        }

        try {
            if (reveal.isDeferred) {
                const payload = reveal.payload ?? {};
                if (Array.isArray(payload.changes) && payload.changes.length) {
                    await this._applyChanges(run, payload.changes);
                }
                if (reveal.text) {
                    const line = `The past returns: ${reveal.text}`;
                    await this._addBio(run, line, {
                        kind: "deferred",
                        memorable: true,
                        priority: 3,
                        summaryText: line
                    });
                }
                if (Array.isArray(payload.enqueue)) {
                    for (const entry of payload.enqueue) {
                        await enqueueDeferred(run, entry);
                    }
                }

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
                await this._maybeGrantCareerLiteracy(run, run.tableUuid);
                run.reveal = null;
                run.cards = await this._rollCards(run);
                await this._setState({ ...state, run });
                if (this._shouldRenderInteractiveUi()) this.render(true);
                return;
            }

            const deferredReveal = await buildDeferredReveal(this, run);
            if (deferredReveal) {
                run.reveal = {
                    ...reveal,
                    ...deferredReveal
                };
                await this._setState({ ...state, run });
                if (this._shouldRenderInteractiveUi()) this.render(true);
                return;
            }

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
            await this._maybeGrantCareerLiteracy(run, run.tableUuid);
            run.reveal = null;
            run.cards = await this._rollCards(run);
            await this._setState({ ...state, run });
            if (this._shouldRenderInteractiveUi()) this.render(true);
        } catch (e) {
            ui.notifications.error(e?.message ?? "Unable to continue.");
            console.error(e);
        } finally {
            this._actionInFlight = false;
        }
    }
    async _getItemDocFromSpec(spec) {
        return await SkillTreeChargenApp._resolveItemSpecDoc(getLegacyMappedRef(spec));
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
                await this._addBio(run, `Item: ${name} (${cur} â†’ ${next})`);
                return;
            }
        }

        // Create embedded copy
        const data = itemDoc.toObject();
        // If your CSB item template uses a quantity field, set it
        foundry.utils.setProperty(data, "system.props.Quantity", Number.isFinite(qty) ? qty : 1);

        await this.actor.createEmbeddedDocuments("Item", [data]);
        await this._addBio(run, `Item: ${name}${qty !== 1 ? ` Ã—${qty}` : ""}`);
    }

    async _finishWithSummary(run) {
        const state = this._getState();
        await this._maybeApplyCareerAdvancementBundle(state, run);

        if (this._simulationEnabled()) {
            this._simulation.lastOutcome = this._buildSimulationOutcome(run);
        }

        const actor = this.actor;
        const bioHtml = (run.bio ?? []).map(s => `<li>${foundry.utils.escapeHTML(String(s))}</li>`).join("");
        const compiledBioHtml = this._renderCompiledBiographyHtml(run.bioEvents ?? []);
        const finalBiographyHtml = compiledBioHtml || this._getBiographyHtml();

        await actor.update({
            "system.props.Biography": finalBiographyHtml,
            "system.props.BiographyCompiled": compiledBioHtml,
            "system.props.BiographyDetailed": bioHtml ? `<ul>${bioHtml}</ul>` : ""
        });

        if (!this._simulationOption("suppressChat", false)) {
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: `
        <h3>Character Generation Finished</h3>
        ${compiledBioHtml ? `<p><b>Life summary</b></p>${compiledBioHtml}` : ""}
        <p><b>${foundry.utils.escapeHTML(actor.name)}</b> biography:</p>
        <ul>${bioHtml}</ul>
      `
            });
        }

        if (!this._simulationOption("suppressNotifications", false)) {
            ui.notifications.info("Character generation finished.");
        }
        await this._setState({ ...this._getState(), run: null });
        if (!this._simulationEnabled()) {
            this.close();
        }
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

    // âœ… allow negative steps, but clamp to minimum
    const afterIndex = Math.max(0, beforeIndex + Number(steps ?? 0));

    const { dice, mod } = indexToStat(afterIndex);

    await actor.update({
        [`system.props.${dKey}`]: dice,
        [`system.props.${mKey}`]: mod
    });

    return { dice, mod };
}
