// scripts/chargen.js

export class SkillTreeChargenApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "skilltree-chargen",
      title: "Character Generation",
      template: "modules/chargen1547/templates/chargen.hbs",
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
  _flagPath() {
    // Use your own module id so you don't collide with skilltree-helper flags
    return "flags.1547charactercreator.chargen";
  }

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
      throw new Error(
        `Invalid JSON in ${tableName} result:\n${e.message}\n\nText was:\n${String(text ?? "").slice(0, 500)}`
      );
    }
  }

  _pickWeightedReward(rewards) {
    const list = (rewards ?? [])
      .filter(r => r && typeof r === "object")
      .map(r => ({ ...r, weight: Number(r.weight ?? 1) }));

    if (!list.length) return null;

    const total = list.reduce((s, r) => s + Math.max(0, r.weight), 0);
    if (total <= 0) return list[0];

    let roll = Math.random() * total;
    for (const r of list) {
      roll -= Math.max(0, r.weight);
      if (roll <= 0) return r;
    }
    return list[list.length - 1];
  }

  // ---------------- Props helpers ----------------
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

  async _grantSkillToward(runState, targetKey, targetLevel, fallback) {
    const st = globalThis.SkillTree;

    // If skilltree not available, fallback (optional)
    if (!st?.nextStepToward || !st?.NODES) {
      console.warn("SkillTree.nextStepToward or SkillTree.NODES not available.");
      if (fallback?.type === "stat") {
        await this._applyStatDelta(fallback.key, fallback.delta);
      }
      return;
    }

    const step = st.nextStepToward(this.actor, targetKey, targetLevel, st.NODES, null);

    // If already available (or dead end), fallback
    if (step === true) {
      if (fallback?.type === "stat") {
        await this._applyStatDelta(fallback.key, fallback.delta);
      }
      return;
    }

    const nodeName = step.nodeName;
    const nodeLevel = Number(step.nodeLevel) || 0;

    // Grant: set skill to at least nodeLevel
    const props = this.actor.system?.props ?? {};
    const cur = this._getPropNumber(props, nodeName);
    const next = Math.max(cur, nodeLevel);

    await this.actor.update({ [`system.props.${nodeName}`]: String(next) });
    await this._addBio(runState, `Learned ${nodeName} ${next}`);
  }

  // ---------------- Biography helpers ----------------
  _getBioLines() {
    const raw = this.actor.system?.props?.Biography ?? "";
    return String(raw).split("\n").map(s => s.trim()).filter(Boolean);
  }

  async _appendBiography(lines) {
    const add = Array.isArray(lines) ? lines : [lines];
    const cur = this._getBioLines();

    for (const line of add) {
      const t = String(line ?? "").trim();
      if (t) cur.push(t);
    }

    await this.actor.update({ "system.props.Biography": cur.join("\n") });
  }

  async _addBio(runState, text) {
    if (!text) return;
    const line = String(text);
    runState.bio.push(line);
    await this._appendBiography(line);
  }

  // ---------------- Reward helpers ----------------
  async _rollOnce(tableUuidOrId) {
    const table = await fromUuid(tableUuidOrId).catch(() => game.tables.get(tableUuidOrId));
    if (!table) throw new Error(`RollTable not found: ${tableUuidOrId}`);
    const draw = await table.draw({ displayChat: false });
    return draw.results?.[0];
  }

  async _appendListProp(key, value) {
    const raw = this.actor.system?.props?.[key] ?? "";
    const list = raw ? String(raw).split("\n").filter(Boolean) : [];
    list.push(value);
    await this.actor.update({ [`system.props.${key}`]: list.join("\n") });
  }

  async _addMoney(amount) {
    const cur = Number(this.actor.system?.props?.Inventory_Money ?? 0);
    const next = cur + Number(amount ?? 0);
    await this.actor.update({ "system.props.Inventory_Money": String(next) });
    return { before: cur, after: next };
  }

  async _applyChanges(runState, changes = []) {
    for (const ch of changes) {
      if (!ch || typeof ch !== "object") continue;

      // ---------- MONEY ----------
      if (ch.type === "money") {
        const { before, after } = await this._addMoney(ch.amount ?? 0);
        await this._addBio(runState, `Received ${after - before} silver`);
        continue;
      }

      // ---------- CONTACT ----------
      if (ch.type === "contact") {
        const prof = await this._rollOnce(ch.professionTable);
        const reg = await this._rollOnce(ch.regionTable);
        const rel = await this._rollOnce(ch.connectionTable);

        const contact = `${prof?.text ?? "Unknown"} from ${reg?.text ?? "Unknown"} (${rel?.text ?? "Unknown"})`;
        await this._appendListProp("Contacts", contact);
        await this._addBio(runState, `Gained a contact: ${contact}`);
        continue;
      }

      // ---------- BODY ----------
      if (ch.type === "body") {
        const res = await this._rollOnce(ch.tableUuid);
        if (res?.text) {
          await this._appendListProp("BodilyChanges", res.text);
          await this._addBio(runState, `Bodily change: ${res.text}`);
        }
        continue;
      }

      // ---------- MISC ----------
      if (ch.type === "misc") {
        const res = await this._rollOnce(ch.tableUuid);
        if (res?.text) {
          await this._appendListProp("MiscRewards", res.text);
          await this._addBio(runState, `Misc: ${res.text}`);
        }
        continue;
      }

      // ---------- ITEM ----------
      if (ch.type === "item") {
        const res = await this._rollOnce(ch.tableUuid);

        // If the table result is a compendium/world document link, Foundry will often provide uuid
        // Prefer uuid if present.
        let itemDoc = null;

        if (res?.uuid) {
          itemDoc = await fromUuid(res.uuid).catch(() => null);
        } else if (res?.documentCollection && res?.documentId) {
          // fallback (older shape)
          itemDoc = await fromUuid(`Item.${res.documentId}`).catch(() => null);
        }

        if (itemDoc) {
          const qty = Number(ch.qty ?? 1);
          const obj = itemDoc.toObject();
          obj.system = foundry.utils.mergeObject(obj.system ?? {}, { quantity: qty });
          await this.actor.createEmbeddedDocuments("Item", [obj]);
          await this._addBio(runState, `Acquired item: ${itemDoc.name}${qty > 1 ? ` (x${qty})` : ""}`);
        }
        continue;
      }

      // ---------- STAT (your dice/mod ladder) ----------
      if (ch.type === "stat") {
        const steps = Number(ch.steps ?? 1);
        const characteristic = String(ch.characteristic ?? "").trim();
        if (!characteristic || steps <= 0) continue;

        const props = this.actor.system?.props ?? {};
        const diceKey = `Stats_${characteristic}Dice`;
        const modKey = `Stats_${characteristic}Mod`;

        const beforeDice = Number(props[diceKey] ?? 1);
        const beforeMod = Number(props[modKey] ?? 0);
        const before = `${beforeDice}d6+${beforeMod}`;

        const { dice, mod } = await advanceStat(this.actor, characteristic, steps);
        await this._addBio(runState, `Improved ${characteristic} (${before} → ${dice}d6+${mod})`);
        continue;
      }

      // ---------- SKILL ----------
      if (ch.type === "skill") {
        await this._grantSkillToward(runState, ch.targetKey, ch.targetLevel, ch.fallback);
        continue;
      }
    }
  }

  // ---------------- Flow helpers ----------------
  async _rollCards(runState) {
    const table = await this._getRollTable(runState.tableUuid);
    if (!table) throw new Error(`RollTable not found: ${runState.tableUuid}`);

    const picked = this._pickDistinct(table.results.contents, runState.choices);
    if (!picked.length) throw new Error(`RollTable "${table.name}" has no results.`);

    return picked.map(r => ({
      resultId: r.id,
      rawText: r.text,
      data: this._parseJSONResultText(r.text, table.name)
    }));
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
    const tableUuid = String(html.find("input[name='tableUuid']").val() ?? "").trim();
    const choices = Math.max(1, Number(html.find("input[name='choices']").val() ?? 2));
    const maxRolls = Math.max(1, Number(html.find("input[name='maxRolls']").val() ?? 10));

    const table = await this._getRollTable(tableUuid);
    if (!table) return ui.notifications.error(`RollTable not found: ${tableUuid}`);

    const run = {
      tableUuid,
      choices,
      remainingGlobal: maxRolls,
      remainingHere: maxRolls,
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

      // Always show progression in bio
      await this._addBio(run, `Chose: ${data.choice?.title ?? "Unknown"}`);

      // Optional extra bio from table JSON
      if (data.bio) await this._addBio(run, String(data.bio));

      const rewards = Array.isArray(data.rewards) ? data.rewards : [];
      if (!rewards.length) throw new Error("No rewards defined for this choice.");

      // Pick exactly ONE reward by weight
      const reward = this._pickWeightedReward(rewards);
      if (!reward) throw new Error("No valid reward could be selected.");

      await this._applyChanges(run, reward.changes ?? []);

      // record history
      run.history.push({
        tableUuid: run.tableUuid,
        choiceTitle: data.choice?.title ?? "",
        choiceText: data.choice?.text ?? "",
        bio: data.bio ?? "",
        rewardApplied: reward
      });

      // decrement rolls
      run.remainingGlobal = Math.max(0, (run.remainingGlobal ?? 0) - 1);
      run.remainingHere = Math.max(0, (run.remainingHere ?? 0) - 1);

      // Next table logic (branch) — driven by the chosen reward
      const nextUuid = String(reward.next?.tableUuid ?? "").trim();
      const nextRolls = Number(reward.next?.rolls ?? 0);

      const doneByGlobal = run.remainingGlobal <= 0;

      if (doneByGlobal || !nextUuid) {
        await this._setState({ ...state, run });
        await this._finishWithSummary(run);
        return;
      }

      run.tableUuid = nextUuid;
      run.remainingHere = nextRolls > 0 ? nextRolls : run.remainingHere;

      run.cards = await this._rollCards(run);

      await this._setState({ ...state, run });
      this.render(true);
    } catch (e) {
      ui.notifications.error(e.message);
      console.error(e);
    }
  }

  async _finishWithSummary(run) {
    const actor = this.actor;
    const bioHtml = (run.bio ?? [])
      .map(s => `<li>${foundry.utils.escapeHTML(String(s))}</li>`)
      .join("");

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <h3>Character Generation Finished</h3>
        <p><b>${foundry.utils.escapeHTML(actor.name)}</b> biography:</p>
        <ul>${bioHtml}</ul>
      `
    });

    ui.notifications.info("Character generation finished.");
  }

  async _onFinish() {
    const state = this._getState();
    if (!state.run) return;
    await this._finishWithSummary(state.run);
  }
}

// ---------------- Outside-class helpers ----------------

function getNumberProp(props, key, fallback = 0) {
  const v = props?.[key];
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function advanceStat(actor, characteristic, steps = 1) {
  const diceKey = `Stats_${characteristic}Dice`;
  const modKey = `Stats_${characteristic}Mod`;

  const props = actor.system?.props ?? {};

  let dice = Math.max(1, getNumberProp(props, diceKey, 1));
  let mod = Math.max(0, getNumberProp(props, modKey, 0));

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
