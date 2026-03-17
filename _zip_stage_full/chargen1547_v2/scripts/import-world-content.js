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

async function importDocumentsOfType({
    rootPath,
    files,
    documentType,
    folderRootName,
    filePredicate,
    documentClass
}) {
    const folderCache = new Map();
    const rootFolder = await ensureFolderPath(documentType, [folderRootName], folderCache);
    let created = 0;
    let updated = 0;

    const selected = files.filter(filePredicate).sort((a, b) => a.localeCompare(b));
    for (const file of selected) {
        const dirParts = relativeDirParts(rootPath, file);
        const folder = await ensureFolderPath(documentType, [folderRootName, ...dirParts], folderCache) ?? rootFolder;
        const data = await loadImportJSON(file);
        const result = await upsertWorldDocument(documentClass, data, folder);
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
    const itemFiles = files.filter(isItemImportFile);
    const tableFiles = files.filter(isRollTableImportFile);

    if (!itemFiles.length && !tableFiles.length) {
        throw new Error(`No importable JSON files found under ${rootPath}.`);
    }

    const itemReport = await importDocumentsOfType({
        rootPath,
        files,
        documentType: "Item",
        folderRootName: rootFolderName,
        filePredicate: isItemImportFile,
        documentClass: Item
    });

    const rollTableReport = await importDocumentsOfType({
        rootPath,
        files,
        documentType: "RollTable",
        folderRootName: rootFolderName,
        filePredicate: isRollTableImportFile,
        documentClass: RollTable
    });

    return {
        ok: true,
        rootPath,
        rootFolderName,
        totals: {
            files: itemFiles.length + tableFiles.length,
            items: itemReport.fileCount,
            rolltables: rollTableReport.fileCount
        },
        items: itemReport,
        rolltables: rollTableReport
    };
}
