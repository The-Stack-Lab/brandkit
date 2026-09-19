# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`@stacklist-app/brandkit`, an npm package that bolts a config-driven brand guide onto any website (React, Vite, Astro, Next.js, plain HTML). Zero runtime dependencies.

The brand guide renders entirely from `config.json`, swap the config and logos to create a guide for any brand. An AI agent can auto-generate the config by scraping the host codebase.

## Development

```bash
# Run the default demo brand (the self-titled "Brandkit" guide)
node bin/brandkit.js dev example
# Open http://localhost:4800

# Or use the npm script
npm run dev
```

The `fetch()` in engine.js requires a server (won't work from `file://`).

## Architecture

```
bin/brandkit.js       ← CLI entry point (init, generate, dev, build)
cli/
  init.js             ← Scaffold config + copy engine files
  generate.js         ← Auto-extract config from host codebase
  dev.js              ← Dev server with SSE live reload
  build.js            ← Bake config into static production files
  export.js           ← Emit agent-native brand data (brand.json/tokens.json/brand.md)
  changelog.js        ← Record a revision: prepend a changelog entry + bump brand.version
lib/
  template.js         ← Generate :root CSS + fonts link from config; writes + embeds exports
  export.js           ← Project config → brand.json (semantic) / tokens.json (DTCG) / brand.md (LLM brief)
  agents-doc.js       ← AGENTS.md maintenance contract scaffolded by `init` (brand-agnostic)
  extract-tailwind.js ← Read tailwind.config for colors/fonts/spacing
  extract-css.js      ← Parse CSS files for custom properties (skips brandkit guide dirs)
  extract-logos.js    ← Find logo/brand assets via glob
  ingest/             ← `generate --from` : build a brand from a URL, archive, or files
    index.js          ← Orchestrator + mapping onto brandkit theme tokens
    png.js            ← Pure-Node PNG decode, dominant colors, color-presence test
    source-dir.js     ← Scan a directory/import archive (screenshots, CSS, assets, claims)
    source-url.js     ← Fetch a live URL (builtin fetch): stylesheets, custom props, fonts
    render.js         ← Optional Playwright escalation, detected, never depended on
    reconcile.js      ← Precedence, evidence, conflicts, rejections
  config-schema.js    ← Starter config template + merge logic
  formats.js          ← Output-format presets + safe zone / clear space normalizers (preset table mirrored in dist/engine.js)
  resolve.js          ← Path to dist/ (swagger-ui-dist pattern)
config.schema.json    ← JSON Schema for config.json (shipped in npm files)
dist/
  index.html          ← Universal HTML template (no hardcoded content)
  engine.js           ← Rendering engine (bootstrap + 11 renderers + interactivity)
  styles.css          ← Stylesheet driven by CSS variables; ships a baseline :root of default tokens
  logos/              ← Default generic brandkit logos (SVG), copied by `init`
integrations/
  vite.js             ← Vite plugin (serves /brand in dev, copies on build)
  astro.js            ← Astro integration (wraps Vite plugin)
example/
  config.json         ← Default demo brand data (snapshot of starterConfig)
  logos/              ← Default brandkit demo logos
```

**Key principle**: `dist/` files are universal, they never contain brand-specific content. `config.json` is the only file that changes per client.

### Rendering Pipeline (dist/engine.js)

`engine.js` is a single async IIFE. On load:

1. **Bootstrap**: injects Google Fonts `<link>`, generates `:root` CSS variables from `config.theme`, sets page title
2. **renderShell()**: header, intro, footer, font specimens (reads `fonts.*.description` from config)
3. **renderNav()**: sidebar from `config.nav`
4. **renderSectionIntros()**: populates section intro text from `config.sections`
5. **renderColors()**: brand/neutrals/semantic grids (supports `{ label, items }` structure)
6. **renderGradients()**: gradient stops
7. **renderLogos()**: logo cards with format/size selection + canvas resize
8. **renderTypography()**: type scale
9. **renderHierarchy()**: text hierarchy demo from `config.hierarchy`
10. **renderVoice()**: do/don't cards
11. **renderComponents()**: buttons, cards, stats
12. **renderSpacing()**, **renderAccessibility()**, **renderCSSVars()**

Then interactivity: `initCopy()`, `initFormatBar()`, `initNav()`, `initTypeTester()`.

### How Theme Injection Works

`styles.css` ships a baseline `:root` block defining **every** token it consumes (default values), so a minimal/ported config never renders broken. Config-supplied tokens cascade over those defaults.

The accent uses a fill/text split: `--accent` (fill), `--accent-foreground` (text on the fill), `--accent-text` (accent as text on a light surface). The baseline aliases `--accent: var(--purple, …)` so pre-1.1.2 configs that set `--purple`/`--purple-rgb` still work.

- **Dev mode**: engine.js bootstrap reads `config.theme` and injects a `<style data-brandkit-theme>` `:root` block at runtime, appended to `<head>`, so it cascades over the baseline.
- **Production build**: `cli/build.js` uses `lib/template.js` to **append** the generated `:root` block after styles.css (so brand overrides win), plus injects the Google Fonts `<link>` and title into index.html.

### Chrome vs content (1.8.0)

The brand paints the **content** (prose, headings, swatches, specimens, wordmark blocks, demo surfaces). The **chrome**, brandkit's own UI around it, reads **nothing** from the config: the sidebar and its nav, the copy-format bar, toasts, and the in-card controls (format toggles, size pickers, download buttons, the type tester select). It has its own fixed tokens in the baseline `:root`, fonts and palette both (`--bk-ui-font`, `--bk-mono-font`, `--bk-ui-bg`, `--bk-ui-bg-subtle`, `--bk-ui-bg-hover`, `--bk-ui-border`, `--bk-ui-text`, `--bk-ui-text-muted`, `--bk-ui-text-subtle`, `--bk-ui-selected`, `--bk-ui-selected-fg`, `--bk-ui-code-bg`, `--bk-ui-code-text`), declared in the baseline `:root` and explained in the `CHROME vs CONTENT` block below it in `styles.css`. `.sidebar` sets the font for its whole subtree so later additions inherit neutral; form controls are named explicitly because they do not inherit font. Selection state on the format chips uses `--bk-ui-selected` (ink, not the brand accent), inverted to `--bk-ui-selected-fg` on the base `.logo-format-toggle button.active` rule because a logo card's default dark surface is that same ink. The active nav item is `--bk-ui-text` on `--bk-ui-bg-hover` with a 2px left border.

A third layer, **data**, reads `--bk-mono-font`: `.color-value`, `.hierarchy-hex`, `.type-row-spec`, `.spacing-label`, `.spacing-value`, `.a11y-ratio`, `.code-block`, `.changelog-empty code`. These are values a reader copies (hex, oklch, px, ratios, CSS), not prose. The token also replaced two different hardcoded monospace stacks. `renderHierarchy()` wraps its hex in `.hierarchy-hex` (and now escapes both fields, which it did not before).

The sidebar wordmark **text** is chrome (`.sidebar-brand`); `brand.sidebarLogo` still renders the client's actual mark as an image, because that is an asset being displayed, not the UI adopting a style. `.section-label` is the document's own heading and stays branded. Swatch names and roles stay branded too: `Cloud` is copy, `#F5F7FE` is data.

`test/chrome.test.js` enforces the rule as one invariant (`no chrome rule reads a brand token`) over every rule matching the chrome selector patterns, in both directions, plus WCAG ratios for the chrome palette itself. Note the limit: the classifier is a list of selector *patterns*, so a chrome component introduced under a brand-new class name is not scanned until its selector is added to `CHROME`. Add it in the same commit that adds the component.

Why: a brand typeface is not a UI typeface. A Caslon client guide rendered its entire left-hand menu in EB Garamond, which reads as a broken guide rather than as a serif brand.

`--bk-*` is a **reserved namespace**. `isChromeToken()` (`lib/template.js`, mirrored in `dist/engine.js` and `dist/changelog.js`) drops any `--bk-` key found in `config.theme` from the generated `:root`, so neither a hand-written theme nor one an agent derived from a host codebase can repaint the tool with the brand it documents; `build` prints what it dropped. `test/chrome.test.js` pins both halves of the split, and `lib/agents-doc.js` states the rule in the scaffolded AGENTS.md.

### Config Schema

`config.json` top-level keys:

- `brand`: name, displayName, tagline, description, url, byline, version, date; optional `guideLabel` (renames the "Web Style Guide" header/footer label), `headerLogo` (image replacing the header text wordmark), `sidebarLogo` (image replacing the brand name at the top of the left menu). Logo fields fall back to `brand.name` text when empty/unset; the sidebar previously hardcoded "brandkit", it now uses `brand.name`. Optional `agentCallout` (default `true`) toggles the sidebar "Using an AI agent?" copy-paste prompt; set `false` to hide it. `brand.version` is the guide's own revision: a fresh `init` starts at `0.1` and climbs as the guide is built out; `1.0` means locked/finalized (see `changelog`).
- `fonts`: display + body with `family`, `googleImport`, `description`
- `theme`: explicit CSS variable mapping (colors, gradients, font vars, `-rgb` variants)
- `nav`: sidebar groups and section links
- `colors`: `{ brand: { label, items }, neutrals: { label, items }, semantic: { label, items } }`
- `gradients`: CSS definitions with stops
- `gradientUsage`: do/don't lists
- `sections`: section intro strings (gradients, logos, components, spacing, variables, gradientTextDemo)
- `hierarchy`: text hierarchy demo data (class, colorVar, colorName, hex, description)
- `logos`, `logoSizes`: logo variants + available download sizes. Each logo may carry optional usage overrides (`clearSpace`, `minSize`, `placement`, `dont`).
- `logoUsage`: optional brand-wide logo rules (same four fields). Renders the Logo Usage section.
- `formats`: optional output canvases, each `{ preset | name, kind, width, height, unit, safeZone, logo, typography, background, notes }`. Presets: `social-square`, `social-portrait`, `social-story`, `link-card`, `slide-16x9`. Renders the Formats section.
- `typography`: full type scale with specimens
- `voice`: description + do/don't examples
- `accessibility`: contrast ratio grid
- `cssVariables`: variable reference display
- `spacing`: spacing scale tokens
- `components`: buttons, cards, stats
- `changelog`: revision history, newest first: `[{ version, date, changes: [...] }]`. Rendered on the standalone `changelog.html` page and surfaced in the agent exports. Maintain it with `brandkit changelog`; the latest entry's version mirrors `brand.version`.

## CLI Commands

```bash
brandkit init [dir]        # Scaffold brand guide with starter config
brandkit generate [dir]    # Auto-extract config from codebase (Tailwind, CSS, logos)
brandkit dev [dir]         # Dev server at :4800 with live reload
brandkit build [dir]       # Build production static files (+ agent exports, embedded in the page)
brandkit export [dir]      # Emit only the agent exports (--format json|dtcg|md|all, --out <dir>)
brandkit changelog "<msg>" # Record a revision: prepend a changelog entry + bump brand.version
```

`generate` merge strategy (1.6.0):

| Fields | Behavior |
|---|---|
| `theme`, `spacing`, `logoSizes` | overwritten from source every run |
| `colors`, `fonts` | **merged per item.** Values (`hex`, `oklch`, `family`) re-derive; `name`, `role`, `description`, `googleImport`, `fallback` are preserved once authored. Swatches match on `sourceVar` (the token they came from) because `cssVar` is derived from the name, so keying on it would orphan the prose a rename was meant to keep |
| `gradients`, `hierarchy`, `cssVariables`, `accessibility`, `typography` | derived from `theme` **while they still hold brandkit's scaffold**; yours once edited |
| `brand`, `voice`, `components`, `sections`, `logos` | cleared **once** if they still hold brandkit's own placeholder content, so a guide never ships brandkit's tagline, voice or marks as the client's; untouched after that |
| `changelog`, `nav` | never touched |

**Scaffold provenance.** `isEmptyOrScaffold()` only ever looked for `__TODO`, but
the starter ships populated, marker-free content, so it was always false and
twelve fields survived byte-identical into client guides (an indigo gradient
labelled "Brand", brandkit's voice, cards reading "One config"). `isStillScaffold()`
compares against a fresh `starterConfig()`, per item for lists, gated on
`hostBrandIdentity(projectDir) !== null` so brandkit's own repo, where the demo
*is* the brand: is exempt. A run that removes content leaves `config.json.bak`.

**`__TODO` is a marker, not content.** `isUnset()` (`lib/export.js`, mirrored in
`dist/engine.js`) omits it from `brand.json`/`tokens.json`/`brand.md` and renders
it as a muted `[data-brandkit-unset]` placeholder. Before 1.6.0 nothing knew what
the marker meant and it rendered verbatim, so a client-approval document carried
maintainer instructions as body copy. `brandkit build` refuses while an essential
section (`brand`, `voice`, `logos`, `colors`, `fonts`) is unfilled; `--force`
builds a draft.

**Fonts are never invented.** `googleImport` is not auto-emitted, `family +
':wght@300;…'` produced live URLs for commercial faces (Nexa) and dead ones for
400-only Google families (Anton). `fonts.*.fallback` is populated instead so the
specimen renders honestly, and one `<link>` per family stops a single bad import
taking both fonts down.

### Building a brand from outside the codebase (`generate --from`)

```bash
brandkit generate brand --from ./context/source-site      # an import archive
brandkit generate brand --from https://client.com         # a live site
brandkit generate brand --from <dir> --from <url> --brand-name "GrayMeta"
brandkit generate brand --from https://client.com --render   # measured computed styles
```

`--from` is repeatable and takes a **URL, a directory, or a file**. One pipeline,
several front doors: each source becomes the same evidence shape, then `reconcile`
decides what survives. Bare `generate` is unchanged.

**Precedence** (high → low): `computed` (real browser, `--render`) → `css-var`
(the site's own declared properties) → `pixel` (sampled from screenshots) →
`declared` (a font-family rule with no render to confirm it) → `claimed` (a
third-party tokens JSON: never sufficient alone; must survive a presence test).

**The governing rule: a token with no evidence is not written.** Unmeasurable
fields are reported as gaps for a human, never filled with a plausible guess. A
brand board that is honestly incomplete is recoverable; a confidently wrong one
is not. Every run writes `ingest-evidence.json` beside `config.json`, per-field
source, confidence, conflicts resolved, and values rejected with the reason.
Evidence stays *out* of `config.json`, which is the rendered source of truth.

Why this exists: an LLM-extracted `branding.json` for GrayMeta reported a light
color scheme for a site that is `#1C1C1E` on 26 of 27 pages, labelled the surface
color as `textPrimary`, emitted Tailwind `sky-600`/`sky-500` as brand colors
(present in 0.0026% / 0.0000% of sampled pixels), and returned a 1×1 lazy-load
GIF as the logo: at a self-reported 92.5% confidence. Pixels and computed styles
do not have opinions; extraction does.

`--render` uses Playwright **if the host project already has it** (`require.resolve`),
and degrades with a printed reason otherwise. brandkit takes no dependency on it.
It is the only way to distinguish a font that *loaded* from one that *rendered*:
GrayMeta self-hosts Epilogue while painting Roboto Condensed everywhere.

### Changelog (cli/changelog.js + dist/changelog.html + dist/changelog.js)

A standalone version-history page, separate from the single-page guide. `dist/changelog.html` +
`dist/changelog.js` mirror `index.html`/`engine.js`: the page fetches `config.json`, runs the same
fonts/theme bootstrap, and renders `config.changelog` (newest first) as `version · date · bullets`.
The guide's footer version links to it (resolved against `BASE`); the page links back to the guide.
`build` emits it like `index.html` (title + fonts + basePath rewrites for its own `styles.css` /
`changelog.js` refs); `init` copies it. Shipped as `changelog.html`, reachable at
`/<base>/changelog.html`; a bare `/<base>/changelog` route depends on a host rewrite.

`brandkit changelog [--dir <path>] "<msg>" ["<msg>" ...]` prepends a `{version, date, changes}` entry
and bumps `brand.version`. Bump rules: default minor (`0.1→0.2`, `1.0→1.1`); `--lock` → `1.0`;
`--major` → next whole; `--version X.Y` explicit. `--date "<text>"` overrides (default: current
month). Run `build`/`export` afterward to refresh the deployed page and exports.

### Agent-native exports (lib/export.js)

`build` and `export` project `config.json` into machine-first views, written next to the HTML:
- `brand.json`: normalized, semantic brand (accent fill/text split with contrast, color roles, voice, logos with usage, spacing). The agent-first view, not the render config. Also carries `logoUsage`, per-logo `usage`, and resolved `formats` (names already mapped to file paths, hexes and type metrics). Type-scale rows are copied whole (`projectTypeRow`), never by naming fields: 1.8.0 and earlier enumerated them and silently dropped `uppercase` and `sample` (LAB-1226).
- `tokens.json`: W3C Design Tokens (DTCG) `{ $type, $value }` for color / fontFamily / dimension. Only hex theme values become color tokens (gradients/`-rgb` are excluded to stay tool-compatible). The config palette (`colors.brand/neutrals/semantic`) is nested at `color.palette.<slug>` with the role as `$description` and a wider-gamut value under `$extensions["app.stacklist.brandkit"]` as `authored` + `colorSpace` (the same convention the theme tokens use, never a second one), so it cannot collide with the flat `color.<theme-var>` tokens.
- `brand.md`: an LLM brief; surfaces low-contrast pairs as explicit cautions, ends with a `## Changelog` section. Color leads with the palette from `colors.brand` (theme-derived usage lines follow), neutrals come from `colors.neutrals`, and it carries the type scale, spacing, `## Logo usage` and `## Formats` as followable instructions. brand.md and brand.json share one projection (`projectFormats`, `projectLogoUsage`) so they cannot disagree.

`config.changelog` rides along automatically: it's added to `brand.json`, and `brand.md`'s `## Changelog` section is emitted **unconditionally**, it leads with the maintenance instruction ("when you change the brand, run `brandkit changelog`…") so an agent reading the brief learns the rule even before any entries exist, then lists the history. `tokens.json` is unaffected (not token data).

**Agent affordances for the changelog.** Two things tell an implementing agent how/when to use it: (1) the `## Changelog` instruction in `brand.md` (the file the agent callout points agents at), and (2) `AGENTS.md`, a brand-agnostic maintenance contract `brandkit init` scaffolds into the guide dir (`lib/agents-doc.js`), written on `init`, and rewritten by `init --update` so an existing guide picks up contract changes from a new release (1.8.0; it used to be skipped when present, which left old guides on an outdated contract forever). It states the source of truth, the read-from-exports rule, and the "record changes with `brandkit changelog`" workflow + versioning scheme.

`build` also injects `<link rel="alternate" type="application/json" href="brand.json">` and embeds `<script type="application/json" id="brandkit-brand">` (with `</script>` escaped) so an agent fetching the deployed page gets structured data without scraping. The transforms are pure (`lib/export.js`); file writing is `writeExports()`.

For a human pointing their own agent at the guide, `renderAgentCallout()` (engine.js) renders a "Using an AI agent?" box under the sidebar nav with a copy-paste prompt. The prompt resolves the export URLs against `location.href` (via `new URL`) so it carries absolute links to `brand.json` / `tokens.json` / `brand.md`, and names the brand from `cfg.brand`. Hide it with `brand.agentCallout: false`.

### No em or en dashes, and what that means for the starter

Nothing brandkit writes (exports, CLI output, microsite copy, starter config, comments) contains an em or en dash; `test/exports.test.js` scans the package and fails on one. Two files match a dash by escape on purpose (`lib/export.js` `fontLine`, `lib/config-schema.js` `copyNorm`) to recognize one in a client's content. Client content is never rewritten.

Scaffold detection (`isStillScaffold`, `mergeColors`, `isAuthored`, `seedBrandIdentity`) compares through `copyKey()`, which ignores punctuation and case, because guides scaffolded by 1.6.0 and earlier hold the old dashed copy. **If you reword starter copy, change punctuation only, or those guides stop being recognized as scaffold.** `test/fixtures/starter-1.6.0.json` locks this.

## Coding Standards

- **Vanilla JS only**: no frameworks, no build tools in dist/
- **ES5-compatible in dist/**: uses `var`, `.forEach()`, string concatenation
- **Node.js builtins only in cli/lib/**: zero npm dependencies
- **Config-driven**: no hardcoded brand content in dist/ files
- `styles.css` uses `var(--font-display)`, `var(--accent)`, `var(--accent-text)`, `var(--accent-rgb)` etc., never literal font names or brand-specific colors (the baseline `:root` holds the only default values)

## Adding a New Section

1. Add the data to `config.json` schema (and `lib/config-schema.js` starter template)
2. Add a `render*()` function in `dist/engine.js`
3. Add an empty container element in `dist/index.html`
4. Add styles in `dist/styles.css` using only CSS variables
5. Call the render function in the "Execute all" block

## Default Demo Brand

`example/config.json` and `example/logos/` are the company-agnostic **Brandkit** demo, the same guide `brandkit init` scaffolds (`lib/config-schema.js` `starterConfig()`). It doubles as living documentation. Primary accent: indigo `#4F46E5` (text `#4338CA`). Fonts: Space Grotesk (display) + Inter (body). Logos are generated SVGs in `dist/logos/`.

`example/config.json` is a snapshot of `starterConfig()` with three overrides: `brand.version` tracks the package version (the demo *is* brandkit, so its guide version matches the release; the scaffold default starts at `0.1` for real clients), `brand.date` is pinned, and `changelog` is the curated release history (the starter ships only a single `0.1` entry). That history lives **only** in `example/config.json`, so never regenerate the file from a hardcoded snippet: an inline recipe that used to live here went stale and wiped four releases of history during 1.7.0. Regenerate with the script, which reads the changelog and date back and preserves them:

```bash
node scripts/sync-example.js   # starter -> example/config.json, dist/ -> example/, exports, AGENTS.md
```

It refuses to run if the newest changelog entry does not match `package.json`, so a release is: bump `package.json`, prepend a `{ version, date, changes }` entry to `example/config.json` (and set `brand.date`), run the script.

`example/{brand.json,tokens.json,brand.md}` are committed as a reference of what the exports look like, regenerate them with `export` (not `build`, which would overwrite the raw dev `index.html`/`styles.css`).

No client brand data lives in this repo, with one exception: `test/fixtures/freeway.config.json`, a copy of Freeway PHX's published `/brand/config.json` (em dashes removed) that the export tests use as their acceptance fixture. `test/fixtures/starter-1.6.0.json` pins the pre-1.7 starter copy so scaffold detection stays backward compatible.
