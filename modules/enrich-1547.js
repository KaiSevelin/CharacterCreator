// scripts/enrich-1547.js
Hooks.once("ready", () => {
    // Capture-phase helps when other listeners stop propagation
    document.body.addEventListener("click", async (ev) => {
        const el = ev.target?.closest?.("a.enricher-1547");
        if (!el) return;

        ev.preventDefault();
        ev.stopPropagation();

        let rolls;
        try {
            rolls = JSON.parse(el.dataset.rolls ?? "[]");
        } catch {
            rolls = [];
        }

        if (!Array.isArray(rolls) || rolls.length === 0) {
            return ui.notifications?.warn("No roll formulas found in @1547[...]");
        }

        const label = el.dataset.label ?? "@1547";
        await show1547RollDialog(rolls, label);
    }, true);

    // Optional: allow keyboard activation (Enter/Space)
    document.body.addEventListener("keydown", async (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        const el = ev.target?.closest?.("a.enricher-1547");
        if (!el) return;
        el.click();
    }, true);
});
Hooks.once("init", () => {
  CONFIG.TextEditor.enrichers.push({
    // @1547[...]{...}
    pattern: /@1547\[([^\]]+)\](?:\{([^}]+)\})?/g,
      enricher: async (match, options) => {
          const raw = match[1] ?? "";
          const label = match[2] ?? "@1547";

          const rolls = raw
              .split("|")
              .map(s => s.trim())
              .filter(Boolean);

          // Store data on the element; do NOT attach listeners here
          const a = document.createElement("a");
          a.classList.add("enricher-1547");
          a.dataset.rolls = JSON.stringify(rolls);
          a.dataset.label = label;
          a.innerHTML = label;

          // Optional: make it behave like a link for accessibility
          a.setAttribute("role", "button");
          a.tabIndex = 0;

          return a;
      },
      replaceParent: false
  });
});

/**
 * Show a dialog listing the formulas and providing Roll buttons.
 */
/**
 * Parse a dice term like "2d4", "d20", "1d6+3" (we will only +/- the leading NdX).
 * Returns { n, faces, rest } where "rest" is any trailing modifier text (like "+3").
 */
function parseDiceTerm(term) {
    const t = term.replace(/\s+/g, "");
    // Match: [count] d [faces] [rest...]
    // Examples:
    //  "d20" => count omitted
    //  "2d4+3" => rest "+3"
    const m = t.match(/^(\d*)d(\d+)(.*)$/i);
    if (!m) return null;

    const n = m[1] === "" ? 1 : Number(m[1]);
    const faces = Number(m[2]);
    const rest = m[3] ?? "";
    if (!Number.isFinite(n) || !Number.isFinite(faces)) return null;

    return { n, faces, rest };
}

function formatDiceTerm({ n, faces, rest }) {
    const count = n === 1 ? "" : String(n);
    return `${count}d${faces}${rest ?? ""}`;
}

function buildCombinedFormula(terms) {
    // terms is an array of strings like ["1d6", "2d4+1"]
    // Join with + and keep each term grouped for clarity
    return terms.map(t => `(${t})`).join(" + ");
}

/**
 * One dialog: list terms with +/- to change the leading dice count,
 * and one Roll button that rolls the combined expression.
 */
async function show1547RollDialog(formulas, titleLabel = "@1547") {
    // Turn initial strings into editable state objects
    const state = formulas.map((f) => {
        const parsed = parseDiceTerm(f);
        // If it isn't a simple NdX..., we still show it but disable +/- safely
        return {
            original: f,
            parsed,                 // {n, faces, rest} or null
            value: parsed ? formatDiceTerm(parsed) : f
        };
    });

    const content = `
    <form class="dialog-1547">
      <p>Adjust dice then roll:</p>
      <div class="dice-list">
        ${state.map((s, i) => {
        const disabled = s.parsed ? "" : "disabled";
        return `
            <div class="dice-row" data-index="${i}">
              <button type="button" class="dice-minus" ${disabled} title="Remove one die">-</button>
              <input type="text" class="dice-term" value="${foundry.utils.escapeHTML(s.value)}" data-index="${i}" />
              <button type="button" class="dice-plus" ${disabled} title="Add one die">+</button>
            </div>
          `;
    }).join("")}
      </div>
      <hr/>
      <p class="hint" style="opacity:.8; font-size:.9em;">
        Roll will combine everything into one roll (e.g. 1d6 + 2d4).
      </p>
    </form>
  `;

    const dlg = new Dialog({
        title: `${titleLabel} Roll`,
        content,
        buttons: {
            roll: {
                icon: '<i class="fas fa-dice"></i>',
                label: "Roll",
                callback: async (html) => {
                    // Read current inputs (player may have edited text manually)
                    const inputs = html.find("input.dice-term").toArray();
                    const terms = inputs
                        .map(i => i.value.trim())
                        .filter(Boolean);

                    if (terms.length === 0) {
                        ui.notifications?.warn("No dice terms to roll.");
                        return;
                    }

                    const combined = buildCombinedFormula(terms);
                    await rollCombinedToChat(combined, titleLabel, terms);
                }
            },
            close: { label: "Close" }
        },
        render: (html) => {
            const updateRow = (idx, newTerm) => {
                const input = html.find(`input.dice-term[data-index="${idx}"]`)[0];
                if (input) input.value = newTerm;
            };

            // +/- handlers
            html.find("button.dice-plus").on("click", (ev) => {
                ev.preventDefault();
                const row = ev.currentTarget.closest(".dice-row");
                const idx = Number(row?.dataset.index);
                const input = html.find(`input.dice-term[data-index="${idx}"]`)[0];
                const term = (input?.value ?? "").trim();
                const parsed = parseDiceTerm(term);
                if (!parsed) return;

                parsed.n = Math.max(1, parsed.n + 1);
                updateRow(idx, formatDiceTerm(parsed));
            });

            html.find("button.dice-minus").on("click", (ev) => {
                ev.preventDefault();
                const row = ev.currentTarget.closest(".dice-row");
                const idx = Number(row?.dataset.index);
                const input = html.find(`input.dice-term[data-index="${idx}"]`)[0];
                const term = (input?.value ?? "").trim();
                const parsed = parseDiceTerm(term);
                if (!parsed) return;

                // Don’t go below 1 die
                parsed.n = Math.max(1, parsed.n - 1);
                updateRow(idx, formatDiceTerm(parsed));
            });
        }
    });

    dlg.render(true);
}

async function rollCombinedToChat(combinedFormula, titleLabel, terms) {
    try {
        const roll = await (new Roll(combinedFormula)).evaluate({ async: true });
        await roll.toMessage({
            flavor: `${titleLabel}: ${terms.join(" + ")}`,
            speaker: ChatMessage.getSpeaker()
        });
    } catch (err) {
        console.error(err);
        ui.notifications?.error(`Invalid combined roll: ${combinedFormula}`);
    }
}

