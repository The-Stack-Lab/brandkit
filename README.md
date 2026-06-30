# @stacklist-app/brandkit

A config-driven brand guide that bolts onto any website. One `config.json` drives the entire guide — colors, typography, logos, voice, components, spacing, accessibility. Zero runtime dependencies.

Swap the config and assets to generate a brand guide for any project. An optional `generate` command scrapes an existing codebase (Tailwind config, CSS variables, logo files) to bootstrap the config automatically.

## Install

```bash
npm install @stacklist-app/brandkit
```

Requires Node.js 18+.

## Quickstart

```bash
npx brandkit init brand        # scaffold brand/config.json + starter assets
npx brandkit generate brand    # optional: auto-extract tokens from your codebase
npx brandkit dev brand         # preview at http://localhost:4800 (live reload)
npx brandkit build brand       # bake into static files for production
```

`init` scaffolds a complete, ready-to-run demo brand (the self-titled "Brandkit" guide), so `dev` shows a polished guide immediately — then you swap in your own colors, fonts, copy, and logos. The `brand` directory name is your choice — pass any path.

## CLI

| Command | Description |
|---|---|
| `brandkit init [dir]` | Scaffold a new brand guide with a starter `config.json` |
| `brandkit generate [dir]` | Extract colors, fonts, spacing, and logos from the host codebase and merge into `config.json`. Manual fields (voice, accessibility, components) are preserved. |
| `brandkit dev [dir]` | Local dev server on `:4800` with SSE live reload |
| `brandkit build [dir]` | Produce static `index.html` + `styles.css` + `engine.js` (theme baked in) **plus** the agent-native exports below |
| `brandkit export [dir]` | Emit just the agent-native brand data (`--format json\|dtcg\|md\|all`, `--out <dir>`) |
| `brandkit changelog "<msg>" [dir]` | Record a revision: prepend a changelog entry and bump `brand.version` (`--lock`, `--major`, `--version X.Y`, `--date`, `--dir`) |

## Agent-readable brand data

A brandkit guide isn't just a page for people — `build` (and the standalone `export` command) emit machine-native views of the brand so an AI agent or design-token tool can consume it without scraping HTML:

- **`brand.json`** — normalized, semantic brand: colors with **roles + contrast pairings**, the accent fill/text split, voice do/don'ts, typography, logos with usage, spacing. The agent-first view.
- **`tokens.json`** — the same colors, fonts, and spacing in **W3C Design Tokens (DTCG)** format (`{ "$type", "$value" }`), readable by Style Dictionary, Tokens Studio, and Figma.
- **`brand.md`** — an LLM brief ("how to write/design on-brand") you can drop straight into an agent's context.

`build` also makes the data **discoverable from the deployed page**: it injects `<link rel="alternate" type="application/json" href="brand.json">` and embeds the brand inline as `<script type="application/json" id="brandkit-brand">`, so an agent that fetches the URL gets structured brand data with zero extra requests.

And for a person who wants to hand the guide to their own agent, the sidebar shows a **"Using an AI agent?"** callout with a one-click copy-paste prompt — it carries absolute URLs to `brand.json` / `tokens.json` / `brand.md` and tells the agent to read those instead of scraping the page. Hide it with `brand.agentCallout: false`.

A JSON Schema for `config.json` ships at [`config.schema.json`](config.schema.json) — point your editor's `$schema` at it for validation and autocomplete.

## Changelog

A brand guide evolves, so brandkit keeps a history of its revisions. Record one with:

```bash
npx brandkit changelog "Swapped the accent to teal, refreshed the logo"
```

This prepends a `{ version, date, changes }` entry to `config.changelog` and bumps `brand.version`. A fresh guide starts at **0.1** and climbs with each change (`0.1 → 0.2 → …`); finalize the brand at **1.0** with `--lock`:

```bash
npx brandkit changelog --lock "Brand finalized"
```

The history renders on a standalone **`changelog.html`** page (linked from the bottom of the sidebar) and is included in `brand.json` / `brand.md` so agents see it too. `init` also scaffolds an **`AGENTS.md`** into the guide directory — a maintenance contract telling an AI agent the source of truth, to read from the exports, and to record changes with `brandkit changelog`.

## Framework integrations

Serve the brand guide at `/brand` in your existing dev server and bundle it on build.

**Vite**
```js
// vite.config.js
import brandkit from '@stacklist-app/brandkit/integrations/vite'

export default {
  plugins: [brandkit()],
}
```

**Astro**
```js
// astro.config.mjs
import brandkit from '@stacklist-app/brandkit/integrations/astro'

export default {
  integrations: [brandkit()],
}
```

**Next.js / plain HTML**: run `brandkit build brand` and serve the resulting directory as a static route.

### Serving from a base path

brandkit emits page-relative paths, which resolve only when the guide is served from the root or a **trailing-slash** directory URL (`/brand/`). If you serve it at `/brand` with **no** trailing slash — e.g. a Next.js rewrite that maps `/brand` to the built `/brand/index.html` — every relative path resolves against `/` instead, so `styles.css`, `engine.js`, and `config.json` all 404 and the guide renders an empty shell.

Set `basePath` in `config.json` to fix this:

```json
{
  "basePath": "/brand",
  "brand": { "name": "Acme" }
}
```

On `brandkit build`, the generated `index.html` then points its stylesheet, engine, and `brand.json` link at `${basePath}/…`, and the engine fetches `${basePath}/config.json` — so the guide loads fully whether or not the serving URL has a trailing slash. The value is normalized (leading slash added, trailing slash stripped). Omitting `basePath` keeps the original page-relative behavior, so existing setups are unaffected.

## Config

`config.json` is the single source of truth. Top-level keys:

- `basePath` — absolute path the guide is served from (e.g. `/brand`). Omit (or leave empty) when serving at the root or from a trailing-slash directory URL — output stays page-relative and unchanged. See [Serving from a base path](#serving-from-a-base-path).
- `brand` — name, tagline, description, version, date; optional `guideLabel` (renames the "Web Style Guide" header/footer label), `headerLogo` and `sidebarLogo` (logo image paths that replace the text wordmark in the header and left menu)
- `fonts` — display + body with Google Fonts import; each font takes an optional `fallback` web stand-in for brands whose official typeface isn't web-available (the rendered font stack becomes `'family', 'fallback', sans-serif`, while labels keep the clean family name)
- `theme` — CSS variable map (colors, gradients, font vars)
- `nav` — sidebar structure
- `colors` — brand / neutrals / semantic palettes
- `gradients`, `gradientUsage` — gradient definitions + do/don't lists
- `logos`, `logoSizes` — logo variants + download sizes
- `typography` — type scale and specimens
- `hierarchy` — text hierarchy demo
- `voice` — tone description + do/don't examples
- `components` — buttons, cards, stats
- `spacing` — spacing scale tokens
- `accessibility` — contrast ratio grid
- `cssVariables` — variable reference

See `example/config.json` for the complete default demo brand — the same config `init` scaffolds.

## Theming

`dist/styles.css` ships a baseline `:root` block with sensible defaults for **every** token it consumes, so a minimal or partial config never renders broken. Your config only needs to *override* what it wants to change.

The accent uses a fill/text split (the same convention as Material and shadcn/ui):

- `--accent` — the fill color (buttons, active states)
- `--accent-foreground` — text/icons **on** the fill (must meet contrast against `--accent`)
- `--accent-text` — the accent used **as** text or links on a light surface

This lets a low-contrast fill (say a bright orange) stay accessible: set `--accent-foreground: #000000` and `--accent-text` to a darker shade. Pre-1.1.2 configs that set `--purple` / `--purple-rgb` still work — those feed `--accent`.

By default the **primary button** and the **header** carry the accent. Brands that separate a brand role from the accent — e.g. a black primary CTA and a black hero, with orange kept as the accent — override:

- `--primary` / `--primary-foreground` — primary-button fill and the text on it (default to `--accent` / `--accent-foreground`)
- `--header-bg` — the header/hero background behind the wordmark or logo (defaults to `--gradient-brand`)

The fallbacks mean single-accent brands need set none of these.

- **Dev**: the engine reads `config.theme` and injects a `<style data-brandkit-theme>` block at runtime, which cascades over the defaults.
- **Build**: `brandkit build` appends the generated `:root` after the stylesheet's defaults and injects the Google Fonts `<link>` and page title into `index.html`.

Swap the config, and every color, gradient, and font token updates everywhere.

## License

MIT © The Stack Lab
