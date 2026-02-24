export async function promptAddDrive(actor, category) {
    return new Promise(resolve => {
        new Dialog({
            title: "Define a Drive",
            content: `
        <p><strong>${category}</strong></p>
        <p>Write a conviction that influences your actions.</p>
        <textarea id="drive-text" rows="4" style="width:100%"></textarea>
      `,
            buttons: {
                add: {
                    label: "Add Drive",
                    callback: async html => {
                        const text = html.find("#drive-text").val()?.trim();
                        if (!text) return resolve(false);

                        const line = `[${category}] ${text}`;

                        const props = actor.system?.props ?? {};
                        const existing = String(props.Drives ?? "").trim();

                        const updated = existing ? `${existing}\n${line}` : line;

                        await actor.update({ "system.props.Drives": updated });
                        resolve(true);
                    }
                },
                skip: {
                    label: "Skip",
                    callback: () => resolve(false)
                }
            },
            default: "add"
        }).render(true);
    });
}


export async function promptRemoveDrive(actor) {
    const props = actor.system?.props ?? {};
    const raw = String(props.Drives ?? "").trim();
    if (!raw) return false;

    const lines = raw.split("\n").map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) return false;

    return new Promise(resolve => {
        new Dialog({
            title: "Lose a Drive",
            content: `
        <p>Select a Drive to remove:</p>
        <form>
          ${lines.map((l, i) => `
            <label>
              <input type="radio" name="drive" value="${i}">
              ${foundry.utils.escapeHTML(l)}
            </label><br>
          `).join("")}
        </form>
      `,
            buttons: {
                remove: {
                    label: "Remove Drive",
                    callback: async html => {
                        const idxStr = html.find("input[name=drive]:checked").val();
                        if (idxStr === undefined) return resolve(false);

                        const idx = Number(idxStr);
                        const updatedLines = lines.filter((_, i) => i !== idx);
                        const updated = updatedLines.join("\n");

                        await actor.update({ "system.props.Drives": updated });
                        resolve(true);
                    }
                },
                cancel: {
                    label: "Keep All",
                    callback: () => resolve(false)
                }
            },
            default: "remove"
        }).render(true);
    });
}
