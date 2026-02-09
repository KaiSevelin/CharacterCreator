// scripts/init.js
Hooks.once("ready", () => {
  globalThis.SkillTreeChargen = {
    open: async (actor) => {
      try {
        if (!actor) return ui.notifications.warn("No actor provided.");

        const url = new URL("./chargen.js", import.meta.url);
        url.searchParams.set("v", Date.now()); // cache-bust

        console.log("Importing chargen from:", url.href);

        const { SkillTreeChargenApp } = await import(url.href);
        new SkillTreeChargenApp(actor).render(true);
      } catch (err) {
        console.error("SkillTreeChargen.open failed:", err);
        ui.notifications.error("Chargen failed to load. See console (F12).");
      }
    }
  };

  console.log("SkillTreeChargen registered:", globalThis.SkillTreeChargen);
});

