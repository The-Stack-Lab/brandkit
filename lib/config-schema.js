/**
 * Starter config template with __TODO markers for AI agents.
 * Extractable fields (colors, fonts, spacing, logos) are populated by generate.
 * Manual fields are marked with __TODO.
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
      brand: { label: 'Brand', items: [] },
      neutrals: { label: 'Neutrals', items: [] },
      semantic: { label: 'Semantic', items: [] }
    },
    gradients: [],
    gradientUsage: { do: [], dont: [] },
    sections: {
      gradients: '__TODO: Describe the gradient system.',
      gradientTextDemo: '__TODO: A headline to demo gradient text.',
      logos: 'Download logo files for use across web, social, and print materials. Select format and size, then download.',
      components: '__TODO: Describe the component patterns.',
      spacing: '__TODO: Describe the spacing scale.',
      variables: '__TODO: Describe the CSS variable system.'
    },
    hierarchy: [],
    logos: [],
    logoSizes: [
      { label: 'Original', width: null },
      { label: '800px', width: 800 },
      { label: '400px', width: 400 },
      { label: '200px', width: 200 }
    ],
    typography: [],
    voice: {
      description: '__TODO: Describe the brand voice.',
      do: ['__TODO: Example of good copy'],
      dont: ['__TODO: Example of bad copy']
    },
    accessibility: [],
    cssVariables: [],
    spacing: [
      { px: 4, token: 'space-1' }, { px: 8, token: 'space-2' },
      { px: 12, token: 'space-3' }, { px: 16, token: 'space-4' },
      { px: 24, token: 'space-6' }, { px: 32, token: 'space-8' },
      { px: 48, token: 'space-12' }, { px: 64, token: 'space-16' },
      { px: 96, token: 'space-24' }
    ],
    components: { buttons: [], cards: [], stats: [] }
  };
}

/**
 * Deep merge: target values win over source for manually-curated fields.
 * Source (extracted) overwrites target for extractable fields.
 */
function mergeConfigs(existing, extracted) {
  var result = JSON.parse(JSON.stringify(existing));

  // Extractable fields: overwrite from extracted
  var extractable = ['colors', 'fonts', 'theme', 'spacing', 'logos', 'logoSizes'];
  for (var i = 0; i < extractable.length; i++) {
    var key = extractable[i];
    if (extracted[key] !== undefined) {
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
