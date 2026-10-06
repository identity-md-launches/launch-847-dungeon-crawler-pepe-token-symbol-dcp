# Dungeon Crawler Pepe interface

## Overview

The browser is a Crawler terminal for an original adult comedy dungeon game. Moss, parchment and oxidized gold frame an illustrated frog and a hostile bureaucratic world. Clear controls and sober save/payment states sit alongside the game's filthy dialogue. The existing vanilla JavaScript frontend and authoritative Node engine are retained; no framework migration or runtime dependencies were introduced.

Sources: `web/index.html`, `web/style.css`, `web/app.js`, `web/practice.js`, `web/dungeon.svg`. The static build copies these to `dist/` and copies the accepted game rules to `dist/runtime/`. Practice is explicitly opt-in, device-only, editable and isolated from server accounts or token authority.

## Colors

All UI tokens are defined in `web/style.css:1` in the existing hex notation. Dark mode is the only theme.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#10120f` | Page and inset input backgrounds |
| `--panel` | `#181c16` | Dossiers, encounters, dialogs, tables |
| `--panel2` | `#22271e` | Buttons, enemy and perk cards |
| `--line` | `#343d2d` | Decorative separators, panel structure |
| `--control` | `#77836c` | Interactive boundaries |
| `--text` | `#eeeede` | Primary text |
| `--muted` | `#a7b09b` | Secondary copy and labels |
| `--frog` | `#b4d66e` | Primary action, selected navigation, current map position |
| `--ink` | `#18200d` | Text on the primary action |
| `--blood` | `#fa8a7d` | HP, error/destructive state; always accompanied by text |
| `--gold` / `--focus` | `#e8c67a` | Numbers, available routes, focus perimeter |
| `--hype` | `#c695d2` | Hype meter and Epic rarity |
| `--block` | `#91bfd5` | Rare rarity |

The welcome panel uses `#20261b` with `#414c33` framing. These are illustration-adjacent surface values, not a second theme. Labels and outlined buttons distinguish selection from surrounding content. Measured rendered pairs and automated audit limitations are recorded in `artifacts/browser-checks.json` and `docs/interface-review.md`; those measurements do not certify every image, emoji or opacity state.

## Typography

Body: `system-ui, -apple-system, "Segoe UI", sans-serif`, 16px/1.55, normal and bold platform faces. No external fonts or font requests. Display headings use Georgia/serif: the page h1 is 700 weight, `clamp(2rem,4vw,3.2rem)`, line-height 1.12, tracking -0.03em; its green italic second phrase has normal weight. The welcome h2 is a deliberate display exception, `clamp(2rem,3.6vw,3.25rem)` / 1.08.

Standard h2: 1.6rem; h3: 1.125rem; encounter h2: 1.3rem. `--small` is .8125rem. Dossier/perk descriptions use .75–.8125rem to support dense gameplay. Eyebrows use .6875rem monospace, uppercase and .13em tracking. Fine print is .6875rem; it never carries the sole explanation of a money or save consequence. The font stack is intentionally platform-dependent, so no specific installed face is promised.

Fields stay at 1rem (16px), including mobile. Stats, tables and small numeric readouts use tabular numerals. Headings balance; paragraphs use `text-wrap:pretty`; long addresses inherit `overflow-wrap:anywhere` from `.card`. Field-guide prose is capped at 78ch.

## Layout

The main container is centered at 1440px with 24px horizontal / 32px vertical padding. Spacing is mostly 4, 8, 12, 16, 24 and 32px; controls in `.actions` use .65rem gaps. Header and footer align with the main content. The header is in document flow and never covers an encounter.

The welcome panel has `1fr 1.1fr` columns and a local vector scene. Class choices use four equal columns. Gameplay uses `260px minmax(0,1fr) 270px`: dossier, encounter/map, broadcast feed. Each grid child can shrink with `min-width:0`.

At 1200px, classes become two columns and gameplay becomes `240px minmax(0,1fr)` with the feed spanning underneath. At 700px, the welcome stacks, gameplay puts encounter/map before dossier and feed visually, controls wrap, and the nav moves to its own row. The document order retains dossier before encounter for reading context; action completion moves focus to the encounter/map. At 370px, class cards become a single column with a compact icon rail. All content can grow vertically. Tables use fixed layout with wrapping cells; only the route diagram intentionally scrolls horizontally and exposes a visible scroll hint and focusable region.

Rendered checks cover 1440, 900, 390 and 320 CSS pixels, plus a 720px reduced viewport representing the reflow expected from a 1440px window at 200% zoom. Native zoom, screen-reader order and physical touch-device behavior remain unverified.

## Elevation & Depth

Flat panels rely on tonal separation and structural 1px borders. The active nav has an inset 2px lower indicator. Only native dialogs use elevation: `0 24px 80px #0008`, a dark `#080c08d9` backdrop and 5px blur. No autoplay, parallax, animated dungeon scene or page entrance effects.

## Shapes

Cards/welcome: 10px radii. Buttons, inputs, enemy and offer cards: 6px. Tags and small labels: 4px. Route nodes: 44px circles. Dialogs: 14px. The 54px dossier portrait has a 9px radius. The room joins its illustration with only lower rounded corners.

## Components

- **Navigation** — `web/index.html` / `web/app.js`: native buttons set `aria-current=page` and a hash; reload restores a known hash. Hidden sections use the global `[hidden] { display:none !important }` invariant. Brand returns to Dungeon.
- **Class choice** — `renderNoChar`: eight native buttons in a labelled fieldset, `aria-pressed`, checkmark and border selection; keyboard focus survives rerender. The character form uses native validation, inline errors and a pending Entering state.
- **Actions** — `.primary` is the focused admission/combat action; equal perk choices remain neutral. Minimum button height is 44px. Busy game controls disable during save. Invalid moves retain their error until dismissed. CSS hover is pointer-gated; transitions are only enabled with no motion preference (120ms), and the active scale is .96.
- **Encounter and map** — `renderRoom` / `renderMap`: engine-defined choices, cooldown-aware skill controls, descriptive route names, locked route enforcement using the shared `unlocked` predicate, and focus moved to the next task after successful actions. The map and broadcast feed are keyboard-scrollable regions.
- **Dossier and feed** — numeric HP/Hype/XP labels accompany bars; rarity is written as well as colored. Inventory actions preserve server ownership validation. Feed is a bounded scroll region rather than an unbounded page takeover on desktop.
- **Dialogs** — native `<dialog>` supplies inert background and focus behavior. Recovery supports Escape, Cancel, error focus and trigger restoration. Adult consent requires affirmative confirmation; Escape does not dismiss consent. Closing the tab is the displayed exit.
- **Status and failure** — stable live regions announce moves and notices; inline errors use `role=alert`. Browser practice never renders fake treasury balances. Unavailable backend offers Retry or a separate practice ledger, and never automatically downgrades a connected server session.

## Do's and Don'ts

Reuse `.tabpane`, `.card`, `.section-heading`, `.actions` and the semantic palette for another page; add a native navigation button and a render function before adding a new component system. Escape generated text with `esc`. Keep test balances and practice storage explicitly labelled. Never convert practice progress into ranked scores, credentials, purchases or claims. Keep operational errors calm even when the dungeon dialogue is obscene.

Do not add external fonts, autoplay, a second accent palette or copied character art. Do not remove hidden-state enforcement, reduce touch controls, replace native buttons with click handlers on generic elements, or expose game seeds, recovery codes or server data in screenshots/status. Keep the build's public allowlist explicit.
