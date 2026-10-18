# Character Creation Beautifier

A guided, good-looking character creation wizard for Foundry VTT v13.
Not system-agnostic by design: each system gets its own adapter. The first one is the **Cosmere RPG** (`cosmere-rpg` 3.x).

## Requirements

- Foundry VTT 13.346+
- Cosmere Roleplaying Game system 3.0+
- `cosmere-rpg-stormlight-handbook` (Stormlight Handbook)
- `cosmere-rpg-mistborn-handbook` (Mistborn Handbook)

Players need **Observer** access to the handbook compendiums, or the wizard will not see their content (the Setting step tells you when this happens).

## How to open

- **Create Character** button at the top of the Actors sidebar.
- Optional setting: replace the default "Create Actor" dialog for Character actors.
- Macro: `game.modules.get("character-creation-beautifier").api.open()`

Drafts are saved per user, so closing the window does not lose progress. "Start over" clears it.

## Steps

1. **Setting**: Roshar, Scadrial (Era 1 / Era 2), Mixed, or Other World.
2. **Ancestry & Culture**: one ancestry, two cultures.
3. **Starting Path**: heroic path; on Scadrial, a Metalborn path is allowed instead. Radiant paths are never offered at creation.
4. **Attributes**: 12 points, 0–3 each.
5. **Skills**: 4 ranks, max rank 2 (granted ranks from your path are shown and counted toward the max).
6. **Expertises**: cultural expertises come from your cultures, plus extra equal to Intellect.
7. **Talents**: from your path and ancestry talent trees, with live prerequisite checks. Human bonus talents must come from a heroic path, and can open a second heroic path via its key talent (with any starting path, heroic or Metalborn).
8. **Purpose, Obstacle, Goals, Connections**
9. **Equipment**: starting kit (any item named "... Kit") plus extra gear.
10. **Name & Portrait**
11. **Review**: summary plus the full checklist.

Point budgets come from the system's own level-1 advancement rule (`CONFIG.COSMERE.advancement.rules[0]`), so they follow the system if it changes.

## Validation

| Situation | Behavior |
|---|---|
| Something missing (unspent points, no obstacle, one goal short…) | Amber warning. You can continue and create; a confirmation lists what's missing. |
| Something extra or illegal (3 cultures, 13 attribute points, rank 3 skill, talent with unmet prerequisites, content not available in the chosen world/era) | Red error. **Next** and **Create** are disabled until fixed. |

## How content is found

Nothing from the books is hard-coded. The wizard reads ancestries, cultures, paths, talent trees and gear from the compendiums at runtime and tags them by package:

- `cosmere-rpg` → Core
- `cosmere-rpg-stormlight-handbook` → Stormlight
- `cosmere-rpg-mistborn-handbook` → Mistborn
- anything else / world items → Homebrew (only shown in "Other World", or everywhere if the setting is on)

When a handbook and the core system both ship the same item (same type + system id), the handbook version wins.

Items are added to the actor in book order (ancestry → cultures → starting path → extra path → talents → goals → connections → gear), so the system's own item events run normally: key talents, cultural expertises, the starting-path skill rank and any "pick one" prompts all come from the handbooks themselves.

## Human bonus talent and Metalborn starts

- An ancestry bonus talent is treated as **heroic-only** when its restriction text mentions "heroic", or when the ancestry is Human.
- The compendium Human ancestries list no bonus talents in their advancement data (the rule only lives in the description), so Human always gets one heroic bonus talent at level 1 unless its data says otherwise.
- Heroic-only bonus talents can't be spent on Metalborn or ancestry trees; the wizard blocks it with an error.
- The Talents step offers a **Bonus Heroic Path** section for any starting path: picking one spends the bonus talent on another heroic path's key talent. The path item is added to the actor and its tree opens up below.
- Key talents come from the path's grant-items event; if a path has none, the root node of its talent tree is used and added explicitly.
- Clearing the starting path, choosing the bonus path as the starting path, or switching to an ancestry without a heroic bonus clears the bonus heroic path.

## Eras

The world setting **Era Rules** maps names to eras (`Mistborn: 1`, `Ferring: 2`, …). Names match paths, specialty trees, ancestries, cultures and talents. Defaults:

- Era 1 only: Mistborn, Feruchemist
- Era 2 only: Ferring, Twinborn, Gunslinger

You can also tag any world item directly with `flags["character-creation-beautifier"].eras = [1]`, which overrides the rules.

## Settings (world)

| Setting | Default |
|---|---|
| Replace "Create Actor" for characters | off |
| Include homebrew content | off |
| Maximum attribute at creation | 3 |
| Cultures at creation | 2 |
| Additional expertises | `int` (or a number) |
| Goals at creation | 2 |
| Minimum connections | 1 |
| Era Rules | see above |

## Adding another system

Create `scripts/systems/<system>/index.js` exporting `registerSettings`, `openWizard`, and optionally `onReady` and `shouldInterceptCreate`, then register it in `ADAPTERS` in `scripts/main.js`.

## File map

```
module.json
scripts/main.js                     entry, directory button, API
scripts/constants.js                shared helpers
scripts/systems/cosmere/index.js    adapter
scripts/systems/cosmere/settings.js world settings + era rules editor
scripts/systems/cosmere/content.js  compendium discovery, era tags, item events
scripts/systems/cosmere/rules.js    steps, budgets, validation
scripts/systems/cosmere/wizard.js   ApplicationV2 + actor building
templates/cosmere/                  sidebar, main, footer, steps/, partials/
styles/ccb.css                      themes: neutral, roshar, scadrial, mixed, other
lang/en.json
```
