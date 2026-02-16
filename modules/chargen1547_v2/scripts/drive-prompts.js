export async function promptAddDrive(actor, category) {
  return new Promise(resolve => {
    new Dialog({
      title: "Define a Drive",
      content: `
        <p><strong>${category}</strong></p>
        <p>Because of what happened, you developed a strong belief.</p>
        <textarea id="drive-text" rows="4" style="width:100%"></textarea>
      `,
      buttons: {
        add: {
          label: "Add Drive",
          callback: async html => {
            const text = html.find("#drive-text").val()?.trim();
            if (!text) return resolve(false);

            const drives = foundry.utils.deepClone(actor.system.drives ?? []);
            drives.push({
              id: foundry.utils.randomID(),
              category,
              text
            });

            await actor.update({ "system.drives": drives });
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
  const drives = actor.system.drives ?? [];
  if (drives.length === 0) return false;

  return new Promise(resolve => {
    new Dialog({
      title: "Lose a Drive",
      content: `
        <p>Select a Drive to remove:</p>
        <form>
          ${drives.map(d => `
            <label>
              <input type="radio" name="drive" value="${d.id}">
              <strong>${d.category}:</strong> ${d.text}
            </label><br>
          `).join("")}
        </form>
      `,
      buttons: {
        remove: {
          label: "Remove Drive",
          callback: async html => {
            const id = html.find("input[name=drive]:checked").val();
            if (!id) return resolve(false);

            await actor.update({
              "system.drives": drives.filter(d => d.id !== id)
            });
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
