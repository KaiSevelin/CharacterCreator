// scripts/init.js

// Register immediately so the global exists even if chargen.js has errors.
globalThis.SkillTreeChargen = {
  open: async (actor) => {
    try {
      if (!actor) return ui.notifications.warn("No actor provided.");

      const mod = game.modules.get("1547charactercreator");
      if (!mod) return ui.notifications.error("Module not found: 1547charactercreator");

      const { SkillTreeChargenApp } = await import(`${mod.path}/scripts/chargen.js`);
      new SkillTreeChargenApp(actor).render(true);
    } catch (err) {
      console.error("SkillTreeChargen.open failed:", err);
      ui.notifications.error(`Chargen failed to load. See console (F12).`);
    }
  }
};

console.log("SkillTreeChargen API registered:", globalThis.SkillTreeChargen);
