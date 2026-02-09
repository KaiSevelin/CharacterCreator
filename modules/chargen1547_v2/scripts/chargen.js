// scripts/chargen.js
console.log("CHARGEN.JS LOADED FROM", import.meta.url);

export class SkillTreeChargenApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "skilltree-chargen",
      title: "Character Generation",
      template: "modules/chargen1547_v2/templates/chargen.hbs",
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

  /* ---------------- State helpers ---------------- */

  _flagPath() {
    return "flags.1547charactercreator.chargen";
  }

  _getState() {
    return foundry.utils.getProperty(this.actor, this._flagPath()) ?? {
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

  /* ---------------- Foundry helpers ---------------- */

  async _getRollTable(uuidOrId) {
    if (!uuidOrId) return null;
    const ref = String(uuidOrId).trim();

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
    for (let i = 0; i < Math.min(n, pool.length); i++) {
      const idx = Math.floor(Math.random() * pool.length);
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  _resultRawJSON(result) {
    // FVTT v13: prefer description (TableResult#text is deprecated)
    const d = (result?.description ?? "").trim();
    if (d) return d;

    const t = (result?.text ?? "").trim(); // deprecated fallback
    if (t) return t;

    // Some imports may store JSON in name
    const n = (result?.name ?? "").trim();
    return n;
  }

  _parseJSONResultText(text, tableName = "RollTable") {
    try {
      const obj = JSON.parse(String(text ?? "").trim());
      if (!obj || typeof obj !== "object") throw new Error("JSON root must be an object.");
      if (!obj.choice?.title) throw new Error("Missing choice.title");
      if (!Array.isArray(obj.rewards) || obj.rewards.length === 0) throw new Error("Missing rewards[]");
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

  /* ---------------- Biography helpers ---------------- */

  _getBioLines() {
    return String(this.actor.system?.props?.Biography ?? "")
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean);
  }

  async _appendBiography(lineOrLines) {
    const add = Array.isArray(lineOrLines) ? lineOrLines : [lineOrLines];
    const cur = this._getBioLines();

    for (const line of add) {
      const t = String(line ?? "").trim();
      if (t) cur.push(t);
    }

    await this.actor.update({ "system.props.Biography": cur.join("\n") });
  }

  async _addBio(run, text) {
    if (!text) return;
    const line = String(text);
    run.bio.push(line);
    await this._appendBiography(line);
  }

  /* ---------------- SkillTree hook ---------------- */

  _getPropNumber(key) {
    const raw = this.actor.system?.props?.[key];
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  async _grantSkillToward(run, targetKey, targetLevel, fallback) {
    const st = globalThis.SkillTree;
    if (!st?.nextStepToward || !st?.NODES) {
      // optional fallback
      if (fallback?.type === "stat") {
        await advanceStat(this.actor, fallback.characteristic, Number(fallback.steps ?? 1));
      }
      return;
    }

    const step = st.nextStepToward(this.actor, targetKey, targetLevel, st.NODES, null);

    // If already available, your SkillTree function returns {nodeName,targetLevel} OR true depending on your version.
    // Handle both:
    if (step === true) return;
    if (!step?.nodeName) return;

    // Never grant Traits_
    if (String(step.nodeName).startsWith("Traits_")) return;

    const cur = this._getPropNumber(step.nodeName);
    const next = Math.max(cur, Number(step.nodeLevel ?? 0));

    await this.actor.update({ [`system.props.${step.nodeName}`]: String(next) });
    await this._addBio(run, `Learned ${step.nodeName} ${next}`);
  }

  /* ---------------- Reward helpers ---------------- */

  async _rollOnce(tableUuidOrId) {
    const table = await this._getRollTable(tableUuidOrId);
    if (!table) throw new Error(`RollTable not found: ${tableUuidOrId}`);

    const draw = await table.draw({ displayChat: false });
    const r = draw.results?.[0];
    return {
      result: r,
      raw: this._resultRawJSON(r)
    };
  }

  async _appendListProp(key, value) {
    const raw = String(this.actor.system?.props?.[key] ?? "");
    const list = raw ? raw.split("\n").filter(Boolean) : [];
    list.push(String(value));
    await this.actor.update({ [`system.props.${key}`]: list.join("\n") });
  }

  async _addMoney(amount) {
    const cur = Number(this.actor.system?.props?.Inventory_Money ?? 0);
    const next = cur + Number(amount ?? 0);
    await this.actor.update({ "system.props.Inventory_Money": String(next) });
    return { before: cur, after: next };
  }

  async _applyChanges(run, changes = []) {
    for (const ch of changes) {
      if (!ch || typeof ch !== "object") continue;

      if (ch.type === "money") {
        const { before, after } = await this._addMoney(ch.amount ?? 0);
        await this._addBio(run, `Received ${after - before} silver`);
        continue;
      }

      if (ch.type === "contact") {
        const p = await this._rollOnce(ch.professionTable);
        const r = await this._rollOnce(ch.regionTable);
        const c = await this._rollOnce(ch.connectionTable);

        const prof = p.result?.name ?? p.raw ?? "Unknown";
        const reg  = r.result?.name ?? r.raw ?? "Unknown";
        const rel  = c.result?.name ?? c.raw ?? "Unknown";

        const txt = `${prof} from ${reg} (${rel})`;
        await this._appendListProp("Contacts", txt);
        await this._addBio(run, `Gained a contact: ${txt}`);
        continue;
      }

      if (ch.type === "body") {
        const rr = await this._rollOnce(ch.tableUuid);
        // bodily table: usually the text is plain, not JSON
        const txt = rr.result?.name ?? rr.raw ?? "Unknown";
        await this._appendListProp("BodilyChanges", txt);
        await this._addBio(run, `Bodily change: ${txt}`);
        continue;
      }

      if (ch.type === "misc") {
        const rr = await this._rollOnce(ch.tableUuid);
        const txt = rr.result?.name ?? rr.raw ?? "Unknown";
        await this._addBio(run, `Misc: ${txt}`);
        continue;
      }

      if (ch.type === "stat") {
        const steps = Number(ch.steps ?? 1);
        const characteristic = String(ch.characteristic ?? "").trim();
        if (!characteristic || steps <= 0) continue;

        const dKey = `Stats_${characteristic}Dice`;
        const mKey = `Stats_${characteristic}Mod`;

        const props = this.actor.system?.props ?? {};
        const beforeDice = Number(props[dKey] ?? 1);
        const beforeMod  = Number(props[mKey] ?? 0);
        const before = `${beforeDice}d6+${beforeMod}`;

        const { dice, mod } = await advanceStat(this.actor, characteristic, steps);
        await this._addBio(run, `Improved ${characteristic} (${before} → ${dice}d6+${mod})`);
        continue;
      }

      if (ch.type === "skill") {
        await this._grantSkillToward(run, ch.targetKey, ch.targetLevel, ch.fallback);
        continue;
      }
    }
  }

  /* ---------------- Flow ---------------- */

  async _rollCards(run) {
    const table = await this._getRollTable(run.tableUuid);
    if (!table) throw new Error(`RollTable not found: ${run.tableUuid}`);

    const picked = this._pickDistinct(table.results.contents, run.choices);
    if (!picked.length) throw new Error(`RollTable "${table.name}" has no results.`);

    return picked.map(r => {
      const raw = this._resultRawJSON(r);
      return {
        resultId: r.id,
        rawText: raw,
        data: this._parseJSONResultText(raw, table.name)
      };
    });
  }

  /* ---------------- FormApplication ---------------- */

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
      cards: (state.run.cards ?? []).map(c => ({
        title: c.data.choice.title,
        text: c.data.choice.text ?? "",
        icon: c.data.choice.icon ?? "" // if your template uses it
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

      await this._addBio(run, `Chose: ${data.choice?.title ?? "Unknown"}`);
      if (data.bio) await this._addBio(run, String(data.bio));

      const rewards = Array.isArray(data.rewards) ? data.rewards : [];
      if (!rewards.length) throw new Error("No rewards defined for this choice.");

      // Pick ONE reward by weight
      const reward = this._pickWeightedReward(rewards);
      if (!reward) throw new Error("No valid reward could be selected.");

      await this._applyChanges(run, reward.changes ?? []);

      run.history.push({
        tableUuid: run.tableUuid,
        choiceTitle: data.choice?.title ?? "",
        rewardApplied: reward
      });

      run.remainingGlobal = Math.max(0, Number(run.remainingGlobal ?? 0) - 1);
      run.remainingHere = Math.max(0, Number(run.remainingHere ?? 0) - 1);

      const nextUuid = String(reward.next?.tableUuid ?? "").trim();
      const nextRolls = Number(reward.next?.rolls ?? 0);

      console.log("Chargen next:", {
        current: run.tableUuid,
        nextUuid,
        nextRolls,
        remainingGlobal: run.remainingGlobal
      });

      // Stop if global exhausted OR no next table
      if (run.remainingGlobal <= 0 || !nextUuid) {
        await this._setState({ ...state, run });
        await this._finishWithSummary(run);
        return;
      }

      // Switch table
      run.tableUuid = nextUuid;
      run.remainingHere = nextRolls > 0 ? nextRolls : run.remainingHere;

      // Roll new cards from next table
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
  }

  async _onFinish() {
    const state = this._getState();
    if (!state.run) return;
    await this._finishWithSummary(state.run);
  }
}

/* ---------------- Stat helper ---------------- */

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
    if (mod < 3) mod += 1;
    else { dice += 1; mod = 0; }
  }

  await actor.update({
    [`system.props.${diceKey}`]: String(dice),
    [`system.props.${modKey}`]: String(mod)
  });

  return { dice, mod };
}
