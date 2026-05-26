import { importWorldContent } from "./import-world-content.js";

import { STATIC_LEGACY_REF_MAP } from "./legacy-rolltable-map.js";

export const CHARGEN_MODULE_ID = "chargen1547_v2";
export const DEFAULT_STARTING_TABLE = "RollTable.BhHorosc3d6Q7mR4";

const SETTING_KEYS = {
    startingTable: "startingTable",
    contentFolderName: "contentFolderName",
    legacyIdMap: "legacyIdMap",
    maxRolls: "maxRolls",
    careerStatPicks: "careerStatPicks",
    careerSkillPicks: "careerSkillPicks",
    careerManeuverPicks: "careerManeuverPicks"
};

function managedFolderStats(folderName, documentType, collection) {
    const root = game.folders.contents.find(f =>
        f.type === documentType &&
        f.name === folderName &&
        !f.folder
    ) ?? null;

    if (!root) {
        return { root: null, folderCount: 0, documentCount: 0 };
    }

    const folderIds = new Set([root.id]);
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

    const documentCount = collection.contents.filter(doc => {
        const folderId = String(doc.folder?._id ?? doc.folder?.id ?? doc.folder ?? "");
        return folderId && folderIds.has(folderId);
    }).length;

    return {
        root,
        folderCount: folderIds.size,
        documentCount
    };
}

async function confirmDataSetup(folderName) {
    const itemStats = managedFolderStats(folderName, "Item", game.items);
    const tableStats = managedFolderStats(folderName, "RollTable", game.tables);
    const hasExisting = itemStats.documentCount > 0 || tableStats.documentCount > 0;

    const content = `
        <p>This will create or update world content under:</p>
        <ul>
            <li><strong>Items &gt; ${foundry.utils.escapeHTML(folderName)}</strong></li>
            <li><strong>RollTables &gt; ${foundry.utils.escapeHTML(folderName)}</strong></li>
        </ul>
        ${hasExisting ? `
            <p><strong>Warning:</strong> existing managed content was found and may be overwritten.</p>
            <ul>
                <li>Item folders: ${itemStats.folderCount}, items: ${itemStats.documentCount}</li>
                <li>RollTable folders: ${tableStats.folderCount}, rolltables: ${tableStats.documentCount}</li>
            </ul>
        ` : `<p>No existing managed content was found.</p>`}
    `;

    return await Dialog.confirm({
        title: "Setup Character Generator Data",
        content,
        yes: () => true,
        no: () => false,
        defaultYes: false
    });
}

export class ChargenSetupDataMenu extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "chargen1547-setup-data",
            title: "Setup Character Generator Data",
            template: "modules/chargen1547_v2/templates/setup-data.hbs",
            width: 520,
            height: "auto",
            submitOnChange: false,
            closeOnSubmit: true
        });
    }

    constructor(...args) {
        super(...args);
        this._setupInFlight = false;
    }

    getData() {
        const folderName = getChargenSetting(SETTING_KEYS.contentFolderName);
        const itemStats = managedFolderStats(folderName, "Item", game.items);
        const tableStats = managedFolderStats(folderName, "RollTable", game.tables);
        return {
            folderName,
            itemStats,
            tableStats,
            setupInFlight: this._setupInFlight
        };
    }

    activateListeners(html) {
        super.activateListeners(html);
        const button = html[0]?.querySelector("button[type='submit']");
        if (button) {
            button.disabled = this._setupInFlight;
        }
    }

    async _updateObject() {
        if (this._setupInFlight) return;
        this._setupInFlight = true;
        this.render(false);

        const setBusy = (busy) => {
            const button = this.element?.[0]?.querySelector("button[type='submit']");
            if (button) button.disabled = busy;
        };

        const folderName = getChargenSetting(SETTING_KEYS.contentFolderName);
        setBusy(true);

        try {
            const confirmed = await confirmDataSetup(folderName);
            if (!confirmed) return;

            const report = await importWorldContent({ rootFolderName: folderName });
            const { SkillTreeChargenApp } = await import("./chargen.js");
            const installValidation = await SkillTreeChargenApp.validateInstallInterfaces({
                rootFolderName: folderName
            });
            ui.notifications[installValidation.ok ? "info" : "warn"](
                `Setup complete: ${report.items.created + report.items.updated} items, ${report.rolltables.created + report.rolltables.updated} rolltables. Install validation found ${installValidation.errors.length} error(s) and ${installValidation.warnings.length} warning(s).`
            );
        } finally {
            this._setupInFlight = false;
            setBusy(false);
            if (this.rendered) this.render(false);
        }
    }
}

export function registerChargenSettings() {
    game.settings.register(CHARGEN_MODULE_ID, SETTING_KEYS.startingTable, {
        name: "Starting Roll Table",
        hint: "RollTable UUID used as the starting table when none is passed explicitly.",
        scope: "world",
        config: true,
        type: String,
        default: DEFAULT_STARTING_TABLE
    });

    game.settings.register(CHARGEN_MODULE_ID, SETTING_KEYS.contentFolderName, {
        name: "Managed Content Folder Name",
        hint: "Root folder name used when setting up Character Generator items and rolltables.",
        scope: "world",
        config: true,
        type: String,
        default: "Character generator"
    });

    game.settings.register(CHARGEN_MODULE_ID, SETTING_KEYS.maxRolls, {
        name: "Maximum Number of Rolls",
        hint: "Maximum number of life-path table rolls before character generation is forced to end.",
        scope: "world",
        config: true,
        type: Number,
        default: 14
    });

    game.settings.register(CHARGEN_MODULE_ID, SETTING_KEYS.careerStatPicks, {
        name: "Career Advancement Stat Picks",
        hint: "Number of extra stat increases granted in the post-career advancement wizard.",
        scope: "world",
        config: true,
        type: Number,
        default: 3
    });

    game.settings.register(CHARGEN_MODULE_ID, SETTING_KEYS.careerSkillPicks, {
        name: "Career Advancement Skill Picks",
        hint: "Number of extra skill increases granted in the post-career advancement wizard.",
        scope: "world",
        config: true,
        type: Number,
        default: 3
    });

    game.settings.register(CHARGEN_MODULE_ID, SETTING_KEYS.careerManeuverPicks, {
        name: "Career Advancement Maneuver/Reward Picks",
        hint: "Number of maneuver or alternative reward picks granted in the final step of the post-career advancement wizard.",
        scope: "world",
        config: true,
        type: Number,
        default: 2
    });

    game.settings.register(CHARGEN_MODULE_ID, SETTING_KEYS.legacyIdMap, {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    game.settings.registerMenu(CHARGEN_MODULE_ID, "setupData", {
        name: "Setup Data",
        label: "Setup Data",
        hint: "Create or update the managed Character Generator items and rolltables in the world.",
        icon: "fas fa-database",
        type: ChargenSetupDataMenu,
        restricted: true
    });
}

export function getChargenSetting(key) {
    return game.settings.get(CHARGEN_MODULE_ID, key);
}

export function getLegacyMappedRef(ref) {
    const value = String(ref ?? "").trim();
    if (!value) return value;
    const map = getChargenSetting(SETTING_KEYS.legacyIdMap) ?? {};
    return String(STATIC_LEGACY_REF_MAP[value] ?? map[value] ?? value).trim();
}

export function getChargenSettings() {
    return {
        startingTable: String(getChargenSetting(SETTING_KEYS.startingTable) ?? "").trim(),
        contentFolderName: String(getChargenSetting(SETTING_KEYS.contentFolderName) ?? "").trim() || "Character generator",
        maxRolls: Math.max(1, Number(getChargenSetting(SETTING_KEYS.maxRolls) ?? 14) || 14),
        careerStatPicks: Math.max(0, Number(getChargenSetting(SETTING_KEYS.careerStatPicks) ?? 3) || 3),
        careerSkillPicks: Math.max(0, Number(getChargenSetting(SETTING_KEYS.careerSkillPicks) ?? 3) || 3),
        careerManeuverPicks: Math.max(0, Number(getChargenSetting(SETTING_KEYS.careerManeuverPicks) ?? 2) || 2)
    };
}


