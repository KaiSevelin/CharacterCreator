// scripts/init.js
import { SkillTreeChargenApp } from "./chargen.js";

Hooks.once("ready", () => {
  globalThis.SkillTreeChargen = {
    open: (actor) => {
      if (!actor) return ui.notifications.warn("No actor provided.");
      new SkillTreeChargenApp(actor).render(true);
    }
  };

  console.log("SkillTreeChargen ready:", globalThis.SkillTreeChargen);
});
