// scripts/init.js
import { SkillTreeChargenApp } from "./chargen.js";
import { importWorldContent } from "./import-world-content.js";
import { getChargenSettings, registerChargenSettings } from "./settings.js";

Hooks.once("init", () => {
    registerChargenSettings();
});

Hooks.once("ready", () => {
    globalThis.SkillTreeChargen = {
        open: async (opts = {}) => {
            try {
                const settings = getChargenSettings();
                await SkillTreeChargenApp.open({
                    ...opts,
                    startingTable: String(opts.startingTable ?? "").trim() || settings.startingTable
                });
            } catch (err) {
                console.error("SkillTreeChargen.open failed:", err);
                ui.notifications.error(err?.message ?? "Chargen failed to load. See console (F12).");
            }
        },
        validate: async (opts = {}) => {
            try {
                const settings = getChargenSettings();
                const report = await SkillTreeChargenApp.validateEnvironment({
                    ...opts,
                    startingTable: String(opts.startingTable ?? "").trim() || settings.startingTable
                });
                const status = report.ok ? "OK" : "FAILED";
                console.group(`SkillTreeChargen.validate: ${status}`);
                console.log("Errors:", report.errors.length);
                console.log("Warnings:", report.warnings.length);
                if (report.errors.length) console.table(report.errors);
                if (report.warnings.length) console.table(report.warnings);
                if (report.careerValidation) {
                    console.log("Visited career tables:", report.careerValidation.visited?.length ?? 0);
                    console.log("Career edges:", report.careerValidation.edges?.length ?? 0);
                    console.log("Auxiliary refs:", report.careerValidation.auxiliaryRefs?.length ?? 0);
                    console.log("Terminal entries:", report.careerValidation.terminalResults?.length ?? 0);
                }
                console.groupEnd();
                ui.notifications[report.ok ? "info" : "error"](
                    `Chargen validation ${report.ok ? "passed" : "failed"} (${report.errors.length} error(s), ${report.warnings.length} warning(s)). See console.`
                );
                return report;
            } catch (err) {
                console.error("SkillTreeChargen.validate failed:", err);
                ui.notifications.error(err?.message ?? "Validation failed. See console (F12).");
                throw err;
            }
        },
        validateFolder: async (folderUuid, opts = {}) => {
            try {
                const report = await SkillTreeChargenApp.validateAndClassifyTablesInFolder(folderUuid, opts);
                const byTypeText = Object.entries(report.byType ?? {})
                    .map(([k, v]) => `${k}:${v}`)
                    .join(", ");
                const issueCount = (report.reports ?? []).reduce(
                    (sum, entry) => sum + Number(entry.validation?.issueCount ?? 0),
                    0
                );
                ui.notifications[report.ok ? "info" : "warn"](
                    `Folder validation ${report.ok ? "passed" : "has issues"} (${report.tableCount} tables, ${issueCount} issue(s)). ${byTypeText}`
                );
                return report;
            } catch (err) {
                console.error("SkillTreeChargen.validateFolder failed:", err);
                ui.notifications.error(err?.message ?? "Folder validation failed. See console (F12).");
                throw err;
            }
        },
        listTables: async (opts = {}) => {
            try {
                return await SkillTreeChargenApp.listRollTablesForValidation(opts);
            } catch (err) {
                console.error("SkillTreeChargen.listTables failed:", err);
                ui.notifications.error(err?.message ?? "List tables failed. See console (F12).");
                throw err;
            }
        },
        showTableList: async (opts = {}) => {
            try {
                return await SkillTreeChargenApp.showRollTableValidationList(opts);
            } catch (err) {
                console.error("SkillTreeChargen.showTableList failed:", err);
                ui.notifications.error(err?.message ?? "Show table list failed. See console (F12).");
                throw err;
            }
        },
        importWorldContent: async (opts = {}) => {
            try {
                const report = await importWorldContent(opts);
                ui.notifications.info(
                    `Imported chargen content: ${report.items.created + report.items.updated} items, ${report.rolltables.created + report.rolltables.updated} rolltables.`
                );
                console.group("SkillTreeChargen.importWorldContent");
                console.log(report);
                console.groupEnd();
                return report;
            } catch (err) {
                console.error("SkillTreeChargen.importWorldContent failed:", err);
                ui.notifications.error(err?.message ?? "World content import failed. See console (F12).");
                throw err;
            }
        }
    };

    console.log("SkillTreeChargen registered:", globalThis.SkillTreeChargen);
});
