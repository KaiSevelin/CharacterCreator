// scripts/init.js
import { SkillTreeChargenApp } from "./chargen.js";

Hooks.once("ready", () => {
    globalThis.SkillTreeChargen = {
        open: async (opts = {}) => {
            try {
                await SkillTreeChargenApp.open(opts);
            } catch (err) {
                console.error("SkillTreeChargen.open failed:", err);
                ui.notifications.error(err?.message ?? "Chargen failed to load. See console (F12).");
            }
        }
    };

    console.log("SkillTreeChargen registered:", globalThis.SkillTreeChargen);
});
