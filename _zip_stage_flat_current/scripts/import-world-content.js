const MODULE_ID = "chargen1547_v2";
const VALID_ID_RX = /^[A-Za-z0-9]{16}$/;

function isItemImportFile(path) {
    return /\/fvtt-Item-.*\.json$/i.test(String(path ?? "").replace(/\\/g, "/"));
}

function isRollTableImportFile(path) {
    return /\/fvtt-RollTable-.*\.json$/i.test(String(path ?? "").replace(/\\/g, "/"));
}

function normalizePath(path) {
    return String(path ?? "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function relativeDirParts(rootPath, filePath) {
    const root = normalizePath(rootPath);
    const file = normalizePath(filePath);
    const rel = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
    const parts = rel.split("/");
    parts.pop();
    return parts.filter(Boolean);
}

function isValidFoundryId(id) {
    return VALID_ID_RX.test(String(id ?? "").trim());
}

function hashBase36(seed) {
    let hash = 2166136261;
    const text = String(seed ?? "");
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function makeDeterministicId(seed, usedIds) {
    const normalized = String(seed ?? "").replace(/[^A-Za-z0-9]/g, "");
    const prefix = (normalized.slice(0, 8) || "cgdoc").padEnd(8, "0");
    let attempt = 0;
    while (true) {
        const suffix = hashBase36(`${seed}#${attempt}`).replace(/[^A-Za-z0-9]/g, "").padEnd(8, "0").slice(0, 8);
        const candidate = `${prefix}${suffix}`.slice(0, 16);
        if (!usedIds.has(candidate)) {
            usedIds.add(candidate);
            return candidate;
        }
        attempt += 1;
    }
}

function rewriteStringRefs(value, refMap) {
    const text = String(value ?? "");
    let out = text;
    for (const [oldRef, newRef] of Object.entries(refMap)) {
        if (!oldRef || oldRef === newRef) continue;
        out = out.split(oldRef).join(newRef);
    }
    return out;
}

function rewriteDataRefs(value, refMap, nestedUsedIds, seed, path = "") {
    if (Array.isArray(value)) {
        return value.map((entry, index) => rewriteDataRefs(entry, refMap, nestedUsedIds, seed, `${path}[${index}]`));
    }

    if (value && typeof value === "object") {
        const out = {};
        for (const [key, entry] of Object.entries(value)) {
            if (key === "_id" && typeof entry === "string") {
                out[key] = isValidFoundryId(entry)
                    ? entry
                    : makeDeterministicId(`${seed}:${path}:${key}:${entry}`, nestedUsedIds);
                continue;
            }

            out[key] = rewriteDataRefs(entry, refMap, nestedUsedIds, seed, path ? `${path}.${key}` : key);
        }
        return out;
    }

    if (typeof value === "string") {
        return rewriteStringRefs(value, refMap);
    }

    return value;
}

async function browseRecursive(rootPath) {
    const queue = [normalizePath(rootPath)];
    const seen = new Set();
    const files = [];

    while (queue.length) {
        const current = queue.shift();
        if (!current || seen.has(current)) continue;
        seen.add(current);

        const listing = await FilePicker.browse("data", current);
        for (const dir of listing.dirs ?? []) {
            const normalized = normalizePath(dir);
            if (!seen.has(normalized)) queue.push(normalized);
        }
        for (const file of listing.files ?? []) {
            files.push(normalizePath(file));
        }
    }

    return files;
}

async function ensureFolderPath(documentType, parts, cache) {
    const key = `${documentType}:${parts.join("/")}`;
    if (cache.has(key)) return cache.get(key);

    let parent = null;
    let prefix = [];
    for (const part of parts) {
        prefix.push(part);
        const stepKey = `${documentType}:${prefix.join("/")}`;
        if (cache.has(stepKey)) {
            parent = cache.get(stepKey);
            continue;
        }

        let folder = game.folders.contents.find(f =>
            f.type === documentType &&
            f.name === part &&
            String(f.folder?._id ?? f.folder ?? "") === String(parent?._id ?? parent?.id ?? "")
        );

        if (!folder) {
            folder = await Folder.create({
                name: part,
                type: documentType,
                folder: parent?.id ?? null,
                sorting: "a"
            });
        }

        cache.set(stepKey, folder);
        parent = folder;
    }

    cache.set(key, parent);
    return parent;
}

async function loadImportJSON(path) {
    const response = await fetch(foundry.utils.getRoute(path));
    if (!response.ok) throw new Error(`Failed to fetch ${path}`);
    return await response.json();
}

function buildRefMap(entries) {
    const refMap = {};
    for (const entry of entries) {
        if (!entry.oldId || !entry.newId) continue;
        refMap[`${entry.documentType}.${entry.oldId}`] = `${entry.documentType}.${entry.newId}`;
    }
    return refMap;
}

async function buildImportEntries(files) {
    const usedIds = new Set([
        ...game.items.contents.map(doc => String(doc.id ?? "")),
        ...game.tables.contents.map(doc => String(doc.id ?? ""))
    ]);

    const importFiles = files
        .filter(file => isItemImportFile(file) || isRollTableImportFile(file))
        .sort((a, b) => a.localeCompare(b));

    const entries = [];
    for (const file of importFiles) {
        const data = await loadImportJSON(file);
        const documentType = isItemImportFile(file) ? "Item" : "RollTable";
        const oldId = String(data?._id ?? "").trim();
        const seed = `${documentType}:${oldId || data?.uniqueId || file}`;
        const newId = isValidFoundryId(oldId) ? oldId : makeDeterministicId(seed, usedIds);
        entries.push({
            file,
            data,
            documentType,
            oldId,
            newId
        });
    }

    return entries;
}

async function upsertWorldDocument(documentClass, data, folder) {
    const payload = foundry.utils.deepClone(data);
    payload.folder = folder?.id ?? null;

    const collection = documentClass.metadata.collection;
    const existing = game[collection]?.get(payload._id) ?? null;

    if (existing) {
        payload._id = existing.id;
        await existing.update(payload, { diff: false, recursive: false });
        return { action: "updated", document: existing };
    }

    const created = await documentClass.create(payload, { keepId: true });
    return { action: "created", document: created };
}

async function importEntriesOfType({
    rootPath,
    entries,
    documentType,
    folderRootName,
    documentClass,
    refMap
}) {
    const folderCache = new Map();
    const rootFolder = await ensureFolderPath(documentType, [folderRootName], folderCache);
    const nestedUsedIds = new Set();
    let created = 0;
    let updated = 0;

    const selected = entries.filter(entry => entry.documentType === documentType);
    for (const entry of selected) {
        const dirParts = relativeDirParts(rootPath, entry.file);
        const folder = await ensureFolderPath(documentType, [folderRootName, ...dirParts], folderCache) ?? rootFolder;
        const payload = rewriteDataRefs(foundry.utils.deepClone(entry.data), refMap, nestedUsedIds, entry.file);
        payload._id = entry.newId;
        if (documentType === "Item" && payload.system && typeof payload.system === "object") {
            const sourceUniqueId = String(payload.system.uniqueId ?? "").trim();
            if (sourceUniqueId === entry.oldId || !isValidFoundryId(sourceUniqueId)) {
                payload.system.uniqueId = entry.newId;
            }
        }
        const result = await upsertWorldDocument(documentClass, payload, folder);
        if (result.action === "created") created += 1;
        else updated += 1;
    }

    return {
        fileCount: selected.length,
        created,
        updated
    };
}

export async function importWorldContent(opts = {}) {
    const rootPath = normalizePath(opts.rootPath ?? "modules/chargen1547_v2");
    const rootFolderName = String(opts.rootFolderName ?? "chargen1547_v2").trim() || "chargen1547_v2";

    const files = await browseRecursive(rootPath);
    const entries = await buildImportEntries(files);
    const itemEntries = entries.filter(entry => entry.documentType === "Item");
    const tableEntries = entries.filter(entry => entry.documentType === "RollTable");

    if (!itemEntries.length && !tableEntries.length) {
        throw new Error(`No importable JSON files found under ${rootPath}.`);
    }

    const refMap = buildRefMap(entries);

    const itemReport = await importEntriesOfType({
        rootPath,
        entries,
        documentType: "Item",
        folderRootName: rootFolderName,
        documentClass: Item,
        refMap
    });

    const rollTableReport = await importEntriesOfType({
        rootPath,
        entries,
        documentType: "RollTable",
        folderRootName: rootFolderName,
        documentClass: RollTable,
        refMap
    });

    await game.settings.set(MODULE_ID, "legacyIdMap", refMap);

    return {
        ok: true,
        rootPath,
        rootFolderName,
        totals: {
            files: itemEntries.length + tableEntries.length,
            items: itemReport.fileCount,
            rolltables: rollTableReport.fileCount
        },
        idMapSize: Object.keys(refMap).length,
        items: itemReport,
        rolltables: rollTableReport
    };
}
