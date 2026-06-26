/**
 * Default showcase config — a complete, company-agnostic "Brandkit" brand guide.
 *
 * This is what `brandkit init` scaffolds and what the example/ demo renders, so
 * a fresh standup looks polished immediately. It doubles as living documentation:
 * every section is populated with real, neutral sample content (no __TODO), using
 * the v1.1.2 accent convention (--accent / --accent-foreground / --accent-text).
 *
 * Swap the values for your own brand. `brandkit generate` overwrites the
 * extractable fields (colors, fonts, spacing, logos) from your codebase and
 * preserves the curated ones (voice, components, accessibility copy).
 */
function starterConfig() {
  return {
    brand: {
      name: 'brandkit',
      displayName: 'Brandkit',
      tagline: 'The config-driven brand guide',
      description: 'Brandkit turns a single config.json into a complete, living brand guide — colors, typography, logos, voice, and components, all driven by design tokens. This is the default guide; swap the config and assets to make it your own.',
      url: 'github.com/The-Stack-Lab/brandkit',
      byline: 'Open source · MIT',
      version: '1.0',
      date: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    },
    fonts: {
      display: {
        family: 'Space Grotesk',
        googleImport: 'Space+Grotesk:wght@400;500;600;700',
        description: 'Space Grotesk — a geometric sans with a little character. Used for headlines, the wordmark, and large display moments.'
      },
      body: {
        family: 'Inter',
        googleImport: 'Inter:wght@300;400;500;600;700',
        description: 'Inter — a highly legible workhorse for body copy, UI labels, and long-form reading at every size.'
      }
    },
    theme: {
      // Accent fill vs. text split. --accent is the fill; --accent-foreground
      // is text/icons ON the fill; --accent-text is the accent used AS text on
      // a light surface. For a low-contrast fill (e.g. a bright orange), set
      // --accent-foreground to a dark value and --accent-text to a darker shade.
      '--accent': '#4F46E5',
      '--accent-rgb': '79, 70, 229',
      '--accent-foreground': '#FFFFFF',
      '--accent-text': '#4338CA',
      '--lavender': '#A5B4FC',
      '--coral': '#FB7185',
      '--coral-dark': '#E11D48',
      '--coral-light': '#FDA4AF',
      '--magenta': '#DB2777',
      '--ink': '#111827',
      '--graphite': '#374151',
      '--slate': '#6B7280',
      '--haze': '#D1D5DB',
      '--mist': '#F3F4F6',
      '--cloud': '#F9FAFB',
      '--white': '#FFFFFF',
      '--success': '#16A34A',
      '--warning': '#D97706',
      '--error': '#DC2626',
      '--info': '#2563EB',
      '--gradient-brand': 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
      '--gradient-brand-subtle': 'linear-gradient(135deg, rgba(79, 70, 229, 0.06) 0%, rgba(124, 58, 237, 0.06) 100%)',
      '--ink-rgb': '17, 24, 39',
      '--error-rgb': '220, 38, 38',
      '--success-rgb': '22, 163, 74'
    },
    nav: [
      { group: 'Colors', items: [
        { label: 'Palette', id: 'palette' },
        { label: 'Gradients', id: 'gradients' }
      ]},
      { group: 'Logos', items: [
        { label: 'Downloads', id: 'logos' }
      ]},
      { group: 'Content', items: [
        { label: 'Typography', id: 'typography' },
        { label: 'Text Hierarchy', id: 'hierarchy' },
        { label: 'Voice & Tone', id: 'voice' },
        { label: 'Spacing', id: 'spacing' }
      ]},
      { group: 'Components', items: [
        { label: 'Buttons & Cards', id: 'components' },
        { label: 'Accessibility', id: 'accessibility' },
        { label: 'CSS Variables', id: 'variables' }
      ]}
    ],
    colors: {
      brand: { label: 'Brand', items: [
        { name: 'Indigo', hex: '#4F46E5', oklch: 'oklch(0.51 0.23 277)', cssVar: '--accent', role: 'Primary accent — buttons, links, focus', light: false },
        { name: 'Violet', hex: '#7C3AED', oklch: 'oklch(0.54 0.25 293)', cssVar: '--accent-2', role: 'Secondary accent, gradient end', light: false }
      ]},
      neutrals: { label: 'Neutrals', items: [
        { name: 'Ink', hex: '#111827', oklch: 'oklch(0.21 0.03 265)', cssVar: '--ink', role: 'Primary text, headings', light: false },
        { name: 'Graphite', hex: '#374151', oklch: 'oklch(0.37 0.03 260)', cssVar: '--graphite', role: 'Secondary text, descriptions', light: false },
        { name: 'Slate', hex: '#6B7280', oklch: 'oklch(0.55 0.02 264)', cssVar: '--slate', role: 'Tertiary text, captions', light: false },
        { name: 'Mist', hex: '#F3F4F6', oklch: 'oklch(0.97 0.00 265)', cssVar: '--mist', role: 'Borders, section backgrounds', light: true },
        { name: 'Cloud', hex: '#F9FAFB', oklch: 'oklch(0.98 0.00 248)', cssVar: '--cloud', role: 'Page background', light: true }
      ]},
      semantic: { label: 'Semantic', items: [
        { name: 'Success', hex: '#16A34A', oklch: 'oklch(0.63 0.17 149)', cssVar: '--success', role: 'Confirmations, positive states', light: false },
        { name: 'Warning', hex: '#D97706', oklch: 'oklch(0.67 0.16 58)', cssVar: '--warning', role: 'Attention, caution states', light: false },
        { name: 'Error', hex: '#DC2626', oklch: 'oklch(0.58 0.22 27)', cssVar: '--error', role: 'Errors, destructive actions', light: false }
      ]}
    },
    gradients: [
      {
        name: 'Brand',
        css: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
        description: 'Hero backgrounds, feature headers, the wordmark lockup',
        stops: [
          { color: '#4F46E5', position: '0%', name: 'Indigo' },
          { color: '#7C3AED', position: '100%', name: 'Violet' }
        ]
      },
      {
        name: 'Subtle',
        css: 'linear-gradient(135deg, rgba(79, 70, 229, 0.06) 0%, rgba(124, 58, 237, 0.06) 100%)',
        description: 'Card tints, section backgrounds, hover states'
      }
    ],
    gradientUsage: {
      do: ['Hero and feature section backgrounds', 'Large display headlines (as gradient text)', 'Key stat numbers and accent moments'],
      dont: ['Body copy or small text', 'Behind dense UI or data tables', 'More than one focal area per screen']
    },
    sections: {
      gradients: 'One brand gradient, used sparingly for hero moments and large headlines. The subtle variant tints cards and section backgrounds without competing with content.',
      gradientTextDemo: 'One config, every token.',
      logos: 'Download the logo in the format and size you need. Select a variant, then download — raster formats can be resized on the fly.',
      components: 'A small set of building blocks — buttons, cards, and stats — that inherit every brand token automatically. Change the config and they all update.',
      spacing: 'A consistent spacing scale keeps layouts in rhythm. Use these tokens for padding, gaps, and margins instead of arbitrary values.',
      variables: 'Every token below is a CSS custom property. Copy any line and drop it straight into your stylesheet.'
    },
    hierarchy: [
      { class: 'h-primary', label: 'Primary', colorVar: '--ink', colorName: 'Ink', hex: '#111827', description: 'Primary text — body copy, headings, and content where readability is critical.' },
      { class: 'h-secondary', label: 'Secondary', colorVar: '--graphite', colorName: 'Graphite', hex: '#374151', description: 'Secondary text — descriptions, supporting information, and labels.' },
      { class: 'h-tertiary', label: 'Tertiary', colorVar: '--slate', colorName: 'Slate', hex: '#6B7280', description: 'Tertiary text — captions, timestamps, footnotes, and metadata.' },
      { class: 'h-accent', label: 'Accent', colorVar: '--accent-text', colorName: 'Indigo', hex: '#4338CA', description: 'Accent text — links, interactive labels, and calls to action.' }
    ],
    logos: [
      { name: 'Wordmark', description: 'Primary lockup — use on light backgrounds.', variants: { svg: 'logos/brandkit-wordmark-dark.svg' }, background: 'light' },
      { name: 'Wordmark, reversed', description: 'For dark backgrounds and photography.', variants: { svg: 'logos/brandkit-wordmark-light.svg' }, background: 'dark' },
      { name: 'Monogram', description: 'Compact mark for avatars and favicons.', variants: { svg: 'logos/brandkit-mark.svg' }, background: 'light' },
      { name: 'Monogram on gradient', description: 'Reversed mark for the brand gradient.', variants: { svg: 'logos/brandkit-mark-white.svg' }, background: 'gradient' }
    ],
    logoSizes: [
      { label: 'Original', width: null },
      { label: '800px', width: 800 },
      { label: '400px', width: 400 },
      { label: '200px', width: 200 }
    ],
    typography: [
      { name: 'Display XL', font: 'display', size: '72px', weight: 700, tracking: '-0.03em', leading: '1.05', sample: 'One config, every token' },
      { name: 'Display', font: 'display', size: '56px', weight: 700, tracking: '-0.025em', leading: '1.1', sample: 'A brand guide that builds itself' },
      { name: 'H1', font: 'display', size: '44px', weight: 700, tracking: '-0.02em', leading: '1.15', sample: 'Design tokens, end to end' },
      { name: 'H2', font: 'display', size: '36px', weight: 700, tracking: '-0.015em', leading: '1.2', sample: 'Colors, type, and components' },
      { name: 'H3', font: 'display', size: '28px', weight: 600, tracking: '-0.01em', leading: '1.3', sample: 'Consistent by construction' },
      { name: 'H4', font: 'display', size: '22px', weight: 600, tracking: '-0.005em', leading: '1.35', sample: 'A card heading, set in display' },
      { name: 'Body LG', font: 'body', size: '18px', weight: 400, tracking: '0', leading: '1.7', sample: 'Lead paragraphs and intros sit comfortably at this size with generous line height.' },
      { name: 'Body', font: 'body', size: '16px', weight: 400, tracking: '0', leading: '1.7', sample: 'The default for body copy — legible, neutral, and easy on the eyes at any length.' },
      { name: 'Body SM', font: 'body', size: '14px', weight: 400, tracking: '0', leading: '1.6', sample: 'Smaller supporting text for secondary details and helper copy.' },
      { name: 'Caption', font: 'body', size: '12px', weight: 500, tracking: '0.02em', leading: '1.5', sample: 'Captions, timestamps, and metadata' },
      { name: 'Overline', font: 'body', size: '11px', weight: 700, tracking: '0.1em', leading: '1.4', sample: 'Section label', uppercase: true }
    ],
    voice: {
      description: 'Clear, confident, and friendly. Brandkit speaks like a thoughtful teammate — it explains the what and the why without jargon, and never talks down to the reader.',
      do: ['Swap the config and your whole guide updates.', 'Every token is one source of truth.', 'Ship a polished brand guide in minutes.'],
      dont: ['Leverage synergistic design paradigms.', 'It just works (somehow).', 'Refer to the documentation for further details.']
    },
    accessibility: [
      { fg: '#4338CA', bg: '#FFFFFF', fgName: 'Indigo Text', bgName: 'White', ratio: '7.9:1', rating: 'AAA', border: true, largeText: false },
      { fg: '#FFFFFF', bg: '#4F46E5', fgName: 'White', bgName: 'Indigo', ratio: '6.3:1', rating: 'AA', border: false, largeText: false },
      { fg: '#FFFFFF', bg: '#111827', fgName: 'White', bgName: 'Ink', ratio: '17.7:1', rating: 'AAA', border: false, largeText: false },
      { fg: '#374151', bg: '#F9FAFB', fgName: 'Graphite', bgName: 'Cloud', ratio: '9.9:1', rating: 'AAA', border: true, largeText: false },
      { fg: '#6B7280', bg: '#FFFFFF', fgName: 'Slate', bgName: 'White', ratio: '4.8:1', rating: 'AA', border: true, largeText: false },
      { fg: '#FFFFFF', bg: '#16A34A', fgName: 'White', bgName: 'Success', ratio: '3.3:1', rating: 'AA Large', border: false, largeText: true }
    ],
    cssVariables: [
      { section: 'Accent', vars: [
        { prop: '--accent', value: '#4F46E5', comment: 'Fill — buttons, active states' },
        { prop: '--accent-foreground', value: '#FFFFFF', comment: 'Text/icons on the fill' },
        { prop: '--accent-text', value: '#4338CA', comment: 'Accent as text on light' }
      ]},
      { section: 'Neutrals', vars: [
        { prop: '--ink', value: '#111827', comment: 'Primary text' },
        { prop: '--slate', value: '#6B7280', comment: 'Tertiary text' },
        { prop: '--cloud', value: '#F9FAFB', comment: 'Page background' }
      ]},
      { section: 'Typography', vars: [
        { prop: '--font-display', value: "'Space Grotesk', sans-serif", comment: 'Display font' },
        { prop: '--font-body', value: "'Inter', sans-serif", comment: 'Body font' }
      ]}
    ],
    spacing: [
      { px: 4, token: 'space-1' }, { px: 8, token: 'space-2' },
      { px: 12, token: 'space-3' }, { px: 16, token: 'space-4' },
      { px: 24, token: 'space-6' }, { px: 32, token: 'space-8' },
      { px: 48, token: 'space-12' }, { px: 64, token: 'space-16' },
      { px: 96, token: 'space-24' }
    ],
    components: {
      buttons: [
        { variant: 'Primary', items: [
          { class: 'btn-primary', sizes: ['sm', 'md', 'lg'], labels: ['Get started', 'Get started', 'Get started'] }
        ]},
        { variant: 'Secondary & ghost', items: [
          { class: 'btn-secondary', sizes: ['md'], labels: ['Documentation'] },
          { class: 'btn-ghost', sizes: ['md'], labels: ['Learn more'] }
        ]},
        { variant: 'Gradient', items: [
          { class: 'btn-gradient', sizes: ['md'], labels: ['Try the demo'] }
        ]}
      ],
      cards: [
        { title: 'One config', description: 'A single config.json drives every color, font, and component in the guide.', tag: 'Tokens' },
        { title: 'Zero dependencies', description: 'Vanilla JS and CSS variables — nothing to install, nothing to maintain.', tag: 'Lightweight' },
        { title: 'Bolts onto anything', description: 'Drop it into React, Vite, Astro, Next.js, or plain HTML in minutes.', tag: 'Portable' }
      ],
      stats: [
        { value: '1', label: 'Config file to rule them all' },
        { value: '0', label: 'Runtime dependencies' },
        { value: '12', label: 'Sections, rendered from tokens' }
      ]
    }
  };
}

/**
 * Deep merge: target values win over source for manually-curated fields.
 * Source (extracted) overwrites target for extractable fields.
 */
function mergeConfigs(existing, extracted) {
  var result = JSON.parse(JSON.stringify(existing));

  // Extractable fields: overwrite from extracted data
  // Only fields that come from external sources (Tailwind, CSS, file system)
  // Derived fields (gradients, hierarchy, accessibility, cssVariables, typography)
  // are NOT in this list — they only overwrite if existing is empty/scaffold
  var extractable = ['colors', 'fonts', 'theme', 'spacing', 'logos', 'logoSizes'];
  for (var i = 0; i < extractable.length; i++) {
    var key = extractable[i];
    if (extracted[key] !== undefined && extracted[key] !== null) {
      // For arrays, only overwrite if extracted has actual content
      if (Array.isArray(extracted[key]) && extracted[key].length === 0) continue;
      result[key] = extracted[key];
    }
  }

  // Everything else: keep existing (manual/curated fields)
  return result;
}

module.exports = {
  starterConfig: starterConfig,
  mergeConfigs: mergeConfigs
};
