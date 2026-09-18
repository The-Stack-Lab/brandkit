# @stacklist-app/brandkit

A config-driven brand guide that bolts onto any website. One `config.json` drives the entire guide: colors, typography, logos, voice, components, spacing, accessibility. Zero runtime dependencies.

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

`init` scaffolds a complete, ready-to-run demo brand (the self-titled "Brandkit" guide), so `dev` shows a polished guide immediately. Then you swap in your own colors, fonts, copy, and logos. The `brand` directory name is your choice: pass any path.

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

A brandkit guide isn't just a page for people. `build` (and the standalone `export` command) emit machine-native views of the brand so an AI agent or design-token tool can consume it without scraping HTML:

- **`brand.json`**: normalized, semantic brand: colors with **roles + contrast pairings**, the accent fill/text split, voice do/don'ts, typography, logos with usage, spacing. The agent-first view.
- **`tokens.json`**: the same colors, fonts, and spacing in **W3C Design Tokens (DTCG)** format (`{ "$type", "$value" }`), readable by Style Dictionary, Tokens Studio, and Figma.
- **`brand.md`**: an LLM brief ("how to write/design on-brand") you can drop straight into an agent's context.

**Which export to hand to which job:**

| You are asking an agent or tool to... | Hand it | Why |
|---|---|---|
| Write copy, or design anything in any medium (a social card, a slide, a lower third, a page) | `brand.md` | Complete on its own: voice, the full palette with roles and text-safety, the type scale, spacing, logo usage rules, and one block of instructions per output format. Plain language, no parsing. |
| Generate work programmatically, or look up exact values (a logo file path, a safe zone in pixels, a resolved type style) | `brand.json` | The same brand as structured data. Every name is already resolved to its value, so nothing needs cross-referencing. |
| Feed a design-token pipeline (Style Dictionary, Tokens Studio, Figma variables) or theme code | `tokens.json` | W3C DTCG. Theme variables stay at `color.<name>`; the brand's own palette is at `color.palette.<name>`, with the role as `$description`. It carries values only, not rules: no voice, logos, or formats. |

If an agent can take only one file, give it `brand.md`.

`build` also makes the data **discoverable from the deployed page**: it injects `<link rel="alternate" type="application/json" href="brand.json">` and embeds the brand inline as `<script type="application/json" id="brandkit-brand">`, so an agent that fetches the URL gets structured brand data with zero extra requests.

And for a person who wants to hand the guide to their own agent, the sidebar shows a **"Using an AI agent?"** callout with a one-click copy-paste prompt. It carries absolute URLs to `brand.json` / `tokens.json` / `brand.md` and tells the agent to read those instead of scraping the page. Hide it with `brand.agentCallout: false`.

A JSON Schema for `config.json` ships at [`config.schema.json`](config.schema.json). Point your editor's `$schema` at it for validation and autocomplete.

## Changelog

A brand guide evolves, so brandkit keeps a history of its revisions. Record one with:

```bash
npx brandkit changelog "Swapped the accent to teal, refreshed the logo"
```

This prepends a `{ version, date, changes }` entry to `config.changelog` and bumps `brand.version`. A fresh guide starts at **0.1** and climbs with each change (`0.1 → 0.2 → …`); finalize the brand at **1.0** with `--lock`:

```bash
npx brandkit changelog --lock "Brand finalized"
```

The history renders on a standalone **`changelog.html`** page (linked from the bottom of the sidebar) and is included in `brand.json` / `brand.md` so agents see it too. `init` also scaffolds an **`AGENTS.md`** into the guide directory, a maintenance contract telling an AI agent the source of truth, to read from the exports, and to record changes with `brandkit changelog`.

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

brandkit emits page-relative paths, which resolve only when the guide is served from the root or a **trailing-slash** directory URL (`/brand/`). If you serve it at `/brand` with **no** trailing slash, e.g. a Next.js rewrite that maps `/brand` to the built `/brand/index.html`, every relative path resolves against `/` instead, so `styles.css`, `engine.js`, and `config.json` all 404 and the guide renders an empty shell.

Set `basePath` in `config.json` to fix this:

```json
{
  "basePath": "/brand",
  "brand": { "name": "Acme" }
}
```

On `brandkit build`, the generated `index.html` then points its stylesheet, engine, and `brand.json` link at `${basePath}/…`, and the engine fetches `${basePath}/config.json`, so the guide loads fully whether or not the serving URL has a trailing slash. The value is normalized (leading slash added, trailing slash stripped). Omitting `basePath` keeps the original page-relative behavior, so existing setups are unaffected.

## Config

`config.json` is the single source of truth. Top-level keys:

- `basePath`: absolute path the guide is served from (e.g. `/brand`). Omit (or leave empty) when serving at the root or from a trailing-slash directory URL: output stays page-relative and unchanged. See [Serving from a base path](#serving-from-a-base-path).
- `brand`: name, tagline, description, version, date; optional `guideLabel` (renames the "Web Style Guide" header/footer label), `headerLogo` and `sidebarLogo` (logo image paths that replace the text wordmark in the header and left menu)
- `fonts`: display + body with Google Fonts import; each font takes an optional `fallback` web stand-in for brands whose official typeface isn't web-available (the rendered font stack becomes `'family', 'fallback', sans-serif`, while labels keep the clean family name)
- `theme`: CSS variable map (colors, gradients, font vars)
- `nav`: sidebar structure
- `colors`: brand / neutrals / semantic palettes
- `gradients`, `gradientUsage`: gradient definitions + do/don't lists
- `logos`, `logoSizes`: logo variants + download sizes
- `logoUsage`: optional logo rules (clear space, minimum size, allowed placement, misuse). See [Formats and logo usage](#formats-and-logo-usage).
- `formats`: optional output canvases (social cards, slides, video, print) with safe zones, logo placement, type and backgrounds. See [Formats and logo usage](#formats-and-logo-usage).
- `typography`: type scale and specimens
- `hierarchy`: text hierarchy demo
- `voice`: tone description + do/don't examples
- `components`: buttons, cards, stats
- `spacing`: spacing scale tokens
- `accessibility`: contrast ratio grid
- `cssVariables`: variable reference

See `example/config.json` for the complete default demo brand (the same config `init` scaffolds).

## Formats and logo usage

Colors and fonts tell an agent what a brand looks like. They do not tell it how big the canvas is, where the logo goes, or how far text must stay from the edge. Two optional config sections carry those rules. Both render as sections in the guide (with a sidebar link added automatically) and export to `brand.json` and `brand.md`. Leave them out and nothing changes.

```json
{
  "logoUsage": {
    "clearSpace": { "rule": "the height of the F mark on all sides", "ratio": 0.5 },
    "minSize": { "digitalPx": 96, "printMm": 25 },
    "placement": ["top left", "bottom left", "centered"],
    "dont": ["Stretch, squash or rotate the logo", "Place it on busy photography without an overlay"]
  },
  "formats": [
    {
      "preset": "social-square",
      "name": "Instagram square",
      "safeZone": 80,
      "logo": { "variant": "Logotype White", "placement": "bottom left", "maxWidth": 260 },
      "typography": {
        "headline": { "style": "H1", "size": "76px" },
        "body": { "style": "Body LG", "size": "32px" }
      },
      "background": ["Indigo", "gradient", { "type": "photo", "overlay": "a 60% Ink overlay" }],
      "notes": "One idea per card."
    },
    "slide-16x9"
  ]
}
```

- **`logoUsage`** applies to every logo. The same four fields (`clearSpace`, `minSize`, `placement`, `dont`) can also be set on a single `logos[]` entry to override the rule for that logo. `clearSpace` is relative to the logo so it holds at any size; `ratio` is a multiple of the logo's height.
- **`formats[].preset`** supplies the canvas so you do not restate dimensions. Anything you set on the entry (such as `name`) overrides the preset. A bare string is shorthand for `{ "preset": "..." }`.

  | Preset | Canvas | Kind |
  |---|---|---|
  | `social-square` | 1080 x 1080 px | social |
  | `social-portrait` | 1080 x 1350 px | social |
  | `social-story` | 1080 x 1920 px | social |
  | `link-card` | 1200 x 630 px | social |
  | `slide-16x9` | 1920 x 1080 px | presentation |

  The dimensions work as aliases (`"preset": "1200x630"`). For anything else, skip `preset` and give `name`, `kind` (`social`, `presentation`, `video`, `print`, `other`), `width`, `height` and `unit`.
- **`safeZone`** is a number (every side) or `{ top, right, bottom, left }`, with `all` as the default for sides you omit.
- **`logo.variant`**, **`typography.*.style`** and **`background`** strings are names: a `logos[].name`, a `typography[].name`, a palette color's `name` (or the word `gradient`). The exports resolve each one to its file path, type metrics, or hex. A name that matches nothing is listed under "Not yet defined" in `brand.md` rather than guessed at.
- **`typography.*.size`** overrides the scale's size for that canvas, because a 72px web display size is wrong on a 1080px card.
- Intro copy for the two sections goes in `sections.logoUsage` and `sections.formats`.

Presets cover only the canvas. Logo position, backgrounds and type choices are brand decisions and stay in your config.

### Adopting this in an existing guide

1. Upgrade brandkit. An existing `config.json` builds as before.
2. Add `logoUsage` and a `formats` array to `config.json` (start from the example above, using your own logo, color and type-style names).
3. Run `brandkit build` (or `dev`) and check the new Logo Usage and Formats sections, then read the "Formats" part of `brand.md` as if you were the agent.
4. Record it: `brandkit changelog "Added logo usage rules and output formats."`

You do not need to edit `nav`. The sidebar links appear on their own; add `{ "label": "...", "id": "logo-usage" }` or `"id": "formats"` to `nav` only if you want to control their position or label.

## Theming

`dist/styles.css` ships a baseline `:root` block with sensible defaults for **every** token it consumes, so a minimal or partial config never renders broken. Your config only needs to *override* what it wants to change.

The accent uses a fill/text split (the same convention as Material and shadcn/ui):

- `--accent`: the fill color (buttons, active states)
- `--accent-foreground`: text/icons **on** the fill (must meet contrast against `--accent`)
- `--accent-text`: the accent used **as** text or links on a light surface

This lets a low-contrast fill (say a bright orange) stay accessible: set `--accent-foreground: #000000` and `--accent-text` to a darker shade. Pre-1.1.2 configs that set `--purple` / `--purple-rgb` still work: those feed `--accent`.

By default the **primary button** and the **header** carry the accent. Brands that separate a brand role from the accent, e.g. a black primary CTA and a black hero, with orange kept as the accent, override:

- `--primary` / `--primary-foreground`: primary-button fill and the text on it (default to `--accent` / `--accent-foreground`)
- `--header-bg`: the header/hero background behind the wordmark or logo (defaults to `--gradient-brand`)

The fallbacks mean single-accent brands need set none of these.

- **Dev**: the engine reads `config.theme` and injects a `<style data-brandkit-theme>` block at runtime, which cascades over the defaults.
- **Build**: `brandkit build` appends the generated `:root` after the stylesheet's defaults and injects the Google Fonts `<link>` and page title into `index.html`.

Swap the config, and every color, gradient, and font token updates everywhere.

## License

MIT © The Stack Lab
