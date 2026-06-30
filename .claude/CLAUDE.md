# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`@stacklab/brandkit` — an npm package that bolts a config-driven brand guide onto any website (React, Vite, Astro, Next.js, plain HTML). Zero runtime dependencies.

The brand guide renders entirely from `config.json` — swap the config and logos to create a guide for any brand. An AI agent can auto-generate the config by scraping the host codebase.

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
lib/
  template.js         ← Generate :root CSS + fonts link from config; writes + embeds exports
  export.js           ← Project config → brand.json (semantic) / tokens.json (DTCG) / brand.md (LLM brief)
  extract-tailwind.js ← Read tailwind.config for colors/fonts/spacing
  extract-css.js      ← Parse CSS files for custom properties
  extract-logos.js    ← Find logo/brand assets via glob
  config-schema.js    ← Starter config template + merge logic
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

**Key principle**: `dist/` files are universal — they never contain brand-specific content. `config.json` is the only file that changes per client.

### Rendering Pipeline (dist/engine.js)

`engine.js` is a single async IIFE. On load:

1. **Bootstrap** — injects Google Fonts `<link>`, generates `:root` CSS variables from `config.theme`, sets page title
2. **renderShell()** — header, intro, footer, font specimens (reads `fonts.*.description` from config)
3. **renderNav()** — sidebar from `config.nav`
4. **renderSectionIntros()** — populates section intro text from `config.sections`
5. **renderColors()** — brand/neutrals/semantic grids (supports `{ label, items }` structure)
6. **renderGradients()** — gradient stops
7. **renderLogos()** — logo cards with format/size selection + canvas resize
8. **renderTypography()** — type scale
9. **renderHierarchy()** — text hierarchy demo from `config.hierarchy`
10. **renderVoice()** — do/don't cards
11. **renderComponents()** — buttons, cards, stats
12. **renderSpacing()**, **renderAccessibility()**, **renderCSSVars()**

Then interactivity: `initCopy()`, `initFormatBar()`, `initNav()`, `initTypeTester()`.

### How Theme Injection Works

`styles.css` ships a baseline `:root` block defining **every** token it consumes (default values), so a minimal/ported config never renders broken. Config-supplied tokens cascade over those defaults.

The accent uses a fill/text split: `--accent` (fill), `--accent-foreground` (text on the fill), `--accent-text` (accent as text on a light surface). The baseline aliases `--accent: var(--purple, …)` so pre-1.1.2 configs that set `--purple`/`--purple-rgb` still work.

- **Dev mode**: engine.js bootstrap reads `config.theme` and injects a `<style data-brandkit-theme>` `:root` block at runtime — appended to `<head>`, so it cascades over the baseline.
- **Production build**: `cli/build.js` uses `lib/template.js` to **append** the generated `:root` block after styles.css (so brand overrides win), plus injects the Google Fonts `<link>` and title into index.html.

### Config Schema

`config.json` top-level keys:

- `brand` — name, displayName, tagline, description, url, byline, version, date; optional `guideLabel` (renames the "Web Style Guide" header/footer label), `headerLogo` (image replacing the header text wordmark), `sidebarLogo` (image replacing the brand name at the top of the left menu). Logo fields fall back to `brand.name` text when empty/unset; the sidebar previously hardcoded "brandkit" — it now uses `brand.name`. Optional `agentCallout` (default `true`) toggles the sidebar "Using an AI agent?" copy-paste prompt; set `false` to hide it.
- `fonts` — display + body with `family`, `googleImport`, `description`
- `theme` — explicit CSS variable mapping (colors, gradients, font vars, `-rgb` variants)
- `nav` — sidebar groups and section links
- `colors` — `{ brand: { label, items }, neutrals: { label, items }, semantic: { label, items } }`
- `gradients` — CSS definitions with stops
- `gradientUsage` — do/don't lists
- `sections` — section intro strings (gradients, logos, components, spacing, variables, gradientTextDemo)
- `hierarchy` — text hierarchy demo data (class, colorVar, colorName, hex, description)
- `logos`, `logoSizes` — logo variants + available download sizes
- `typography` — full type scale with specimens
- `voice` — description + do/don't examples
- `accessibility` — contrast ratio grid
- `cssVariables` — variable reference display
- `spacing` — spacing scale tokens
- `components` — buttons, cards, stats

## CLI Commands

```bash
brandkit init [dir]        # Scaffold brand guide with starter config
brandkit generate [dir]    # Auto-extract config from codebase (Tailwind, CSS, logos)
brandkit dev [dir]         # Dev server at :4800 with live reload
brandkit build [dir]       # Build production static files (+ agent exports, embedded in the page)
brandkit export [dir]      # Emit only the agent exports (--format json|dtcg|md|all, --out <dir>)
```

`generate` merge strategy: extractable fields (colors, fonts, spacing, logos) overwrite; manual fields (voice, accessibility, components, typography samples) are preserved.

### Agent-native exports (lib/export.js)

`build` and `export` project `config.json` into machine-first views, written next to the HTML:
- `brand.json` — normalized, semantic brand (accent fill/text split with contrast, color roles, voice, logos with usage, spacing). The agent-first view, not the render config.
- `tokens.json` — W3C Design Tokens (DTCG) `{ $type, $value }` for color / fontFamily / dimension. Only hex theme values become color tokens (gradients/`-rgb` are excluded to stay tool-compatible).
- `brand.md` — an LLM brief; surfaces low-contrast pairs as explicit cautions.

`build` also injects `<link rel="alternate" type="application/json" href="brand.json">` and embeds `<script type="application/json" id="brandkit-brand">` (with `</script>` escaped) so an agent fetching the deployed page gets structured data without scraping. The transforms are pure (`lib/export.js`); file writing is `writeExports()`.

For a human pointing their own agent at the guide, `renderAgentCallout()` (engine.js) renders a "Using an AI agent?" box under the sidebar nav with a copy-paste prompt. The prompt resolves the export URLs against `location.href` (via `new URL`) so it carries absolute links to `brand.json` / `tokens.json` / `brand.md`, and names the brand from `cfg.brand`. Hide it with `brand.agentCallout: false`.

## Coding Standards

- **Vanilla JS only** — no frameworks, no build tools in dist/
- **ES5-compatible in dist/** — uses `var`, `.forEach()`, string concatenation
- **Node.js builtins only in cli/lib/** — zero npm dependencies
- **Config-driven** — no hardcoded brand content in dist/ files
- `styles.css` uses `var(--font-display)`, `var(--accent)`, `var(--accent-text)`, `var(--accent-rgb)` etc. — never literal font names or brand-specific colors (the baseline `:root` holds the only default values)

## Adding a New Section

1. Add the data to `config.json` schema (and `lib/config-schema.js` starter template)
2. Add a `render*()` function in `dist/engine.js`
3. Add an empty container element in `dist/index.html`
4. Add styles in `dist/styles.css` using only CSS variables
5. Call the render function in the "Execute all" block

## Default Demo Brand

`example/config.json` and `example/logos/` are the company-agnostic **Brandkit** demo — the same guide `brandkit init` scaffolds (`lib/config-schema.js` `starterConfig()`). It doubles as living documentation. Primary accent: indigo `#4F46E5` (text `#4338CA`). Fonts: Space Grotesk (display) + Inter (body). Logos are generated SVGs in `dist/logos/`.

`example/config.json` is a snapshot of `starterConfig()` with two overrides: `brand.version` tracks the package version (the demo *is* brandkit, so its guide version matches the release; the scaffold default stays `1.0` for real clients) and `brand.date` is pinned. Regenerate it after editing the starter:

```bash
node -e "const fs=require('fs');const pkg=require('./package.json');const s=require('./lib/config-schema').starterConfig();s.brand.version=pkg.version;s.brand.date='June 2026';fs.writeFileSync('example/config.json',JSON.stringify(s,null,2)+'\n')"
cp dist/engine.js dist/styles.css dist/index.html example/   # keep engine files in sync with dist/
node bin/brandkit.js export example                          # refresh the committed agent exports
```

`example/{brand.json,tokens.json,brand.md}` are committed as a reference of what the exports look like — regenerate them with `export` (not `build`, which would overwrite the raw dev `index.html`/`styles.css`).

No client brand data lives in this repo.
