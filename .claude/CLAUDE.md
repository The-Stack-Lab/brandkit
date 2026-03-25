# Brandkit

A self-contained, config-driven brand guide that lives at `/brand` on any website. Zero dependencies — just HTML, CSS, and vanilla JS.

## Architecture

```
├── index.html      ← Minimal HTML shell (loads config + engine + styles)
├── config.json     ← ALL brand data (swap this per client)
├── engine.js       ← Rendering engine + interactivity (shared across clients)
├── styles.css      ← All visual design (shared, themeable via config)
└── logos/          ← Logo assets per client
```

**Key principle**: `config.json` is the only file that changes per client. Everything else is the reusable engine.

## How It Works

1. `index.html` loads Google Fonts (from config), links `styles.css`, and includes structural placeholders
2. `engine.js` fetches `config.json`, then renders every section from data:
   - Navigation (grouped sidebar)
   - Color palette with click-to-copy
   - Gradient system with live displays
   - Logo downloads with format/size selection
   - Typography specimens + interactive tester
   - Voice & tone guidelines
   - Component patterns (buttons, cards, stats)
   - Spacing scale
   - Accessibility contrast grid
   - CSS variable reference
3. Interactivity: clipboard API, toast notifications, IntersectionObserver nav, canvas-based logo resizing

## Sidebar Groups

- **Colors**: Palette, Gradients
- **Logos**: Downloads (multi-format: SVG/PNG/JPG, multi-size via canvas resize)
- **Content**: Typography, Text Hierarchy, Voice & Tone, Spacing
- **Components**: Buttons & Cards, Accessibility, CSS Variables

## Config Structure

`config.json` contains:
- `brand` — name, tagline, description, URL, version
- `fonts` — display + body font families with Google Fonts import strings
- `nav` — sidebar navigation groups and section links
- `colors` — brand, neutrals, semantic (each with hex, oklch, cssVar, role)
- `gradients` — CSS definitions with stop annotations
- `logos` — file paths per variant with format availability
- `typography` — full type scale with specimens
- `voice` — do/don't examples
- `accessibility` — contrast ratio grid
- `cssVariables` — complete variable reference
- `components` — button variants, card examples, stats
- `spacing` — scale tokens

## To Create a Guide for a New Client

1. Copy the entire directory
2. Replace `config.json` with the new client's brand data
3. Replace `logos/` with the new client's logo files
4. Update the Google Fonts `<link>` in `index.html` if fonts differ
5. Deploy — the engine renders everything from config

## Development

No build step. To run locally:
```bash
python3 -m http.server 8888
# Open http://localhost:8888
```

The `fetch()` call in engine.js requires a server (won't work from `file://`).

## Coding Standards

- **Vanilla JS only** — no frameworks, no build tools, no npm
- **ES5-compatible** — uses `var`, `.forEach()`, string concatenation (not template literals) for max browser compat
- **Config-driven** — no hardcoded brand content in HTML, CSS, or JS
- **Single responsibility**: `index.html` = structure, `styles.css` = visual, `engine.js` = logic, `config.json` = data
- **Clipboard API** for copy (`navigator.clipboard.writeText`)
- **Canvas API** for logo resizing (`toBlob`)
- **IntersectionObserver** for scroll-based nav highlighting

## Current Client

The checked-in `config.json` and `logos/` are for **Freeway PHX** (freewayphx.com) — a Phoenix tech ecosystem community. Colors: purple `#6B2FA0` primary, coral `#E86B5A` secondary. Fonts: Commissioner (display) + Ubuntu (body).
