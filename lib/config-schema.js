/**
 * Starter config template with __TODO markers for AI agents.
 * Every section includes example entries with the correct field names
 * so AI agents can see the exact schema contract.
 * Extractable fields (colors, fonts, spacing, logos) are populated by generate.
 */
function starterConfig() {
  return {
    brand: {
      name: '__TODO',
      displayName: '__TODO',
      tagline: '__TODO',
      description: '__TODO: A brief description of the brand and its visual language.',
      url: '__TODO',
      byline: '__TODO',
      version: '1.0',
      date: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    },
    fonts: {
      display: {
        family: 'Inter',
        googleImport: 'Inter:wght@300;400;500;600;700',
        description: '__TODO: Describe the display font character and usage.'
      },
      body: {
        family: 'Inter',
        googleImport: 'Inter:wght@300;400;500;600;700',
        description: '__TODO: Describe the body font character and usage.'
      }
    },
    theme: {
      '--purple': '#6366F1',
      '--violet': '#4338CA',
      '--lavender': '#A5B4FC',
      '--coral': '#F87171',
      '--coral-dark': '#DC2626',
      '--coral-light': '#FCA5A5',
      '--magenta': '#EC4899',
      '--ink': '#111827',
      '--graphite': '#374151',
      '--slate': '#6B7280',
      '--haze': '#D1D5DB',
      '--mist': '#F3F4F6',
      '--cloud': '#F9FAFB',
      '--white': '#FFFFFF',
      '--success': '#10B981',
      '--warning': '#F59E0B',
      '--error': '#EF4444',
      '--info': '#3B82F6',
      '--gradient-brand': 'linear-gradient(135deg, #4338CA 0%, #6366F1 50%, #EC4899 100%)',
      '--gradient-brand-subtle': 'linear-gradient(135deg, rgba(99, 102, 241, 0.06) 0%, rgba(236, 72, 153, 0.06) 100%)',
      '--purple-rgb': '99, 102, 241',
      '--ink-rgb': '17, 24, 39',
      '--error-rgb': '239, 68, 68',
      '--success-rgb': '16, 185, 129'
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
        { name: '__TODO: Primary', hex: '#6366F1', oklch: 'oklch(0.55 0.22 264)', cssVar: '--color-primary', role: '__TODO: Primary accent', light: false },
        { name: '__TODO: Secondary', hex: '#EC4899', oklch: 'oklch(0.59 0.22 346)', cssVar: '--color-secondary', role: '__TODO: Secondary accent', light: false }
      ]},
      neutrals: { label: 'Neutrals', items: [
        { name: 'Ink', hex: '#111827', oklch: 'oklch(0.17 0.02 265)', cssVar: '--foreground', role: 'Primary text, headings', light: false },
        { name: 'Slate', hex: '#6B7280', oklch: 'oklch(0.55 0.02 265)', cssVar: '--muted-foreground', role: 'Tertiary text, captions', light: false },
        { name: 'Mist', hex: '#F3F4F6', oklch: 'oklch(0.96 0.01 265)', cssVar: '--secondary', role: 'Section backgrounds', light: true },
        { name: 'Cloud', hex: '#F9FAFB', oklch: 'oklch(0.98 0.00 265)', cssVar: '--background', role: 'Page background', light: true }
      ]},
      semantic: { label: 'Semantic', items: [
        { name: 'Success', hex: '#10B981', oklch: 'oklch(0.70 0.17 163)', cssVar: '--success', role: 'Confirmations, positive states', light: false },
        { name: 'Warning', hex: '#F59E0B', oklch: 'oklch(0.78 0.16 80)', cssVar: '--warning', role: 'Attention, caution states', light: false },
        { name: 'Error', hex: '#EF4444', oklch: 'oklch(0.59 0.22 27)', cssVar: '--destructive', role: 'Errors, destructive actions', light: false }
      ]}
    },
    gradients: [
      {
        name: 'Brand',
        css: 'linear-gradient(135deg, #4338CA 0%, #6366F1 50%, #EC4899 100%)',
        description: '__TODO: Primary gradient usage',
        stops: [
          { color: '#4338CA', position: '0%', name: 'Violet' },
          { color: '#6366F1', position: '50%', name: 'Indigo' },
          { color: '#EC4899', position: '100%', name: 'Pink' }
        ]
      },
      {
        name: 'Subtle',
        css: 'linear-gradient(135deg, rgba(99, 102, 241, 0.06) 0%, rgba(236, 72, 153, 0.06) 100%)',
        description: 'Card tints, section backgrounds, hover states'
      }
    ],
    gradientUsage: {
      do: ['__TODO: When to use the gradient'],
      dont: ['__TODO: When not to use the gradient']
    },
    sections: {
      gradients: '__TODO: Describe the gradient system.',
      gradientTextDemo: '__TODO: A headline to demo gradient text.',
      logos: 'Download logo files for use across web, social, and print materials. Select format and size, then download.',
      components: '__TODO: Describe the component patterns.',
      spacing: '__TODO: Describe the spacing scale.',
      variables: '__TODO: Describe the CSS variable system.'
    },
    hierarchy: [
      { class: 'h-primary', label: 'Primary', colorVar: '--ink', colorName: 'Ink', hex: '#111827', description: 'Primary text — body copy, headings, and content where readability is critical.' },
      { class: 'h-secondary', label: 'Secondary', colorVar: '--graphite', colorName: 'Graphite', hex: '#374151', description: 'Secondary text — descriptions, supporting information, and labels.' },
      { class: 'h-tertiary', label: 'Tertiary', colorVar: '--slate', colorName: 'Slate', hex: '#6B7280', description: 'Tertiary text — captions, timestamps, footnotes, and metadata.' },
      { class: 'h-accent', label: 'Accent', colorVar: '--purple', colorName: 'Primary', hex: '#6366F1', description: 'Accent text — links, interactive labels, and calls to action.' }
    ],
    logos: [],
    logoSizes: [
      { label: 'Original', width: null },
      { label: '800px', width: 800 },
      { label: '400px', width: 400 },
      { label: '200px', width: 200 }
    ],
    typography: [
      { name: 'Display XL', font: 'display', size: '72px', weight: 700, tracking: '-0.03em', leading: '1.05', sample: '__TODO: Hero headline' },
      { name: 'Display', font: 'display', size: '56px', weight: 700, tracking: '-0.025em', leading: '1.1', sample: '__TODO: Section headline' },
      { name: 'H1', font: 'display', size: '44px', weight: 700, tracking: '-0.02em', leading: '1.15', sample: '__TODO: Page heading' },
      { name: 'H2', font: 'display', size: '36px', weight: 700, tracking: '-0.015em', leading: '1.2', sample: '__TODO: Section heading' },
      { name: 'H3', font: 'display', size: '28px', weight: 600, tracking: '-0.01em', leading: '1.3', sample: '__TODO: Subsection heading' },
      { name: 'H4', font: 'display', size: '22px', weight: 600, tracking: '-0.005em', leading: '1.35', sample: '__TODO: Card heading' },
      { name: 'Body LG', font: 'body', size: '18px', weight: 400, tracking: '0', leading: '1.7', sample: '__TODO: Intro paragraph' },
      { name: 'Body', font: 'body', size: '16px', weight: 400, tracking: '0', leading: '1.7', sample: '__TODO: Body copy' },
      { name: 'Body SM', font: 'body', size: '14px', weight: 400, tracking: '0', leading: '1.6', sample: '__TODO: Small text' },
      { name: 'Caption', font: 'body', size: '12px', weight: 500, tracking: '0.02em', leading: '1.5', sample: '__TODO: Caption text' },
      { name: 'Overline', font: 'body', size: '11px', weight: 700, tracking: '0.1em', leading: '1.4', sample: '__TODO: Overline text', uppercase: true }
    ],
    voice: {
      description: '__TODO: Describe the brand voice.',
      do: ['__TODO: Example of good copy'],
      dont: ['__TODO: Example of bad copy']
    },
    accessibility: [
      { fg: '#6366F1', bg: '#FFFFFF', fgName: 'Primary', bgName: 'White', ratio: '__TODO', rating: '__TODO', border: true, largeText: false },
      { fg: '#FFFFFF', bg: '#111827', fgName: 'White', bgName: 'Ink', ratio: '__TODO', rating: '__TODO', border: false, largeText: false }
    ],
    cssVariables: [
      { section: 'Colors', vars: [
        { prop: '--color-primary', value: '#6366F1', comment: 'Primary brand color' },
        { prop: '--foreground', value: '#111827', comment: 'Primary text' }
      ]},
      { section: 'Typography', vars: [
        { prop: '--font-display', value: "'Inter', sans-serif", comment: 'Display font' },
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
          { class: 'btn-primary', sizes: ['sm', 'md', 'lg'], labels: ['Small', '__TODO: Medium CTA', '__TODO: Large CTA'] }
        ]}
      ],
      cards: [
        { title: '__TODO: Card Title', description: '__TODO: Card description text', tag: '__TODO' }
      ],
      stats: [
        { value: '__TODO', label: '__TODO: Stat description' }
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
