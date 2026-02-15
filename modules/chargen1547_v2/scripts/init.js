// scripts/init.js
import { SkillTreeChargenApp } from "./chargen.js";

Hooks.once("ready", () => {

  function promptForName() {
    return new Promise((resolve) => {
      const content = `
        <form>
          <div class="form-group">
            <label>Character Name</label>
            <input type="text" name="name" placeholder="Enter a name..." autofocus />
          </div>
        </form>
      `;

      new Dialog({
        title: "Create New Character",
        content,
        buttons: {
          create: {
            label: "Create",
            callback: (html) => {
              const name = String(html.find('input[name="name"]').val() ?? "").trim();
              resolve(name || null);
            }
          },
          cancel: { label: "Cancel", callback: () => resolve(null) }
        },
        default: "create",
        close: () => resolve(null)
      }, { width: 420 }).render(true);
    });
  }

  globalThis.SkillTreeChargen = {
    open: async () => {
      try {
        const name = await promptForName();
        if (!name) return;

        const type = (game.system?.documentTypes?.Actor?.[0]) || "character";

        const actor = await Actor.create({
          name,
          type,
          ownership: {
            default: 0,
            [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
          }
        });

        const app = new SkillTreeChargenApp(actor);

        // Force first table
        const state = app._getState();
        state.setup = state.setup || {};
        state.setup.tableUuid = "RollTable.BI0oL2A7UmceHMSB";
        state.run = null;

        await app._setState(state);
        app.render(true);
      } catch (err) {
        console.error("SkillTreeChargen.open failed:", err);
        ui.notifications.error("Chargen failed to load. See console (F12).");
      }
    }
  };

  console.log("SkillTreeChargen registered:", globalThis.SkillTreeChargen);
});
