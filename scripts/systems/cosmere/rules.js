/**
 * Level-1 creation rules and validation for the Cosmere RPG.
 *
 * Validation policy:
 *   - "warn"  → something is missing. The player sees it but may continue.
 *   - "error" → something is over budget or illegal. Navigation forward and
 *               character creation are blocked until it is fixed.
 */
import { getSetting } from "./settings.js";
import { num } from "../../constants.js";
import { SETTINGS } from "./content.js";

export const STEPS = [
  { id: "setting", label: "Setting", icon: "fa-solid fa-globe", title: "Choose Your World", lede: "Where will this story be told?" },
  { id: "origin", label: "Ancestry & Culture", icon: "fa-solid fa-people-group", title: "Ancestry & Culture", lede: "Who are you, and where do you come from?" },
  { id: "path", label: "Starting Path", icon: "fa-solid fa-route", title: "Starting Path", lede: "Your first path defines how you face the world." },
  { id: "attributes", label: "Attributes", icon: "fa-solid fa-dumbbell", title: "Attributes", lede: "Distribute your attribute points." },
  { id: "skills", label: "Skills", icon: "fa-solid fa-list-check", title: "Skills", lede: "Spend your skill ranks." },
  { id: "expertises", label: "Expertises", icon: "fa-solid fa-graduation-cap", title: "Expertises", lede: "What do you know that others don't?" },
  { id: "talents", label: "Talents", icon: "fa-solid fa-star", title: "Talents", lede: "Choose talents from your path and ancestry trees." },
  { id: "story", label: "Purpose & Goals", icon: "fa-solid fa-feather-pointed", title: "Purpose, Obstacle & Goals", lede: "What drives you, what holds you back, and who stands with you." },
  { id: "equipment", label: "Equipment", icon: "fa-solid fa-sack", title: "Equipment", lede: "Pick a starting kit and any extra gear your GM allows." },
  { id: "identity", label: "Name & Portrait", icon: "fa-solid fa-id-card", title: "Name & Portrait", lede: "Give your hero a face and a name." },
  { id: "review", label: "Review", icon: "fa-solid fa-scroll", title: "Review", lede: "One last look before you step into the story." },
];

export const ATTRIBUTE_KEYS = ["str", "spd", "int", "wil", "awa", "pre"];

export function blankDraft() {
  return {
    version: 1,
    world: null,
    era: null,
    ancestry: null,
    cultures: [],
    path: null,
    bonusPath: null, // heroic path taken with the Human bonus talent (Metalborn starts)
    attributes: Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, 0])),
    skills: {},
    expertises: [],
    talents: [],
    purpose: "",
    obstacle: "",
    goals: [],
    connections: [{ name: "", description: "" }],
    kit: null,
    gear: [],
    name: "",
    img: "icons/svg/mystery-man.svg",
    appearance: "",
  };
}

/** Level-1 advancement rule from the system config. */
const RULE_DEFAULTS = { attributePoints: 12, skillRanks: 4, maxSkillRanks: 2, talents: 1, health: 10 };

export function levelOneRule() {
  const raw = CONFIG.COSMERE?.advancement?.rules;
  const list = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  const first = list.find((r) => num(r?.level, 0) === 1) ?? list[0] ?? {};
  const rule = { ...RULE_DEFAULTS, ...first };
  for (const [k, d] of Object.entries(RULE_DEFAULTS)) rule[k] = num(rule[k], d, `level-1 rule ${k}`);
  return rule;
}

/** Make a saved draft safe: every attribute and skill value becomes a finite number. */
export function sanitizeDraft(draft) {
  const attrs = {};
  for (const k of ATTRIBUTE_KEYS) attrs[k] = Math.max(0, num(draft.attributes?.[k], 0, `draft attribute ${k}`));
  draft.attributes = attrs;
  const skills = {};
  for (const [k, v] of Object.entries(draft.skills ?? {})) {
    const n = Math.max(0, num(v, 0, `draft skill ${k}`));
    if (n) skills[k] = n;
  }
  draft.skills = skills;
  return draft;
}

/** Which path types are legal as a starting path for a world. */
export function startingPathAllowed(entry, draft) {
  if (!entry) return false;
  const heroic = entry.pathType === "heroic";
  if (draft.world === "roshar") return heroic;
  if (draft.world === "scadrial" || draft.world === "mixed") {
    if (heroic) return true;
    return entry.source !== "roshar"; // Metalborn yes, Radiant never at creation
  }
  return true;
}

/**
 * Whether an ancestry bonus talent is restricted to heroic paths.
 * True when the restriction text says so, or for the Human ancestry
 * (Stormlight Handbook: Human bonus talents must come from a heroic path).
 */
export function isHeroicBonus(rule, ancestryEntry) {
  return /heroic/i.test(rule?.restrictions ?? "") || String(ancestryEntry?.id ?? "").toLowerCase() === "human";
}

/**
 * A character whose starting path is not heroic (e.g. a Metalborn path) can
 * spend a heroic-only bonus talent on another heroic path's key talent,
 * gaining that heroic path. Radiant paths are never offered at creation.
 */
export function bonusPathAllowed(ancestryEntry, startingPath) {
  if (!startingPath || startingPath.pathType === "heroic") return false;
  return talentBudget(ancestryEntry).heroicBonus > 0;
}

/**
 * Everything granted automatically by chosen items, so the budgets only count
 * the player's own choices.
 */
export function collectGrants(entries) {
  const skills = {};
  const attributes = {};
  const expertises = [];
  const sources = { skills: {}, attributes: {} };
  let expertisePicks = 0;
  const pickPrompts = [];

  for (const { entry, isStartingPath } of entries) {
    if (!entry) continue;
    const g = entry.grants;
    for (const { skill, amount } of g.skills) {
      skills[skill] = num(skills[skill]) + num(amount);
      (sources.skills[skill] ??= []).push(entry.name);
    }
    for (const { attribute, amount } of g.attributes) {
      attributes[attribute] = num(attributes[attribute]) + num(amount);
      (sources.attributes[attribute] ??= []).push(entry.name);
    }
    expertises.push(...g.expertises.map((e) => ({ ...e, from: entry.name })));
    expertisePicks += g.expertisePicks;
    if (g.pickItems.length) pickPrompts.push(entry.name);

    // Starting path skill (applied by the system's starting-path macro).
    if (isStartingPath) {
      const skill = CONFIG.COSMERE?.startingSkills?.[entry.id];
      if (skill && !g.skills.some((s) => s.skill === skill)) {
        skills[skill] = num(skills[skill]) + 1;
        (sources.skills[skill] ??= []).push(`${entry.name} (starting path)`);
      }
    }
  }
  return { skills, attributes, expertises, expertisePicks, pickPrompts, sources };
}

export function extraExpertiseBudget(draft, grants) {
  const raw = String(getSetting("extraExpertises") ?? "int").trim().toLowerCase();
  if (ATTRIBUTE_KEYS.includes(raw)) return (draft.attributes[raw] ?? 0) + (grants.attributes[raw] ?? 0);
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function talentBudget(ancestryEntry) {
  const rule = levelOneRule();
  const base = rule.talents ?? 1;
  let heroicBonus = 0;
  let anyBonus = 0;
  const bonus = [];
  for (const b of ancestryEntry?.advancement?.bonusTalents ?? []) {
    if ((b.level ?? 0) > 1 || !b.quantity) continue;
    const heroic = isHeroicBonus(b, ancestryEntry);
    if (heroic) heroicBonus += b.quantity;
    else anyBonus += b.quantity;
    bonus.push({ quantity: b.quantity, restrictions: b.restrictions || "", heroic });
  }
  return { base, heroicBonus, anyBonus, total: base + heroicBonus + anyBonus, bonus };
}

/** Evaluate one talent-tree prerequisite against the draft. */
export function prereqStatus(p, state) {
  const { draft, grants, ownedTalentIds, ancestry, cultures, grantedItemIds } = state;
  switch (p.type) {
    case "talent": {
      const ids = p.talents.map((t) => t.id);
      const met = p.mode === "all-of" ? ids.every((id) => ownedTalentIds.has(id)) : ids.some((id) => ownedTalentIds.has(id));
      return { met, label: p.talents.map((t) => t.label).join(p.mode === "all-of" ? " + " : " or ") };
    }
    case "attribute": {
      const total = (draft.attributes[p.attribute] ?? 0) + (grants.attributes[p.attribute] ?? 0);
      const label = game.i18n.localize(CONFIG.COSMERE?.attributes?.[p.attribute]?.label ?? p.attribute);
      return { met: total >= p.value, label: `${label} ${p.value}+` };
    }
    case "skill": {
      const total = (draft.skills[p.skill] ?? 0) + (grants.skills[p.skill] ?? 0);
      const label = game.i18n.localize(CONFIG.COSMERE?.skills?.[p.skill]?.label ?? p.skill);
      return { met: total >= p.rank, label: `${label} ${p.rank}+` };
    }
    case "level":
      return { met: 1 >= (p.level ?? 1), label: `Level ${p.level}` };
    case "ancestry":
      return { met: !!ancestry && (ancestry.id === p.ancestry?.id || ancestry.uuid === p.ancestry?.uuid), label: p.ancestry?.label ?? "Ancestry" };
    case "culture":
      return { met: cultures.some((c) => c.id === p.culture?.id || c.uuid === p.culture?.uuid), label: p.culture?.label ?? "Culture" };
    case "power":
      return { met: grantedItemIds.has(p.power?.id), label: p.power?.label ?? "Power" };
    case "connection":
      return { met: true, soft: true, label: p.description ? `Connection: ${p.description}` : "A connection (check with your GM)" };
    case "goal":
      return { met: true, soft: true, label: p.goals.length ? `Goal: ${p.goals.map((g) => g.label).join(", ")}` : "A goal (check with your GM)" };
    default:
      return { met: true, soft: true, label: p.type };
  }
}

/**
 * Full validation pass. Returns per-step statuses and issues, plus the
 * numbers the UI needs for budget pills.
 */
export function evaluate(draft, ctx) {
  const rule = levelOneRule();
  const maxAttr = getSetting("maxAttribute");
  const cultureCount = getSetting("cultureCount");
  const goalCount = getSetting("goalCount");
  const minConnections = getSetting("minConnections");
  const world = SETTINGS[draft.world];

  const issues = Object.fromEntries(STEPS.map((s) => [s.id, []]));
  const warn = (step, text) => issues[step].push({ level: "warn", text });
  const error = (step, text) => issues[step].push({ level: "error", text });

  /* Setting */
  if (!draft.world) warn("setting", "Choose a world.");
  else if (world?.eras === true && !draft.era) warn("setting", "Choose an era for Scadrial.");

  /* Origin */
  if (!draft.ancestry) warn("origin", "Choose an ancestry.");
  if (draft.cultures.length < cultureCount) warn("origin", `Choose ${cultureCount - draft.cultures.length} more culture${cultureCount - draft.cultures.length === 1 ? "" : "s"} (${draft.cultures.length}/${cultureCount}).`);
  if (draft.cultures.length > cultureCount) error("origin", `Too many cultures: ${draft.cultures.length}/${cultureCount}. Remove ${draft.cultures.length - cultureCount}.`);
  if (draft.ancestry && !ctx.ancestry) error("origin", "Your ancestry is not available in this world or era.");
  if (ctx.missingCultures) error("origin", "One of your cultures is not available in this world or era.");

  /* Path */
  if (!draft.path) warn("path", "Choose a starting path.");
  if (draft.path && !ctx.path) error("path", "Your starting path is not available in this world or era.");
  if (ctx.path && !startingPathAllowed(ctx.path, draft)) error("path", `${ctx.path.name} cannot be taken as a starting path in this world.`);

  /* Attributes */
  const attrSpent = ATTRIBUTE_KEYS.reduce((sum, k) => sum + (draft.attributes[k] ?? 0), 0);
  const attrBudget = rule.attributePoints ?? 12;
  if (attrSpent > attrBudget) error("attributes", `${attrSpent - attrBudget} point${attrSpent - attrBudget === 1 ? "" : "s"} over budget (${attrSpent}/${attrBudget}).`);
  if (attrSpent < attrBudget) warn("attributes", `${attrBudget - attrSpent} attribute point${attrBudget - attrSpent === 1 ? "" : "s"} left to spend.`);
  for (const k of ATTRIBUTE_KEYS) {
    if ((draft.attributes[k] ?? 0) > maxAttr) error("attributes", `${attrLabel(k)} is above the maximum of ${maxAttr}.`);
  }

  /* Skills */
  const skillSpent = Object.values(draft.skills).reduce((a, b) => a + (b ?? 0), 0);
  const skillBudget = rule.skillRanks ?? 4;
  if (skillSpent > skillBudget) error("skills", `${skillSpent - skillBudget} rank${skillSpent - skillBudget === 1 ? "" : "s"} over budget (${skillSpent}/${skillBudget}).`);
  if (skillSpent < skillBudget) warn("skills", `${skillBudget - skillSpent} skill rank${skillBudget - skillSpent === 1 ? "" : "s"} left to spend.`);
  for (const [k, v] of Object.entries(draft.skills)) {
    const total = (v ?? 0) + (ctx.grants.skills[k] ?? 0);
    if (total > rule.maxSkillRanks) error("skills", `${skillLabel(k)} would be rank ${total}; the maximum at level 1 is ${rule.maxSkillRanks}.`);
  }

  /* Expertises */
  const expBudget = extraExpertiseBudget(draft, ctx.grants);
  const expCount = draft.expertises.length;
  if (expCount > expBudget) error("expertises", `${expCount - expBudget} expertise${expCount - expBudget === 1 ? "" : "s"} too many (${expCount}/${expBudget}).`);
  if (expCount < expBudget) warn("expertises", `${expBudget - expCount} expertise${expBudget - expCount === 1 ? "" : "s"} left to choose.`);
  const seen = new Set(ctx.grants.expertises.map((e) => `${e.type}:${e.id}`));
  for (const e of draft.expertises) {
    const key = `${e.type}:${e.id}`;
    if (seen.has(key)) error("expertises", `Duplicate expertise: ${e.label}.`);
    seen.add(key);
  }

  /* Talents */
  const tb = talentBudget(ctx.ancestry);
  const tBudget = tb.total;
  const tSpent = draft.talents.length + (draft.bonusPath ? 1 : 0);
  if (tSpent > tBudget) error("talents", `${tSpent - tBudget} talent${tSpent - tBudget === 1 ? "" : "s"} too many (${tSpent}/${tBudget}).`);
  if (tSpent < tBudget) warn("talents", `${tBudget - tSpent} talent${tBudget - tSpent === 1 ? "" : "s"} left to choose.`);
  const nonHeroicPicks = draft.talents.filter((u) => ctx.talentNodes.find((n) => n.uuid === u)?.heroic === false).length;
  if (nonHeroicPicks > tb.base + tb.anyBonus) {
    error("talents", "Your ancestry bonus talent must come from a heroic path. Swap one non-heroic talent for a heroic one.");
  }
  if (draft.bonusPath) {
    if (!ctx.bonusPath) error("talents", "Your bonus heroic path is not available in this world or era.");
    else if (!bonusPathAllowed(ctx.ancestry, ctx.path)) error("talents", `${ctx.bonusPath.name} can only be taken with a heroic bonus talent when your starting path is not heroic.`);
    else if (ctx.bonusPath.uuid === ctx.path?.uuid) error("talents", "Your bonus heroic path must differ from your starting path.");
  }
  for (const uuid of draft.talents) {
    const node = ctx.talentNodes.find((n) => n.uuid === uuid);
    if (!node) error("talents", `A chosen talent is no longer available (${ctx.talentName?.(uuid) ?? "unknown"}).`);
    else if (!node.eligible) error("talents", `${node.talent.name}: prerequisites not met (${node.unmet.join(", ")}).`);
  }

  /* Story */
  if (!plain(draft.purpose)) warn("story", "Write your purpose.");
  if (!plain(draft.obstacle)) warn("story", "Write your obstacle.");
  const goals = draft.goals.filter((g) => g?.trim());
  if (goals.length < goalCount) warn("story", `${goalCount - goals.length} goal${goalCount - goals.length === 1 ? "" : "s"} left to write (${goals.length}/${goalCount}).`);
  if (goals.length > goalCount) error("story", `Too many goals: ${goals.length}/${goalCount}.`);
  const conns = draft.connections.filter((c) => c?.name?.trim());
  if (conns.length < minConnections) warn("story", `Add at least ${minConnections} connection${minConnections === 1 ? "" : "s"}.`);

  /* Equipment */
  if (!draft.kit && !draft.gear.length) warn("equipment", "No equipment chosen.");

  /* Identity */
  if (!draft.name?.trim()) warn("identity", "Give your character a name.");

  // Review aggregates everything.
  const all = STEPS.filter((s) => s.id !== "review").flatMap((s) => issues[s.id].map((i) => ({ ...i, step: s.id, stepLabel: s.label })));
  const statuses = Object.fromEntries(STEPS.map((s) => {
    const list = s.id === "review" ? all : issues[s.id];
    const status = list.some((i) => i.level === "error") ? "error" : list.some((i) => i.level === "warn") ? "warn" : "ok";
    return [s.id, status];
  }));

  const budgets = {
    attributes: { spent: attrSpent, total: attrBudget, max: maxAttr, label: "Attribute points" },
    skills: { spent: skillSpent, total: skillBudget, max: rule.maxSkillRanks, label: "Skill ranks" },
    expertises: { spent: expCount, total: expBudget, label: "Expertises" },
    talents: { spent: tSpent, total: tBudget, label: "Talents" },
    cultures: { spent: draft.cultures.length, total: cultureCount, label: "Cultures" },
    goals: { spent: goals.length, total: goalCount, label: "Goals" },
  };
  for (const b of Object.values(budgets)) {
    b.over = b.spent > b.total;
    b.done = b.spent === b.total;
    b.left = b.total - b.spent;
  }

  return {
    issues, statuses, all, budgets,
    hasErrors: all.some((i) => i.level === "error"),
  };
}

export function attrLabel(k) {
  return game.i18n.localize(CONFIG.COSMERE?.attributes?.[k]?.label ?? k);
}
export function skillLabel(k) {
  return game.i18n.localize(CONFIG.COSMERE?.skills?.[k]?.label ?? k);
}
function plain(html) {
  return String(html ?? "").replace(/<[^>]*>/g, "").trim();
}
