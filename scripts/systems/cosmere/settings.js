import { MODULE_ID } from "../../constants.js";

/**
 * Default era rules for Scadrial content. Keys are matched (case-insensitive)
 * against item names, talent-tree (specialty) names and item system ids.
 * Values list the eras the content is available in. Anything not listed is
 * available in every era. A world-level item flag
 *   flags["character-creation-beautifier"].eras = [1, 2]
 * always wins over these rules.
 */
export const DEFAULT_ERA_RULES = {
  Mistborn: [1],
  Feruchemist: [1],
  Ferring: [2],
  Twinborn: [2],
  Gunslinger: [2],
};

export const ERAS = [
  { id: 1, label: "Era 1", subtitle: "The Final Empire", blurb: "Dark fantasy beneath ash and mist. Skaa rebellion, obligators, the Lord Ruler." },
  { id: 2, label: "Era 2", subtitle: "Elendel Basin", blurb: "Pulp adventure in an industrial age. Railways, revolvers, lawkeepers and Twinborn." },
];

export function registerSettings() {
  const reg = (key, data) => game.settings.register(MODULE_ID, key, data);

  reg("openOnCreate", {
    name: "CCB.Settings.OpenOnCreate.Name",
    hint: "CCB.Settings.OpenOnCreate.Hint",
    scope: "world", config: true, type: Boolean, default: false,
  });
  reg("includeHomebrew", {
    name: "CCB.Settings.IncludeHomebrew.Name",
    hint: "CCB.Settings.IncludeHomebrew.Hint",
    scope: "world", config: true, type: Boolean, default: false,
  });
  reg("maxAttribute", {
    name: "CCB.Settings.MaxAttribute.Name",
    hint: "CCB.Settings.MaxAttribute.Hint",
    scope: "world", config: true, type: Number, default: 3,
  });
  reg("cultureCount", {
    name: "CCB.Settings.CultureCount.Name",
    hint: "CCB.Settings.CultureCount.Hint",
    scope: "world", config: true, type: Number, default: 2,
  });
  reg("extraExpertises", {
    name: "CCB.Settings.ExtraExpertises.Name",
    hint: "CCB.Settings.ExtraExpertises.Hint",
    scope: "world", config: true, type: String, default: "int",
  });
  reg("goalCount", {
    name: "CCB.Settings.GoalCount.Name",
    hint: "CCB.Settings.GoalCount.Hint",
    scope: "world", config: true, type: Number, default: 2,
  });
  reg("minConnections", {
    name: "CCB.Settings.MinConnections.Name",
    hint: "CCB.Settings.MinConnections.Hint",
    scope: "world", config: true, type: Number, default: 1,
  });
  reg("eraRules", {
    scope: "world", config: false, type: Object, default: DEFAULT_ERA_RULES,
  });

  game.settings.registerMenu(MODULE_ID, "eraRulesMenu", {
    name: "CCB.Settings.EraRules.Name",
    label: "CCB.Settings.EraRules.Label",
    hint: "CCB.Settings.EraRules.Hint",
    icon: "fa-solid fa-hourglass-half",
    type: EraRulesConfig,
    restricted: true,
  });
}

export const getSetting = (key) => game.settings.get(MODULE_ID, key);

/** Small editor for the era rules (one rule per line: "Name: 1, 2"). */
class EraRulesConfig extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "ccb-era-rules",
    tag: "form",
    classes: ["ccb-era-rules"],
    window: { title: "Era Rules", icon: "fa-solid fa-hourglass-half" },
    position: { width: 460 },
    form: { handler: EraRulesConfig.#onSubmit, closeOnSubmit: true },
  };

  async _renderHTML() {
    const rules = getSetting("eraRules") ?? {};
    const text = Object.entries(rules).map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n");
    const div = document.createElement("div");
    div.innerHTML = `
      <p class="hint">One rule per line, as <code>Name: eras</code>. Names match paths, specialties
      (talent trees), ancestries, cultures and talents. Unlisted content is available in every era.</p>
      <textarea name="rules" rows="12" style="width:100%;font-family:monospace">${foundry.utils.escapeHTML(text)}</textarea>
      <footer class="form-footer" style="margin-top:8px;display:flex;gap:6px">
        <button type="button" data-action="reset"><i class="fa-solid fa-rotate-left"></i> Defaults</button>
        <button type="submit"><i class="fa-solid fa-save"></i> Save</button>
      </footer>`;
    div.querySelector('[data-action="reset"]').addEventListener("click", () => {
      div.querySelector("textarea").value = Object.entries(DEFAULT_ERA_RULES)
        .map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n");
    });
    return div;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  static async #onSubmit(event, form, formData) {
    const rules = {};
    for (const line of String(formData.object.rules ?? "").split("\n")) {
      const [name, eras] = line.split(":");
      if (!name?.trim() || !eras) continue;
      const list = eras.split(",").map((e) => Number(e.trim())).filter((n) => Number.isFinite(n));
      if (list.length) rules[name.trim()] = list;
    }
    await game.settings.set(MODULE_ID, "eraRules", rules);
  }
}
