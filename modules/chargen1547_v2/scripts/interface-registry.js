import CARD_IMAGES from "../cards/cards.js";
import FOUNDRY_ROLLTABLES from "../foundry rolltables/rolltables.js";
import SKILL_INTERFACES from "../skills/skills.js";

export const UNKNOWN_CARD_IMAGE = "media/home/games/1547/Cards/General Unknown.webp";

export const DEFAULT_CONTACT_TABLES = {
    roleTable: "RollTable.BvPhlA2uAb4uo0Ni",
    flavorTable: "RollTable.YBiS5eK7mf7v6V4s",
    toneTable: "RollTable.WGJQlBQ1HgfzMhaY",
    hookTable: "RollTable.hiuQ0wJLCNc7reK7",
    quirkTable: "RollTable.akVp6Ju3EW80CP3N"
};

export const DEFAULT_BODY_TABLE = "RollTable.0lsu5sVbypU2KplI";

export const SPECIAL_BIO_TABLES = {
    esteem: "RollTable.kC0YeELeXOdwDeaJ",
    suspicion: "RollTable.wc0827FvVWKn4eJO",
    secrets: "RollTable.ogCUBgf4giALU7XZ"
};

export const SPECIAL_ITEM_TABLES = {
    blessing: "RollTable.T9L3nhbOJJDslvAE",
    curse: "RollTable.XJp7FU4UxUzU4261"
};

export function normalizeInterfacePath(path) {
    return String(path ?? "").trim().replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

export function buildChargenInterfaceCatalog() {
    const cardsByPath = new Map();
    const skillsByUuid = new Map();
    const rolltablesByUuid = new Map();

    for (const entry of CARD_IMAGES) {
        const path = normalizeInterfacePath(entry?.path);
        if (!path) continue;
        cardsByPath.set(path, entry);
    }

    for (const entry of SKILL_INTERFACES) {
        const uuid = String(entry?.uuid ?? "").trim();
        if (!uuid) continue;
        skillsByUuid.set(uuid, entry);
    }

    for (const entry of FOUNDRY_ROLLTABLES) {
        const uuid = String(entry?.uuid ?? "").trim();
        if (!uuid) continue;
        rolltablesByUuid.set(uuid, entry);
    }

    return {
        cards: CARD_IMAGES,
        skills: SKILL_INTERFACES,
        rolltables: FOUNDRY_ROLLTABLES,
        cardsByPath,
        skillsByUuid,
        rolltablesByUuid,
        externalItemTableRefs: new Set(
            FOUNDRY_ROLLTABLES
                .filter(entry => String(entry?.tableType ?? "").trim().toLowerCase() === "item")
                .map(entry => String(entry.uuid).trim())
        )
    };
}
