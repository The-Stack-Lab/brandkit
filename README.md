# @stacklab/brandkit

A config-driven brand guide that bolts onto any website. One `config.json` drives the entire guide — colors, typography, logos, voice, components, spacing, accessibility. Zero runtime dependencies.

Swap the config and assets to generate a brand guide for any project. An optional `generate` command scrapes an existing codebase (Tailwind config, CSS variables, logo files) to bootstrap the config automatically.

## Install

```bash
npm install github:The-Stack-Lab/brandkit
# or pin to a tag
npm install github:The-Stack-Lab/brandkit#v1.1.1
```

Requires Node.js 18+.

## Quickstart

```bash
npx brandkit init brand        # scaffold brand/config.json + starter assets
npx brandkit generate brand    # optional: auto-extract tokens from your codebase
npx brandkit dev brand         # preview at http://localhost:4800 (live reload)
npx brandkit build brand       # bake into static files for production
```

The `brand` directory name is your choice — pass any path.

## CLI

| Command | Description |
|---|---|
| `brandkit init [dir]` | Scaffold a new brand guide with a starter `config.json` |
| `brandkit generate [dir]` | Extract colors, fonts, spacing, and logos from the host codebase and merge into `config.json`. Manual fields (voice, accessibility, components) are preserved. |
| `brandkit dev [dir]` | Local dev server on `:4800` with SSE live reload |
| `brandkit build [dir]` | Produce static `index.html` + `styles.css` + `engine.js` with the theme baked in |

## Framework integrations

Serve the brand guide at `/brand` in your existing dev server and bundle it on build.

**Vite**
```js
// vite.config.js
import brandkit from '@stacklab/brandkit/integrations/vite'

export default {
  plugins: [brandkit()],
}
```

**Astro**
```js
// astro.config.mjs
import brandkit from '@stacklab/brandkit/integrations/astro'

export default {
  integrations: [brandkit()],
}
```

**Next.js / plain HTML**: run `brandkit build brand` and serve the resulting directory as a static route.

## Config

`config.json` is the single source of truth. Top-level keys:

- `brand` — name, tagline, description, version
- `fonts` — display + body with Google Fonts import
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

See `example/config.json` for a complete reference implementation (Freeway PHX).

## How theming works

`dist/styles.css` uses CSS custom properties (`var(--purple)`, `var(--font-display)`, etc.) with no `:root` block.

- **Dev**: the engine reads `config.theme` and injects a `<style data-brandkit-theme>` tag at runtime.
- **Build**: `brandkit build` prepends the generated `:root` block to `styles.css` and injects the Google Fonts `<link>` and page title into `index.html`.

Swap the config, and every color, gradient, and font token updates everywhere.

## License

MIT © The Stack Lab
