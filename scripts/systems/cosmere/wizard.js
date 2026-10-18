/**
 * The Cosmere character creation wizard (ApplicationV2).
 */
import { MODULE_ID, TEMPLATE_ROOT, toArray, slugify } from "../../constants.js";
import { getSetting, ERAS } from "./settings.js";
import { ContentIndex, SETTINGS } from "./content.js";
import {
  STEPS, ATTRIBUTE_KEYS, blankDraft, levelOneRule, evaluate, collectGrants,
  startingPathAllowed, bonusPathAllowed, talentBudget, prereqStatus,
  extraExpertiseBudget, attrLabel, skillLabel,
} from "./rules.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const T = `${TEMPLATE_ROOT}/cosmere`;
const DRAFT_FLAG = "cosmereDraft";
const DETAIL_STEPS = new Set(["origin", "path", "talents", "equipment"]);

export const STEP_TEMPLATES = Object.fromEntries(STEPS.map((s) => [s.id, `${T}/steps/${s.id}.hbs`]));

export class CosmereCreationWizard extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ccb-cosmere-wizard",
    classes: ["ccb", "ccb-cosmere"],
    window: { title: "CCB.Title", icon: "fa-solid fa-wand-magic-sparkles", resizable: true },
    position: { width: 1180, height: 800 },
    actions: {
      goStep: CosmereCreationWizard.#onGoStep,
      next: CosmereCreationWizard.#onNext,
      back: CosmereCreationWizard.#onBack,
      world: CosmereCreationWizard.#onWorld,
      era: CosmereCreationWizard.#onEra,
      ancestry: CosmereCreationWizard.#onAncestry,
      culture: CosmereCreationWizard.#onCulture,
      path: CosmereCreationWizard.#onPath,
      bonusPath: CosmereCreationWizard.#onBonusPath,
      attr: CosmereCreationWizard.#onAttr,
      skill: CosmereCreationWizard.#onSkill,
      addExpertise: CosmereCreationWizard.#onAddExpertise,
      removeExpertise: CosmereCreationWizard.#onRemoveExpertise,
      talent: CosmereCreationWizard.#onTalent,
      focus: CosmereCreationWizard.#onFocus,
      addConnection: CosmereCreationWizard.#onAddConnection,
      removeConnection: CosmereCreationWizard.#onRemoveConnection,
      kit: CosmereCreationWizard.#onKit,
      gear: CosmereCreationWizard.#onGear,
      portrait: CosmereCreationWizard.#onPortrait,
      reset: CosmereCreationWizard.#onReset,
      create: CosmereCreationWizard.#onCreate,
    },
  };

  static PARTS = {
    sidebar: { template: `${T}/sidebar.hbs` },
    main: { template: `${T}/main.hbs`, scrollable: [".ccb-content", ".ccb-detail-body"] },
    footer: { template: `${T}/footer.hbs` },
  };

  constructor(options = {}) {
    super(options);
    const saved = game.user.getFlag(MODULE_ID, DRAFT_FLAG);
    this.draft = foundry.utils.mergeObject(blankDraft(), saved ?? {}, { inplace: false });
    if (options.name && !this.draft.name) this.draft.name = options.name;
    this.stepIndex = saved?._step ?? 0;
    this.content = new ContentIndex();
    this.focus = null;
    this.enriched = new Map();
    this.creating = false;
    this._save = foundry.utils.debounce(() => this.#persist(), 600);
    this._refreshStatus = foundry.utils.debounce(() => this.render({ parts: ["sidebar", "footer"] }), 250);
  }

  get title() {
    return game.i18n.localize("CCB.Title");
  }

  get step() {
    return STEPS[this.stepIndex];
  }

  /* -------------------------------------------- */
  /*  Context                                      */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    await this.content.load();
    const d = this.draft;
    const filter = { world: d.world ?? "other", era: d.era };
    const world = SETTINGS[d.world] ?? null;

    // Resolve choices against what is legal right now.
    const ancestries = this.content.list("ancestry", filter);
    const cultures = this.content.list("culture", filter);
    const paths = this.content.list("path", filter);
    const ancestry = ancestries.find((e) => e.uuid === d.ancestry) ?? null;
    const chosenCultures = d.cultures.map((u) => cultures.find((e) => e.uuid === u)).filter(Boolean);
    const path = paths.find((e) => e.uuid === d.path) ?? null;
    // Heroic path gained through a heroic-only bonus talent (Metalborn starts).
    const bonusPath = paths.find((e) => e.uuid === d.bonusPath && e.pathType === "heroic") ?? null;

    const grants = collectGrants([
      { entry: ancestry },
      ...chosenCultures.map((entry) => ({ entry })),
      { entry: path, isStartingPath: true },
      { entry: bonusPath },
    ]);

    // Talents granted automatically (key talents, ancestry extras).
    const grantedTalents = await this.content.grantedTalents([ancestry, path, bonusPath]);
    const grantedTalentIds = new Set(grantedTalents.map((t) => t.id));

    // All talent nodes reachable from chosen trees. "heroic" marks talents
    // that a heroic-only bonus talent may be spent on.
    const treeSources = [path, bonusPath, ancestry].filter((e) => e?.talentTree);
    const rawNodes = [];
    for (const src of treeSources) {
      const heroic = src.type === "path" && src.pathType === "heroic";
      const nodes = await this.content.expandTree(src.talentTree, d.era);
      rawNodes.push(...nodes.map((n) => ({ ...n, sourceName: src.name, heroic })));
    }
    const pickedIds = new Set(d.talents.map((u) => rawNodes.find((n) => n.uuid === u)?.talentId).filter(Boolean));
    const prereqState = {
      draft: d, grants, ancestry, cultures: chosenCultures,
      grantedItemIds: grantedTalentIds,
    };
    const talentNodes = rawNodes
      .filter((n) => !grantedTalentIds.has(n.talentId))
      .map((n) => {
        const owned = new Set([...grantedTalentIds, ...pickedIds]);
        owned.delete(n.talentId);
        const prereqs = n.prerequisites.map((p) => ({ ...prereqStatus(p, { ...prereqState, ownedTalentIds: owned }), type: p.type }));
        const unmet = prereqs.filter((p) => !p.met).map((p) => p.label);
        return { ...n, prereqs, unmet, eligible: unmet.length === 0, picked: d.talents.includes(n.uuid) };
      });

    const evalCtx = {
      ancestry, path, bonusPath, grants, talentNodes,
      missingCultures: chosenCultures.length !== d.cultures.length,
      talentName: (uuid) => this.content.find(uuid)?.name,
    };
    const result = evaluate(d, evalCtx);
    this.result = result;

    const context = {
      draft: d,
      world,
      theme: d.world ?? "neutral",
      step: this.step,
      stepIndex: this.stepIndex,
      stepNumber: this.stepIndex + 1,
      stepCount: STEPS.length,
      isFirst: this.stepIndex === 0,
      isLast: this.stepIndex === STEPS.length - 1,
      stepTemplate: STEP_TEMPLATES[this.step.id],
      steps: STEPS.map((s, i) => ({
        ...s, index: i, number: i + 1,
        active: i === this.stepIndex,
        status: result.statuses[s.id],
        issueCount: result.issues[s.id]?.length ?? 0,
      })),
      issues: result.issues[this.step.id],
      currentStatus: result.statuses[this.step.id],
      hasErrors: result.hasErrors,
      warnCount: result.all.filter((i) => i.level === "warn").length,
      errorCount: result.all.filter((i) => i.level === "error").length,
      stepBlocked: result.issues[this.step.id].some((i) => i.level === "error"),
      budgets: result.budgets,
      creating: this.creating,
      showDetail: DETAIL_STEPS.has(this.step.id),
      worldLabel: world ? `${world.label}${d.era ? ` · Era ${d.era}` : ""}` : "No world chosen",
    };

    // Only build what the current step needs.
    const builders = {
      setting: () => this.#ctxSetting(context),
      origin: () => this.#ctxOrigin(context, ancestries, cultures),
      path: () => this.#ctxPath(context, paths),
      attributes: () => this.#ctxAttributes(context, grants),
      skills: () => this.#ctxSkills(context, grants, [ancestry, path, bonusPath, ...chosenCultures]),
      expertises: () => this.#ctxExpertises(context, grants, chosenCultures),
      talents: () => this.#ctxTalents(context, { talentNodes, grantedTalents, ancestry, path, bonusPath, paths, treeSources }),
      story: () => this.#ctxStory(context),
      equipment: () => this.#ctxEquipment(context),
      identity: () => {},
      review: () => this.#ctxReview(context, { ancestry, chosenCultures, path, bonusPath, grants, grantedTalents, talentNodes }),
    };
    await builders[this.step.id]?.();

    if (context.showDetail) context.detail = await this.#detail();
    return context;
  }

  #ctxSetting(context) {
    const d = this.draft;
    context.worlds = Object.values(SETTINGS).map((w) => ({ ...w, selected: d.world === w.id }));
    context.showEras = !!SETTINGS[d.world]?.eras;
    context.eraOptional = SETTINGS[d.world]?.eras === "optional";
    context.eras = ERAS.map((e) => ({ ...e, selected: Number(d.era) === e.id }));
    context.hiddenPacks = this.content.hiddenPacks;
    const counts = { core: 0, roshar: 0, scadrial: 0, homebrew: 0 };
    for (const list of Object.values(this.content.entries)) for (const e of list) counts[e.source] += 1;
    context.missingBooks = [
      !counts.roshar && "Stormlight Handbook",
      !counts.scadrial && "Mistborn Handbook",
    ].filter(Boolean);
  }

  #ctxOrigin(context, ancestries, cultures) {
    const d = this.draft;
    context.ancestries = ancestries.map((e) => card(e, d.ancestry === e.uuid));
    context.cultures = cultures.map((e) => card(e, d.cultures.includes(e.uuid)));
    context.noAncestries = !ancestries.length;
    context.noCultures = !cultures.length;
  }

  #ctxPath(context, paths) {
    const d = this.draft;
    const starting = paths.filter((p) => startingPathAllowed(p, d));
    context.heroicPaths = starting.filter((p) => p.pathType === "heroic").map((e) => card(e, d.path === e.uuid));
    context.investedStarting = starting.filter((p) => p.pathType !== "heroic").map((e) => card(e, d.path === e.uuid, typeLabel(e)));
    const humanBonus = talentBudget(this.content.find(d.ancestry)).heroicBonus > 0;
    context.metalbornHint = humanBonus && context.investedStarting.length > 0;
    context.noPaths = !starting.length;
  }

  #ctxAttributes(context, grants) {
    const d = this.draft;
    const b = context.budgets.attributes;
    const groups = CONFIG.COSMERE?.attributeGroups ?? {};
    context.attributeGroups = Object.entries(groups).map(([gid, g]) => ({
      id: gid,
      label: game.i18n.localize(g.label ?? gid),
      attributes: toArray(g.attributes).map((k) => {
        const value = d.attributes[k] ?? 0;
        const granted = grants.attributes[k] ?? 0;
        return {
          key: k, label: attrLabel(k), value, granted, total: value + granted,
          pips: Array.from({ length: b.max }, (_, i) => ({ filled: i < value })),
          canInc: value < b.max && b.spent < b.total,
          canDec: value > 0,
          over: value > b.max,
        };
      }),
    }));
    const str = d.attributes.str + (grants.attributes.str ?? 0);
    const wil = d.attributes.wil + (grants.attributes.wil ?? 0);
    const rule = levelOneRule();
    context.derived = [
      { label: "Health", value: (rule.health ?? 10) + (rule.healthIncludeStrength !== false ? str : 0), icon: "fa-solid fa-heart" },
      { label: "Focus", value: 2 + wil, icon: "fa-solid fa-brain" },
    ];
    context.remaining = b.total - b.spent;
  }

  #ctxSkills(context, grants, entries) {
    const d = this.draft;
    const b = context.budgets.skills;
    const linked = new Set(entries.filter(Boolean).flatMap((e) => e.linkedSkills ?? []));
    const skills = CONFIG.COSMERE?.skills ?? {};
    const byAttr = {};
    for (const [key, cfg] of Object.entries(skills)) {
      const granted = grants.skills[key] ?? 0;
      if (!cfg.core && !granted && !linked.has(key)) continue;
      const bought = d.skills[key] ?? 0;
      const total = bought + granted;
      const attrTotal = (d.attributes[cfg.attribute] ?? 0) + (grants.attributes[cfg.attribute] ?? 0);
      (byAttr[cfg.attribute] ??= []).push({
        key, label: skillLabel(key), bought, granted, total,
        mod: attrTotal + total,
        grantedFrom: (grants.sources.skills[key] ?? []).join(", "),
        pips: Array.from({ length: b.max }, (_, i) => ({ granted: i < granted, bought: i >= granted && i < total })),
        canInc: total < b.max && b.spent < b.total,
        canDec: bought > 0,
        over: total > b.max,
      });
    }
    context.skillGroups = ATTRIBUTE_KEYS.filter((k) => byAttr[k]).map((k) => ({
      key: k, label: attrLabel(k), score: (d.attributes[k] ?? 0) + (grants.attributes[k] ?? 0), skills: byAttr[k],
    }));
    context.remaining = b.total - b.spent;
  }

  #ctxExpertises(context, grants, chosenCultures) {
    const d = this.draft;
    const typeLabel = (type) => game.i18n.localize(CONFIG.COSMERE?.expertiseTypes?.[type]?.label ?? type);
    context.grantedExpertises = grants.expertises.map((e) => ({ ...e, typeLabel: typeLabel(e.type) }));
    context.cultureNames = chosenCultures.map((c) => c.name);
    context.expertisePicks = grants.expertisePicks;
    context.chosenExpertises = d.expertises.map((e) => ({ ...e, key: `${e.type}:${e.id}`, typeLabel: typeLabel(e.type) }));
    const taken = new Set([...grants.expertises, ...d.expertises].map((e) => `${e.type}:${e.id}`));
    context.expertiseTypes = Object.entries(CONFIG.COSMERE?.expertiseTypes ?? {}).map(([id, cfg], i) => {
      const registry = cfg.configRegistryKey ? CONFIG.COSMERE?.[cfg.configRegistryKey] ?? {} : {};
      const options = Object.entries(registry)
        .map(([oid, o]) => ({ id: oid, label: game.i18n.localize(o?.label ?? oid) }))
        .filter((o) => !taken.has(`${id}:${o.id}`))
        .sort((a, b) => a.label.localeCompare(b.label));
      return { id, label: game.i18n.localize(cfg.label), icon: cfg.icon, options, hasOptions: options.length > 0, first: i === 0 };
    });
    context.expertiseBudget = extraExpertiseBudget(d, grants);
    context.expertiseFormula = String(getSetting("extraExpertises")).toLowerCase() === "int" ? "equal to your Intellect" : "set by your GM";
    context.remaining = context.budgets.expertises.total - context.budgets.expertises.spent;
  }

  async #ctxTalents(context, { talentNodes: nodes, grantedTalents: granted, ancestry, path, bonusPath, paths, treeSources }) {
    const d = this.draft;
    const budget = talentBudget(ancestry);
    const b = context.budgets.talents;
    const full = b.spent >= b.total;
    // Non-heroic picks may only use the base slot(s) and unrestricted bonuses.
    const nonHeroicUsed = d.talents.filter((u) => nodes.find((n) => n.uuid === u)?.heroic === false).length;
    const nonHeroicFull = nonHeroicUsed >= budget.base + budget.anyBonus;

    context.talentBonus = budget.bonus;
    context.grantedTalents = granted.map((t) => ({ name: t.name, img: t.img, from: t.from, uuid: t.uuid }));

    // Another heroic path through the bonus talent.
    context.bonusOffer = bonusPathAllowed(ancestry, path);
    if (context.bonusOffer) {
      const heroic = paths.filter((p) => p.pathType === "heroic" && p.uuid !== path?.uuid);
      context.bonusPaths = await Promise.all(heroic.map(async (p) => {
        const key = await this.content.keyTalent(p);
        const selected = d.bonusPath === p.uuid;
        return {
          ...card(p, selected, key ? `Key talent: ${key.name}` : "Heroic path"),
          locked: !selected && (!!d.bonusPath || full),
        };
      }));
      context.bonusPathName = bonusPath?.name ?? null;
    }

    const groups = new Map();
    for (const n of nodes) {
      const key = `${n.sourceName} › ${n.specialty}`;
      if (!groups.has(key)) groups.set(key, { label: n.specialty, source: n.sourceName, heroic: n.heroic, talents: [] });
      groups.get(key).talents.push({
        uuid: n.uuid, name: n.talent.name, img: n.talent.img, summary: n.talent.summary,
        picked: n.picked, eligible: n.eligible, prereqs: n.prereqs,
        locked: !n.picked && (!n.eligible || full || (!n.heroic && nonHeroicFull)),
      });
    }
    context.talentGroups = [...groups.values()].map((g) => {
      g.talents.sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.name.localeCompare(b.name));
      g.eligibleCount = g.talents.filter((t) => t.eligible).length;
      return g;
    });
    context.noTrees = !treeSources.length;
    context.remaining = b.total - b.spent;
  }

  #ctxStory(context) {
    const d = this.draft;
    const goalCount = getSetting("goalCount");
    context.goalFields = Array.from({ length: Math.max(goalCount, d.goals.length) }, (_, i) => ({
      index: i, value: d.goals[i] ?? "", extra: i >= goalCount,
    }));
    context.connections = d.connections.map((c, i) => ({ ...c, index: i }));
  }

  #ctxEquipment(context) {
    const d = this.draft;
    const gear = this.content.gearList({ world: d.world ?? "other" });
    context.kits = gear.filter((g) => g.isKit).map((g) => ({ ...g, selected: d.kit === g.uuid }));
    context.gearGroups = ["weapon", "armor", "equipment", "loot"].map((type) => ({
      type,
      label: { weapon: "Weapons", armor: "Armor", equipment: "Equipment", loot: "Other" }[type],
      items: gear.filter((g) => g.type === type && !g.isKit).map((g) => ({ ...g, selected: d.gear.includes(g.uuid) })),
    })).filter((g) => g.items.length);
    context.chosenGear = d.gear.map((u) => gear.find((g) => g.uuid === u)).filter(Boolean);
  }

  #ctxReview(context, data) {
    const d = this.draft;
    context.review = {
      name: d.name || "Unnamed hero",
      img: d.img,
      ancestry: data.ancestry?.name ?? "—",
      cultures: data.chosenCultures.map((c) => c.name).join(", ") || "—",
      path: data.path?.name ?? "—",
      bonusPath: data.bonusPath?.name ?? null,
      attributes: ATTRIBUTE_KEYS.map((k) => ({ label: attrLabel(k), value: (d.attributes[k] ?? 0) + (data.grants.attributes[k] ?? 0) })),
      skills: Object.keys(CONFIG.COSMERE?.skills ?? {})
        .map((k) => ({ label: skillLabel(k), rank: (d.skills[k] ?? 0) + (data.grants.skills[k] ?? 0) }))
        .filter((s) => s.rank > 0),
      expertises: [...data.grants.expertises, ...d.expertises].map((e) => e.label),
      talents: [...data.grantedTalents.map((t) => t.name), ...d.talents.map((u) => data.talentNodes.find((n) => n.uuid === u)?.talent.name).filter(Boolean)],
      goals: d.goals.filter((g) => g?.trim()),
      connections: d.connections.filter((c) => c.name?.trim()).map((c) => c.name),
      pickPrompts: data.grants.pickPrompts,
    };
    context.allIssues = this.result.all.map((i) => ({ ...i, isError: i.level === "error" }));
  }

  async #detail() {
    if (!this.focus) return null;
    let entry = this.content.find(this.focus);
    if (!entry) {
      // Gear and other items not in the origin index.
      const doc = await fromUuid(this.focus);
      if (!doc) return null;
      const gear = this.content.gear.find((g) => g.uuid === this.focus);
      entry = { uuid: doc.uuid, name: doc.name, img: doc.img, type: doc.type, doc,
        source: gear?.source ?? "homebrew", sourceLabel: gear?.sourceLabel ?? "Homebrew", eras: null };
    }
    if (!this.enriched.has(entry.uuid)) {
      const html = entry.doc?.system?.description?.value ?? "";
      const TextEditor = foundry.applications.ux.TextEditor.implementation;
      this.enriched.set(entry.uuid, await TextEditor.enrichHTML(html, { async: true, relativeTo: entry.doc }));
    }
    return {
      name: entry.name, img: entry.img, source: entry.sourceLabel, sourceKey: entry.source,
      typeLabel: entry.type === "path" ? typeLabel(entry) : (entry.type ?? "").replace(/^./, (c) => c.toUpperCase()),
      eras: entry.eras?.map((e) => `Era ${e}`).join(", ") ?? null,
      html: this.enriched.get(entry.uuid),
    };
  }

  /* -------------------------------------------- */
  /*  Rendering hooks                              */
  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    root.dataset.theme = context.theme;

    // Two-way binding for inputs: update the draft, refresh status only.
    root.querySelectorAll("[data-bind]").forEach((el) => {
      if (el.dataset.ccbBound) return;
      el.dataset.ccbBound = "1";
      const handler = () => {
        foundry.utils.setProperty(this.draft, el.dataset.bind, el.value);
        this._save();
        this._refreshStatus();
      };
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });

    // Client-side search filters (no re-render, keeps focus).
    root.querySelectorAll("[data-filter]").forEach((input) => {
      if (input.dataset.ccbBound) return;
      input.dataset.ccbBound = "1";
      input.addEventListener("input", () => {
        const q = input.value.trim().toLowerCase();
        const scope = root.querySelector(input.dataset.filter);
        scope?.querySelectorAll("[data-search]").forEach((el) => {
          el.hidden = !!q && !el.dataset.search.toLowerCase().includes(q);
        });
      });
    });

    // Expertise type switcher.
    const typeSelect = root.querySelector("[data-expertise-type]");
    if (typeSelect && !typeSelect.dataset.ccbBound) {
      typeSelect.dataset.ccbBound = "1";
      const sync = () => root.querySelectorAll("[data-expertise-options]").forEach((s) => {
        s.hidden = s.dataset.expertiseOptions !== typeSelect.value;
      });
      typeSelect.addEventListener("change", sync);
      sync();
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  #commit({ render = true } = {}) {
    this._save();
    if (render) return this.render();
  }

  #persist() {
    return game.user.setFlag(MODULE_ID, DRAFT_FLAG, { ...this.draft, _step: this.stepIndex });
  }

  #goTo(index) {
    this.stepIndex = Math.clamp(index, 0, STEPS.length - 1);
    this.focus = null;
    this.#commit();
  }

  static #onGoStep(event, target) {
    this.#goTo(Number(target.dataset.index));
  }

  static #onNext() {
    const blocking = this.result?.issues[this.step.id]?.filter((i) => i.level === "error") ?? [];
    if (blocking.length) return ui.notifications.warn(game.i18n.localize("CCB.Notify.Blocked"));
    this.#goTo(this.stepIndex + 1);
  }

  static #onBack() {
    this.#goTo(this.stepIndex - 1);
  }

  static #onWorld(event, target) {
    const id = target.dataset.id;
    if (this.draft.world === id) return;
    this.draft.world = id;
    if (!SETTINGS[id]?.eras) this.draft.era = null;
    this.content.trees.clear();
    this.#commit();
  }

  static #onEra(event, target) {
    const era = Number(target.dataset.id);
    this.draft.era = this.draft.era === era && SETTINGS[this.draft.world]?.eras === "optional" ? null : era;
    this.content.trees.clear();
    this.#commit();
  }

  static #onAncestry(event, target) {
    const uuid = target.dataset.uuid;
    this.draft.ancestry = this.draft.ancestry === uuid ? null : uuid;
    // Losing the heroic bonus talent also loses the bonus heroic path.
    if (!talentBudget(this.content.find(this.draft.ancestry)).heroicBonus) this.draft.bonusPath = null;
    this.focus = uuid;
    this.#commit();
  }

  static #onCulture(event, target) {
    const uuid = target.dataset.uuid;
    const list = this.draft.cultures;
    const i = list.indexOf(uuid);
    if (i >= 0) list.splice(i, 1);
    else list.push(uuid); // over-budget is shown as an error, not silently prevented
    this.focus = uuid;
    this.#commit();
  }

  static #onPath(event, target) {
    const uuid = target.dataset.uuid;
    this.draft.path = this.draft.path === uuid ? null : uuid;
    // The bonus heroic path needs a starting path and must differ from it.
    if (!this.draft.path || this.draft.bonusPath === this.draft.path) this.draft.bonusPath = null;
    this.focus = uuid;
    this.#commit();
  }

  static #onBonusPath(event, target) {
    const uuid = target.dataset.uuid;
    this.draft.bonusPath = this.draft.bonusPath === uuid ? null : uuid;
    this.focus = uuid;
    this.#commit();
  }

  static #onAttr(event, target) {
    const { key, delta } = target.dataset;
    const b = this.result.budgets.attributes;
    const cur = this.draft.attributes[key] ?? 0;
    const next = cur + Number(delta);
    if (next < 0) return;
    if (Number(delta) > 0 && (next > b.max || b.spent >= b.total)) return;
    this.draft.attributes[key] = next;
    this.#commit();
  }

  static #onSkill(event, target) {
    const { key, delta } = target.dataset;
    const b = this.result.budgets.skills;
    const cur = this.draft.skills[key] ?? 0;
    const next = cur + Number(delta);
    if (next < 0) return;
    if (Number(delta) > 0 && b.spent >= b.total) return;
    this.draft.skills[key] = next;
    if (!next) delete this.draft.skills[key];
    this.#commit();
  }

  static #onAddExpertise() {
    const root = this.element;
    const type = root.querySelector("[data-expertise-type]")?.value;
    if (!type) return;
    const select = root.querySelector(`[data-expertise-options="${type}"]`);
    const custom = root.querySelector("[data-expertise-custom]")?.value?.trim();
    let id; let label;
    if (custom) {
      label = custom;
      id = slugify(custom);
    } else if (select?.value) {
      id = select.value;
      label = select.selectedOptions[0]?.textContent?.trim() ?? id;
    } else {
      return ui.notifications.info("Pick an expertise from the list or type a custom one.");
    }
    if (this.draft.expertises.some((e) => e.type === type && e.id === id)) {
      return ui.notifications.warn(`${label} is already on your list.`);
    }
    this.draft.expertises.push({ type, id, label });
    this.#commit();
  }

  static #onRemoveExpertise(event, target) {
    const [type, id] = target.dataset.key.split(":");
    this.draft.expertises = this.draft.expertises.filter((e) => !(e.type === type && e.id === id));
    this.#commit();
  }

  static #onTalent(event, target) {
    const uuid = target.dataset.uuid;
    const list = this.draft.talents;
    const i = list.indexOf(uuid);
    if (i >= 0) list.splice(i, 1);
    else list.push(uuid);
    this.focus = uuid;
    this.#commit();
  }

  static #onFocus(event, target) {
    event.stopPropagation();
    this.focus = target.dataset.uuid;
    this.render({ parts: ["main"] });
  }

  static #onAddConnection() {
    this.draft.connections.push({ name: "", description: "" });
    this.#commit();
  }

  static #onRemoveConnection(event, target) {
    this.draft.connections.splice(Number(target.dataset.index), 1);
    this.#commit();
  }

  static #onKit(event, target) {
    const uuid = target.dataset.uuid;
    this.draft.kit = this.draft.kit === uuid ? null : uuid;
    this.focus = null;
    this.#commit();
  }

  static #onGear(event, target) {
    const uuid = target.dataset.uuid;
    const i = this.draft.gear.indexOf(uuid);
    if (i >= 0) this.draft.gear.splice(i, 1);
    else this.draft.gear.push(uuid);
    this.#commit();
  }

  static #onPortrait() {
    const FilePicker = foundry.applications.apps.FilePicker.implementation;
    new FilePicker({
      type: "image",
      current: this.draft.img,
      callback: (path) => {
        this.draft.img = path;
        this.#commit();
      },
    }).browse();
  }

  static async #onReset() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Start Over" },
      content: "<p>Discard this draft and start a new character?</p>",
    });
    if (!ok) return;
    this.draft = blankDraft();
    this.stepIndex = 0;
    this.focus = null;
    await game.user.unsetFlag(MODULE_ID, DRAFT_FLAG);
    this.render();
  }

  static async #onCreate() {
    if (this.creating) return;
    await this.render(); // make sure validation is fresh
    if (this.result.hasErrors) return ui.notifications.error(game.i18n.localize("CCB.Notify.Blocked"));

    const warnings = this.result.all.filter((i) => i.level === "warn");
    if (warnings.length) {
      const list = warnings.map((w) => `<li><strong>${w.stepLabel}:</strong> ${w.text}</li>`).join("");
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Some things are missing" },
        content: `<p>Your character can still be created, but:</p><ul>${list}</ul><p>Create anyway?</p>`,
      });
      if (!ok) return;
    }

    this.creating = true;
    this.render({ parts: ["footer"] });
    try {
      const actor = await buildActor(this);
      await game.user.unsetFlag(MODULE_ID, DRAFT_FLAG);
      ui.notifications.info(game.i18n.format("CCB.Notify.Created", { name: actor.name }));
      this.close();
      actor.sheet?.render(true);
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(game.i18n.localize("CCB.Notify.Failed"));
      this.creating = false;
      this.render({ parts: ["footer"] });
    }
  }
}

/* -------------------------------------------- */
/*  Actor construction                           */
/* -------------------------------------------- */

async function buildActor(app) {
  const d = app.draft;
  const content = app.content;
  const filter = { world: d.world ?? "other", era: d.era };
  const pick = (type, uuid) => content.list(type, filter).find((e) => e.uuid === uuid) ?? null;

  const wrap = (text) => {
    const t = String(text ?? "").trim();
    if (!t) return "";
    return t.startsWith("<") ? t : t.split(/\n{2,}/).map((p) => `<p>${foundry.utils.escapeHTML(p).replace(/\n/g, "<br>")}</p>`).join("");
  };

  const system = {
    level: 1,
    attributes: Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, { value: d.attributes[k] ?? 0 }])),
    skills: Object.fromEntries(Object.entries(d.skills).filter(([, v]) => v > 0).map(([k, v]) => [k, { rank: v }])),
    expertises: Object.fromEntries(d.expertises.map((e) => [`${e.type}:${e.id}`, { id: e.id, type: e.type, label: e.label, locked: false }])),
    purpose: wrap(d.purpose),
    obstacle: wrap(d.obstacle),
    appearance: wrap(d.appearance),
  };

  const actor = await Actor.implementation.create({
    name: d.name?.trim() || "Unnamed Hero",
    type: "character",
    img: d.img,
    prototypeToken: { texture: { src: d.img }, actorLink: true },
    system,
    flags: { [MODULE_ID]: { world: d.world, era: d.era, createdWith: game.modules.get(MODULE_ID).version } },
  }, { [MODULE_ID]: { fromWizard: true } });
  if (!actor) throw new Error("Actor creation was cancelled.");

  const fromEntry = (entry) => game.items.fromCompendium(entry.doc, { keepId: false });
  const add = async (docs) => {
    const list = docs.filter(Boolean);
    if (!list.length) return [];
    return actor.createEmbeddedDocuments("Item", list);
  };

  // Origin first so its events (skills, expertises, granted talents) run in book order.
  const ancestry = pick("ancestry", d.ancestry);
  if (ancestry) await add([fromEntry(ancestry)]);
  for (const uuid of d.cultures) {
    const c = pick("culture", uuid);
    if (c) await add([fromEntry(c)]);
  }

  const path = pick("path", d.path);
  if (path) {
    const [created] = await add([fromEntry(path)]);
    await ensureStartingPath(actor, created);
    await ensureKeyTalent(actor, content, path);
  }
  // Heroic path gained with the Human bonus talent (Metalborn starts).
  const bonus = d.bonusPath ? pick("path", d.bonusPath) : null;
  if (bonus && bonus.pathType === "heroic") {
    await add([fromEntry(bonus)]);
    await ensureKeyTalent(actor, content, bonus);
  }

  // Talents the player chose.
  const talentDocs = [];
  for (const uuid of d.talents) {
    if (actor.items.some((i) => i._stats?.compendiumSource === uuid)) continue;
    const doc = await fromUuid(uuid);
    if (doc) talentDocs.push(game.items.fromCompendium(doc, { keepId: false }));
  }
  await add(talentDocs);

  // Goals and connections.
  await add(d.goals.filter((g) => g?.trim()).map((g) => ({ name: g.trim(), type: "goal", system: { level: 0 } })));
  await add(d.connections.filter((c) => c.name?.trim()).map((c) => ({
    name: c.name.trim(), type: "connection", system: { description: { value: wrap(c.description) } },
  })));

  // Equipment.
  const gearDocs = [];
  for (const uuid of [d.kit, ...d.gear].filter(Boolean)) {
    const doc = await fromUuid(uuid);
    if (doc) gearDocs.push(doc.pack ? game.items.fromCompendium(doc, { keepId: false }) : doc.toObject());
  }
  await add(gearDocs);

  return actor;
}

/**
 * Paths normally grant their key talent through their own item events. If a
 * path doesn't, add the key talent so the character still gains the path.
 */
async function ensureKeyTalent(actor, content, pathEntry) {
  await new Promise((r) => setTimeout(r, 300));
  const key = await content.keyTalent(pathEntry);
  if (!key) return;
  const has = actor.items.some((i) => i.type === "talent" && (i.system?.id === key.id || i._stats?.compendiumSource === key.uuid));
  if (has) return;
  const doc = await fromUuid(key.uuid);
  if (doc) await actor.createEmbeddedDocuments("Item", [game.items.fromCompendium(doc, { keepId: false })]);
}

/**
 * The handbooks normally flag the starting path and grant its skill rank via
 * the system's starting-path macro. If that hasn't happened shortly after the
 * path is added, run it ourselves (the macro is idempotent).
 */
async function ensureStartingPath(actor, pathItem) {
  if (!pathItem) return;
  await new Promise((r) => setTimeout(r, 750));
  const flagged = actor.items.some((i) => i.type === "path" && i.getFlag("cosmere-rpg", "isStartingPath"));
  if (flagged) return;
  // Only heroic paths have a starting skill; Metalborn starts skip the macro.
  if (!CONFIG.COSMERE?.startingSkills?.[pathItem.system?.id]) return;
  const macro = globalThis.cosmereRPG?.utils?.macros?.startingPath?.set;
  if (typeof macro === "function") await macro(actor.items.get(pathItem.id), { notify: false });
}

/* -------------------------------------------- */
/*  Small helpers                                */
/* -------------------------------------------- */

function card(entry, selected, subtitle = null) {
  return {
    uuid: entry.uuid, name: entry.name, img: entry.img, summary: entry.summary,
    source: entry.source, sourceLabel: entry.sourceLabel, selected,
    subtitle, eras: entry.eras?.map((e) => `Era ${e}`).join(" · ") ?? null,
  };
}

function typeLabel(entry) {
  const cfg = CONFIG.COSMERE?.paths?.types?.[entry.pathType];
  return cfg ? game.i18n.localize(cfg.label) : (entry.pathType ?? "Path").replace(/^./, (c) => c.toUpperCase());
}
