/**
 * Content discovery for the Cosmere RPG.
 *
 * Everything is read from compendiums at runtime, so the wizard follows
 * whatever the installed handbooks contain instead of hard-coding book data.
 * Each entry is tagged with a source (core / roshar / scadrial / homebrew)
 * and the Scadrial eras it is legal in.
 */
import { MODULE_ID, toArray, plainText } from "../../constants.js";
import { getSetting } from "./settings.js";

export const PACKAGE_SOURCES = {
  "cosmere-rpg": "core",
  "cosmere-rpg-stormlight-handbook": "roshar",
  "cosmere-rpg-mistborn-handbook": "scadrial",
};

export const SOURCE_LABELS = {
  core: "Core",
  roshar: "Stormlight",
  scadrial: "Mistborn",
  homebrew: "Homebrew",
};

/** The world/setting options shown on the first step. */
export const SETTINGS = {
  roshar: {
    id: "roshar", label: "Roshar", subtitle: "The Stormlight Archive",
    blurb: "Highstorms, spren and shattered plains. Heroes begin on a heroic path and may later swear Radiant oaths.",
    sources: ["core", "roshar"], eras: false, icon: "fa-solid fa-cloud-bolt",
  },
  scadrial: {
    id: "scadrial", label: "Scadrial", subtitle: "Mistborn",
    blurb: "Ash, mist and metal. Choose an era; Metalborn heroes can begin play with their powers.",
    sources: ["core", "scadrial"], eras: true, icon: "fa-solid fa-smog",
  },
  mixed: {
    id: "mixed", label: "Mixed", subtitle: "Stormlight + Mistborn",
    blurb: "A crossover game. Content from both handbooks is available; pick an era to filter Scadrial options.",
    sources: ["core", "roshar", "scadrial"], eras: "optional", icon: "fa-solid fa-circle-nodes",
  },
  other: {
    id: "other", label: "Other World", subtitle: "Homebrew or another Shard",
    blurb: "Everything installed is on the table, including homebrew compendiums and world items.",
    sources: ["core", "roshar", "scadrial", "homebrew"], eras: false, icon: "fa-solid fa-star-of-life",
  },
};

const ORIGIN_TYPES = ["ancestry", "culture", "path"];
const GEAR_TYPES = ["weapon", "armor", "equipment", "loot"];

export class ContentIndex {
  constructor() {
    this.ready = false;
    this.entries = { ancestry: [], culture: [], path: [] };
    this.gear = [];
    this.trees = new Map(); // tree uuid → expanded nodes
    this.talents = new Map(); // talent uuid → entry
    this.hiddenPacks = 0;
  }

  async load() {
    if (this.ready) return this;
    for (const pack of game.packs) {
      if (pack.documentName !== "Item") continue;
      if (!pack.testUserPermission?.(game.user, "OBSERVER") && !game.user.isGM) {
        this.hiddenPacks += 1;
        continue;
      }
      const source = PACKAGE_SOURCES[pack.metadata.packageName] ?? "homebrew";
      const index = await pack.getIndex({ fields: ["type", "img", "system.price"] });
      const typesHere = new Set(index.map((e) => e.type));

      for (const type of ORIGIN_TYPES) {
        if (!typesHere.has(type)) continue;
        const docs = await pack.getDocuments({ type });
        for (const doc of docs) this.entries[type].push(this.#makeEntry(doc, source));
      }

      for (const e of index) {
        if (!GEAR_TYPES.includes(e.type)) continue;
        this.gear.push({
          uuid: e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`,
          name: e.name, img: e.img, type: e.type, source,
          sourceLabel: SOURCE_LABELS[source],
          isKit: /\bkit\b/i.test(e.name),
        });
      }
    }

    // World items count as homebrew (filtered out later unless allowed).
    for (const item of game.items) {
      if (ORIGIN_TYPES.includes(item.type)) this.entries[item.type].push(this.#makeEntry(item, "homebrew"));
      else if (GEAR_TYPES.includes(item.type)) {
        this.gear.push({
          uuid: item.uuid, name: item.name, img: item.img, type: item.type,
          source: "homebrew", sourceLabel: SOURCE_LABELS.homebrew, isKit: /\bkit\b/i.test(item.name),
        });
      }
    }

    for (const list of Object.values(this.entries)) list.sort((a, b) => a.name.localeCompare(b.name));
    this.gear.sort((a, b) => a.name.localeCompare(b.name));
    this.ready = true;
    return this;
  }

  #makeEntry(doc, source) {
    const system = doc.system ?? {};
    return {
      uuid: doc.uuid,
      id: system.id ?? doc.id,
      name: doc.name,
      img: doc.img,
      type: doc.type,
      pathType: doc.type === "path" ? (system.type ?? "heroic") : null,
      source,
      sourceLabel: SOURCE_LABELS[source],
      summary: plainText(system.description?.short || system.description?.value, 170),
      eras: eraTagsFor(doc),
      grants: readEventGrants(doc),
      talentTree: system.talentTree ?? null,
      advancement: doc.type === "ancestry" ? foundry.utils.deepClone(doc._source.system?.advancement ?? {}) : null,
      linkedSkills: toArray(system.linkedSkills),
      doc,
    };
  }

  /**
   * Filter entries for a world + era choice.
   * Handbook versions replace core duplicates (same type + system id).
   */
  list(type, { world, era }) {
    const setting = SETTINGS[world] ?? SETTINGS.other;
    const allowed = new Set(setting.sources);
    if (getSetting("includeHomebrew")) allowed.add("homebrew");

    const pool = this.entries[type].filter((e) => allowed.has(e.source) && eraAllows(e.eras, era));
    const handbookIds = new Set(pool.filter((e) => e.source === "roshar" || e.source === "scadrial").map((e) => e.id));
    return pool.filter((e) => !(e.source === "core" && handbookIds.has(e.id)));
  }

  gearList({ world }) {
    const setting = SETTINGS[world] ?? SETTINGS.other;
    const allowed = new Set(setting.sources);
    if (getSetting("includeHomebrew")) allowed.add("homebrew");
    return this.gear.filter((g) => allowed.has(g.source));
  }

  find(uuid) {
    for (const list of Object.values(this.entries)) {
      const hit = list.find((e) => e.uuid === uuid);
      if (hit) return hit;
    }
    return this.talents.get(uuid) ?? null;
  }

  /**
   * Expand a talent tree (and nested specialty trees) into flat talent nodes.
   * Specialties that the era rules exclude are skipped entirely.
   */
  async expandTree(treeUuid, era, specialty = null, seen = new Set()) {
    if (!treeUuid || seen.has(treeUuid)) return [];
    seen.add(treeUuid);
    const cacheKey = `${treeUuid}|${era ?? "any"}`;
    if (this.trees.has(cacheKey)) return this.trees.get(cacheKey);

    const tree = await fromUuid(treeUuid);
    if (!tree) return [];
    const out = [];
    const nodes = toArray(tree.system?.nodes);

    await Promise.all(nodes.map(async (node) => {
      if (node.type === "tree") {
        const sub = await fromUuid(node.uuid);
        const subName = sub?.name ?? specialty;
        if (!eraAllows(eraTagsFor(sub), era)) return;
        out.push(...await this.expandTree(node.uuid, era, subName, seen));
        return;
      }
      if (node.type !== "talent") return;
      const talent = await this.#talentEntry(node.uuid);
      if (!talent || !eraAllows(talent.eras, era)) return;
      out.push({
        nodeId: node.id,
        talentId: node.talentId ?? talent.id,
        uuid: node.uuid,
        tree: tree.name,
        specialty: specialty ?? tree.name,
        prerequisites: toArray(node.prerequisites).map(normalizePrereq),
        talent,
      });
    }));

    this.trees.set(cacheKey, out);
    return out;
  }

  async #talentEntry(uuid) {
    if (!uuid) return null;
    if (this.talents.has(uuid)) return this.talents.get(uuid);
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const entry = this.#makeEntry(doc, PACKAGE_SOURCES[doc.pack?.split(".")[0]] ?? "homebrew");
    this.talents.set(uuid, entry);
    return entry;
  }

  /**
   * The key talent of a path: the first talent its add-to-actor events grant,
   * or, failing that, a root node of its talent tree with no prerequisites.
   */
  async keyTalent(entry) {
    if (!entry || entry.type !== "path") return null;
    if (entry._keyTalent !== undefined) return entry._keyTalent;
    let key = null;
    for (const uuid of entry.grants.items) {
      const t = await this.#talentEntry(uuid);
      if (t?.type === "talent") { key = t; break; }
    }
    if (!key && entry.talentTree) {
      const tree = await fromUuid(entry.talentTree);
      const root = toArray(tree?.system?.nodes).find((n) => n.type === "talent" && !toArray(n.prerequisites).length);
      if (root) key = await this.#talentEntry(root.uuid);
    }
    entry._keyTalent = key;
    return key;
  }

  /** Talents granted automatically by chosen items (for prerequisite checks). */
  async grantedTalents(entries) {
    const result = [];
    for (const entry of entries) {
      if (!entry) continue;
      const granted = [];
      for (const uuid of entry.grants.items) {
        const t = await this.#talentEntry(uuid);
        if (t && t.type === "talent") granted.push(t);
      }
      // Paths without a grant event still give their key talent.
      if (entry.type === "path" && !granted.length) {
        const key = await this.keyTalent(entry);
        if (key) granted.push(key);
      }
      result.push(...granted.map((t) => ({ ...t, from: entry.name })));
      // Ancestry "extra talents" up to level 1.
      for (const extra of toArray(entry.advancement?.extraTalents)) {
        if ((extra.level ?? 1) > 1) continue;
        const t = await this.#talentEntry(extra.uuid);
        if (t) result.push({ ...t, from: entry.name });
      }
    }
    return result;
  }
}

/* -------------------------------------------- */
/*  Helpers                                      */
/* -------------------------------------------- */

/** Which eras an item belongs to. null = every era. */
export function eraTagsFor(doc) {
  if (!doc) return null;
  const own = doc.flags?.[MODULE_ID]?.eras;
  if (Array.isArray(own) && own.length) return own.map(Number);

  // Look for an era tag the publisher may have stored in any flag scope.
  for (const scope of Object.values(doc.flags ?? {})) {
    if (!scope || typeof scope !== "object") continue;
    for (const [key, value] of Object.entries(scope)) {
      if (!/^eras?$/i.test(key)) continue;
      const list = (Array.isArray(value) ? value : [value]).map(Number).filter(Number.isFinite);
      if (list.length) return list;
    }
  }

  const rules = getSetting("eraRules") ?? {};
  const names = [doc.name, doc.system?.id].filter(Boolean).map((n) => String(n).toLowerCase());
  for (const [name, eras] of Object.entries(rules)) {
    if (names.includes(name.toLowerCase())) return eras;
  }
  return null;
}

export function eraAllows(eras, era) {
  if (!era || !eras) return true;
  return eras.includes(Number(era));
}

/** Read the add-to-actor event rules that matter for creation. */
export function readEventGrants(doc) {
  const out = { items: [], pickItems: [], skills: [], attributes: [], expertises: [], expertisePicks: 0, runsMacro: false };
  const events = toArray(doc._source?.system?.events ?? doc.system?.events);
  for (const rule of events) {
    if (!rule || rule.disabled) continue;
    if (rule.event !== "add-to-actor") continue;
    const h = rule.handler ?? {};
    switch (h.type) {
      case "grant-items":
        if (h.pickOne) out.pickItems.push(toArray(h.items).map((i) => i.uuid));
        else out.items.push(...toArray(h.items).map((i) => i.uuid));
        break;
      case "modify-skill-rank":
        if (h.skill && h.amount) out.skills.push({ skill: h.skill, amount: Number(h.amount) });
        break;
      case "modify-attribute":
        if (h.attribute && h.amount && !h.bonus) out.attributes.push({ attribute: h.attribute, amount: Number(h.amount) });
        break;
      case "grant-expertises":
        if (h.pick) out.expertisePicks += Number(h.pickAmount ?? 1);
        else out.expertises.push(...toArray(h.expertises).map((e) => ({ id: e.id, type: e.type, label: expertiseLabel(e) })));
        break;
      case "execute-macro":
        out.runsMacro = true;
        break;
    }
  }
  return out;
}

/**
 * Display name of an expertise. Compendium items store localization keys
 * (e.g. "COSMERE.Item.Culture.Type.Luthadel") as labels, so translate them,
 * falling back to the system's expertise registry and then the id.
 */
export function expertiseLabel({ id, type, label }) {
  const isKey = (s) => /^[\w-]+(\.[\w-]+)+$/.test(s);
  const tr = (s) => (s && game.i18n.has(s) ? game.i18n.localize(s) : s);
  const own = tr(label);
  if (own && !isKey(own)) return own;
  const registryKey = CONFIG.COSMERE?.expertiseTypes?.[type]?.configRegistryKey;
  const registered = tr(registryKey ? CONFIG.COSMERE?.[registryKey]?.[id]?.label : null);
  if (registered && !isKey(registered)) return registered;
  return String(id ?? "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizePrereq(p) {
  const raw = typeof p?.toObject === "function" ? p.toObject() : p;
  return {
    id: raw.id,
    type: raw.type,
    mode: raw.mode ?? "any-of",
    talents: toArray(raw.talents).map((t) => ({ id: t.id, uuid: t.uuid, label: t.label })),
    goals: toArray(raw.goals).map((g) => ({ id: g.id, label: g.label })),
    attribute: raw.attribute,
    value: raw.value,
    skill: raw.skill,
    rank: raw.rank,
    level: raw.level,
    ancestry: raw.ancestry ?? null,
    culture: raw.culture ?? null,
    power: raw.power ?? null,
    description: raw.description ?? "",
  };
}
