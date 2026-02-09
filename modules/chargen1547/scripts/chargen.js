// scripts/chargen.js
export class SkillTreeChargenApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "skilltree-chargen",
      title: "Character Generation",
      template: "modules/skilltree-helper/templates/chargen.hbs",
      width: 900,
      height: "auto",
      closeOnSubmit: false,
      resizable: true
    });
  }

  constructor(actor, options = {}) {
    super({}, options);
    this.actor = actor;
  }

  // ---------------- State helpers ----------------
  _flagPath() { return "flags.skilltree-helper.chargen"; }

  _getState() {
    const st = foundry.utils.getProperty(this.actor, this._flagPath());
    return st ?? {
      setup: { tableUuid: "", choices: 2, maxRolls: 10 },
      run: null
    };
  }

  async _setState(next) {
    await this.actor.update({ [this._flagPath()]: next });
  }

  _isSetupMode(state) {
    return !state.run;
  }

  // ---------------- RollTable helpers ----------------
  async _getRollTable(uuidOrId) {
    if (!uuidOrId) return null;
    const ref = String(uuidOrId);

    // UUID-ish
    if (ref.includes(".")) {
      const doc = await fromUuid(ref).catch(() => null);
      if (doc?.documentName === "RollTable") return doc;
    }

    // World table id
    return game.tables.get(ref) ?? null;
  }

  _pickDistinct(arr, n) {
    const pool = arr.slice();
    const out = [];
    const count = Math.min(n, pool.length);
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      out.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return out;
  }

  _parseJSONResultText(text, tableName = "RollTable") {
    try {
      const obj = JSON.parse(String(text ?? "").trim());
      if (!obj || typeof obj !== "object") throw new Error("JSON root must be an object.");
      if (!obj.choice?.title) throw new Error("Missing choice.title");
      if (!obj.rewards || !Array.isArray(obj.rewards) || obj.rewards.length === 0) throw new Error("Missing rewards[]");
      return obj;
    } catch (e) {
      throw new Error(`Invalid JSON in ${tableName} result:\n${e.message}\n\nText was:\n${String(text ?? "").slice(0, 500)}`);
    }
  }


  _asNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  _getPropNumber(props, key) {
    const raw = props?.[key];
    if (raw === true) return 1;
    if (raw === false) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  async _applyStatDelta(key, delta) {
    const props = this.actor.system?.props ?? {};
    const cur = this._getPropNumber(props, key);
    const next = cur + this._asNumber(delta);
    await this.actor.update({ [`system.props.${key}`]: String(next) });
  }

  async _grantSkillToward(targetKey, targetLevel, fallback) {
    // Uses your existing function:
    // SkillTree.nextStepToward(actor, targetKey, targetLevel, SkillTree.NODES, item?)
    const st = globalThis.SkillTree;
    if (!st?.nextStepToward || !st?.NODES) {
      console.warn("SkillTree.nextStepToward or SkillTree.NODES not available.");
      // fallback
      if (fallback?.type === "stat") return this._applyStatDelta(fallback.key, fallback.delta);
      return;
    }

    const step = st.nextStepToward(this.actor, targetKey, targetLevel, st.NODES, null);

    // If dead-end (or only Traits_ missing), fallback
    if (step === true) {
      if (fallback?.type === "stat") return this._applyStatDelta(fallback.key, fallback.delta);
      return;
    }

    const nodeName = step.nodeName;
    const nodeLevel = Number(step.nodeLevel) || 0;

    // Grant: set skill to at least nodeLevel
    const props = this.actor.system?.props ?? {};
    const cur = this._getPropNumber(props, nodeName);
    const next = Math.max(cur, nodeLevel);
    await this.actor.update({ [`system.props.${nodeName}`]: String(next) });
    await addBio(
      this.actor,
      this._getState().run,
      `Learned ${nodeName} ${next}`
    );
  }

  async _applyChanges(changes = []) {
    for (const ch of changes) {
      if (!ch || typeof ch !== "object") continue;
          /* ---------- MONEY ---------- */
if (ch.type === "money") {
  const before = Number(this.actor.system?.props?.Inventory_Money ?? 0);
  await addMoney(this.actor, ch.amount ?? 0);
  const after = before + Number(ch.amount ?? 0);

  await addBio(this.actor, this._getState().run, `Received ${after - before} silver`);
}

    /* ---------- CONTACT ---------- */
    if (ch.type === "contact") {
      const prof = await rollOnce(ch.professionTable);
      const reg  = await rollOnce(ch.regionTable);
      const rel  = await rollOnce(ch.connectionTable);

      const contact = `${prof.text} from ${reg.text} (${rel.text})`;
      await appendListProp(actor, "Contacts", contact);
      await addBio(
          this.actor,
          this._getState().run,
          `Gained a contact: ${contact}`
        );
    }

    /* ---------- BODY ---------- */
    if (ch.type === "body") {
      const res = await rollOnce(ch.tableUuid);
      if (res?.text) {
        await appendListProp(this.actor, "BodilyChanges", res.text);
      await addBio(
          this.actor,
          this._getState().run,
          `Bodily change: ${res.text}`
        );
      }
    }

    /* ---------- MISC ---------- */
    if (ch.type === "misc") {
      const res = await rollOnce(ch.tableUuid);
      if (res?.text) {
        await appendListProp(this.actor, "MiscRewards", res.text);
      }
    }

    /* ---------- ITEM ---------- */
    if (ch.type === "item") {
      const res = await rollOnce(ch.tableUuid);
      if (res?.documentCollection && res?.documentId) {
        const item = await fromUuid(`Item.${res.documentId}`);
        if (item) {
          await actor.createEmbeddedDocuments("Item", [{
            ...item.toObject(),
            system: foundry.utils.mergeObject(item.system, { quantity: ch.qty ?? 1 })
          }]);
          await addBio(
              this.actor,
              this._getState().run,
              `Acquired item: ${item.name}`
            );
        }
      }
    }
    if (ch.type === "stat") {
      const steps = Number(ch.steps ?? 1);
      if (!ch.characteristic || steps <= 0) continue;

        const props = this.actor.system?.props ?? {};
        const diceKey = `Stats_${ch.characteristic}Dice`;
        const modKey  = `Stats_${ch.characteristic}Mod`;

        const before = `${props[diceKey] ?? 1}d6+${props[modKey] ?? 0}`;

        const { dice, mod } = await advanceStat(this.actor, ch.characteristic, steps);

        await addBio(
          this.actor,
          this._getState().run,
          `Improved ${ch.characteristic} (${before} → ${dice}d6+${mod})`
        );
    }

      if (ch.type === "skill") {
        await this._grantSkillToward(ch.targetKey, ch.targetLevel, ch.fallback);
      }
    }
  }

function formatStatRoll(props, characteristic) {
  const dice = getNumberProp(props, `Stats_${characteristic}Dice`, 1);
  const mod  = getNumberProp(props, `Stats_${characteristic}Mod`, 0);
  return `${dice}d6${mod ? (mod > 0 ? "+" + mod : mod) : ""}`;
}
async function rollOnce(tableUuidOrId) {
  const table = await fromUuid(tableUuidOrId).catch(() => game.tables.get(tableUuidOrId));
  if (!table) throw new Error(`RollTable not found: ${tableUuidOrId}`);

  const draw = await table.draw({ displayChat: false });
  return draw.results?.[0];
}
async function appendListProp(actor, key, value) {
  const raw = actor.system?.props?.[key] ?? "";
  const list = raw ? raw.split("\n").filter(Boolean) : [];
  list.push(value);
  await actor.update({ [`system.props.${key}`]: list.join("\n") });
}
async function addMoney(actor, amount) {
  const cur = Number(actor.system?.props?.Inventory_Money ?? 0);
  const next = cur + Number(amount ?? 0);
  await actor.update({ "system.props.Inventory_Money": String(next) });
}
  // ---------------- Flow helpers ----------------
  async _rollCards(runState) {
    const table = await this._getRollTable(runState.tableUuid);
    if (!table) throw new Error(`RollTable not found: ${runState.tableUuid}`);

    // Pick X distinct results without consuming the table
    const picked = this._pickDistinct(table.results.contents, runState.choices);
    if (!picked.length) throw new Error(`RollTable "${table.name}" has no results.`);

    const parsed = picked.map(r => ({
      resultId: r.id,
      rawText: r.text,
      data: this._parseJSONResultText(r.text, table.name)
    }));

    return parsed;
  }

  // ---------------- FormApplication ----------------
  async getData() {
    const state = this._getState();

    if (this._isSetupMode(state)) {
      return {
        isSetup: true,
        tableUuid: state.setup.tableUuid ?? "",
        choices: state.setup.choices ?? 2,
        maxRolls: state.setup.maxRolls ?? 10
      };
    }

    return {
      isSetup: false,
      state: state.run,
      cards: state.run.cards.map(c => ({
        title: c.data.choice.title,
        text: c.data.choice.text ?? ""
      })),
      bio: state.run.bio ?? []
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find("[data-action='start']").on("click", () => this._onStart(html));
    html.find("[data-action='reset']").on("click", () => this._onReset());
    html.find("[data-action='reroll']").on("click", () => this._onReroll());
    html.find("[data-action='finish']").on("click", () => this._onFinish());

    html.find("[data-action='choose']").on("click", (ev) => {
      const idx = Number(ev.currentTarget.dataset.index);
      this._onChoose(idx);
    });
  }

  async _onStart(html) {
    const state = this._getState();
    const tableUuid = String(html.find("input[name='tableUuid']").val() ?? "").trim();
    const choices = Math.max(1, Number(html.find("input[name='choices']").val() ?? 2));
    const maxRolls = Math.max(1, Number(html.find("input[name='maxRolls']").val() ?? 10));

    const table = await this._getRollTable(tableUuid);
    if (!table) return ui.notifications.error(`RollTable not found: ${tableUuid}`);

    const run = {
      tableUuid,
      choices,
      remainingGlobal: maxRolls,
      remainingHere: maxRolls, // initial table's allowed rolls = max unless you want separate; you can change later by reward.next.rolls
      bio: [],
      history: [],
      cards: []
    };

    run.cards = await this._rollCards(run);

    await this._setState({ setup: { tableUuid, choices, maxRolls }, run });
    this.render(true);
  }

  async _onReset() {
    await this._setState({
      setup: { tableUuid: "", choices: 2, maxRolls: 10 },
      run: null
    });
    ui.notifications.info("Character generation reset.");
    this.render(true);
  }

  async _onReroll() {
    const state = this._getState();
    if (!state.run) return;

    try {
      state.run.cards = await this._rollCards(state.run);
      await this._setState(state);
      this.render(true);
    } catch (e) {
      ui.notifications.error(e.message);
      console.error(e);
    }
  }

  async _onChoose(index) {
    const state = this._getState();
    if (!state.run) return;

    const run = state.run;
    const picked = run.cards?.[index];
    if (!picked) return;

    try {
      const data = picked.data;

      // add biography line
      if (data.bio) run.bio.push(String(data.bio));

        const rewards = Array.isArray(data.rewards) ? data.rewards : [];

        if (!rewards.length) {
            throw new Error("No rewards defined for this choice.");
        }

        for (const reward of rewards) {
            await this._applyChanges(reward.changes ?? []);
        }


      // record history
      run.history.push({
        tableUuid: run.tableUuid,
        choiceTitle: data.choice?.title ?? "",
        choiceText: data.choice?.text ?? "",
        bio: data.bio ?? "",
        rewardApplied: rewards
      });

      // decrement rolls
      run.remainingGlobal = Math.max(0, (run.remainingGlobal ?? 0) - 1);
      run.remainingHere = Math.max(0, (run.remainingHere ?? 0) - 1);

      // Next table logic (branch)
      const nextUuid = String(reward.next?.tableUuid ?? "").trim();
      const nextRolls = Number(reward.next?.rolls ?? 0);

      const doneByGlobal = run.remainingGlobal <= 0;
      const doneByHere = run.remainingHere <= 0;

      // Finish if:
      // - global cap hit, OR
      // - next is empty AND current table rolls exhausted (or you can finish immediately when next empty)
      if (doneByGlobal || !nextUuid) {
        await this._setState({ ...state, run });
        await this._finishWithSummary(run);
        return;
      }

      // Switch to next table and set remainingHere to nextRolls (if provided), otherwise keep remainingHere as-is
      run.tableUuid = nextUuid;
      run.remainingHere = nextRolls > 0 ? nextRolls : run.remainingHere;

      // roll next set of cards
      run.cards = await this._rollCards(run);

      await this._setState({ ...state, run });
      this.render(true);

    } catch (e) {
      ui.notifications.error(e.message);
      console.error(e);
    }
  }
  function getBioLines(actor) {
  const raw = actor.system?.props?.Biography ?? "";
  return String(raw).split("\n").map(s => s.trim()).filter(Boolean);
}

async function appendBiography(actor, lines) {
  const add = Array.isArray(lines) ? lines : [lines];
  const cur = getBioLines(actor);

  for (const line of add) {
    const t = String(line ?? "").trim();
    if (t) cur.push(t);
  }

  await actor.update({
    "system.props.Biography": cur.join("\n")
  });
}
async function addBio(actor, runState, text) {
  if (!text) return;
  const line = String(text);

  runState.bio.push(line);
  await appendBiography(actor, line);
}
  async _finishWithSummary(run) {
    // Write bio into chat (and keep in flags)
    const actor = this.actor;
    const bioHtml = (run.bio ?? []).map(s => `<li>${foundry.utils.escapeHTML(String(s))}</li>`).join("");

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <h3>Character Generation Finished</h3>
        <p><b>${foundry.utils.escapeHTML(actor.name)}</b> biography:</p>
        <ul>${bioHtml}</ul>
      `
    });

    ui.notifications.info("Character generation finished.");
    // keep state.run as-is (history preserved), but you can also clear it if you prefer:
    // await this._setState({ setup: state.setup, run: null });
  }

  async _onFinish() {
    const state = this._getState();
    if (!state.run) return;
    await this._finishWithSummary(state.run);
  }
}
function getNumberProp(props, key, fallback = 0) {
  const v = props?.[key];
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function advanceStat(actor, characteristic, steps = 1) {
  const diceKey = `Stats_${characteristic}Dice`;
  const modKey  = `Stats_${characteristic}Mod`;

  const props = actor.system?.props ?? {};

  let dice = Math.max(1, getNumberProp(props, diceKey, 1));
  let mod  = Math.max(0, getNumberProp(props, modKey, 0));

  for (let i = 0; i < steps; i++) {
    if (mod < 3) {
      mod += 1;
    } else {
      dice += 1;
      mod = 0;
    }
  }

  await actor.update({
    [`system.props.${diceKey}`]: String(dice),
    [`system.props.${modKey}`]: String(mod)
  });

  return { dice, mod };
}
