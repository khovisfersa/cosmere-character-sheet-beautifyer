/**
 * Character Creation Beautifier
 * Entry point. Picks the adapter for the active game system and wires up
 * the Actor Directory button, the optional "Create Actor" override and the
 * public API (game.modules.get("character-creation-beautifier").api).
 */
import { MODULE_ID } from "./constants.js";
import * as cosmere from "./systems/cosmere/index.js";

/** Supported systems → adapters. Add new systems here. */
const ADAPTERS = {
  "cosmere-rpg": cosmere,
};

let adapter = null;

Hooks.once("init", () => {
  adapter = ADAPTERS[game.system.id] ?? null;
  if (!adapter) return;
  adapter.registerSettings();

  game.modules.get(MODULE_ID).api = {
    open: (options = {}) => adapter.openWizard(options),
  };
});

Hooks.once("ready", () => {
  if (!adapter) return;
  adapter.onReady?.();
});

/* Button at the top of the Actor Directory. */
Hooks.on("renderActorDirectory", (app, html) => {
  if (!adapter) return;
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(".ccb-open-button")) return;
  if (!game.user.can("ACTOR_CREATE")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("ccb-open-button");
  button.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> ${game.i18n.localize("CCB.OpenButton")}`;
  button.addEventListener("click", () => adapter.openWizard());

  const target = root.querySelector(".header-actions") ?? root.querySelector(".directory-header");
  target?.append(button);
});

/* Optional: intercept creation of blank Character actors. */
Hooks.on("preCreateActor", (actor, data, options, userId) => {
  if (!adapter || userId !== game.user.id) return;
  if (options[MODULE_ID]?.fromWizard) return;
  if (!adapter.shouldInterceptCreate?.(data)) return;
  adapter.openWizard({ name: data.name });
  return false;
});
