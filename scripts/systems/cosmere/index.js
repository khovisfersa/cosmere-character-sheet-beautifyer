/**
 * Cosmere RPG adapter.
 */
import { MODULE_ID, TEMPLATE_ROOT } from "../../constants.js";
import { registerSettings as register, getSetting } from "./settings.js";
import { CosmereCreationWizard, STEP_TEMPLATES } from "./wizard.js";

const T = `${TEMPLATE_ROOT}/cosmere`;
const PARTIALS = [
  ...Object.values(STEP_TEMPLATES),
  `${T}/partials/card.hbs`,
  `${T}/partials/budget.hbs`,
];

const REQUIRED = ["cosmere-rpg-stormlight-handbook", "cosmere-rpg-mistborn-handbook"];

export function registerSettings() {
  register();
  foundry.applications.handlebars.loadTemplates(PARTIALS);
}

export function onReady() {
  const missing = REQUIRED.filter((id) => !game.modules.get(id)?.active);
  if (missing.length && game.user.isGM) {
    ui.notifications.warn(`Character Creation Beautifier: activate ${missing.join(" and ")} for full content.`);
  }
}

let open = null;
export function openWizard(options = {}) {
  if (open?.rendered) return open.bringToFront();
  open = new CosmereCreationWizard(options);
  return open.render(true);
}

export function shouldInterceptCreate(data) {
  return data?.type === "character" && getSetting("openOnCreate") && !data.system;
}

export { MODULE_ID };
