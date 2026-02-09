import { SkillTreeChargenApp } from "./chargen.js";

Hooks.once("ready", () => {
  // Expose for macros/testing
  globalThis.SkillTreeChargen = {
    open: (actor) => new SkillTreeChargenApp(actor).render(true)
  };
});
