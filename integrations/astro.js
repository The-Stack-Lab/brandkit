var brandkitVite = require('./vite');

/**
 * Astro integration for @stacklab/brandkit.
 * Wraps the Vite plugin to serve brand guide at /brand.
 *
 * Usage in astro.config.mjs:
 *   import brandkit from '@stacklab/brandkit/integrations/astro'
 *   export default defineConfig({ integrations: [brandkit()] })
 */
module.exports = function brandkitAstro(options) {
  var vitePlugin = brandkitVite(options);

  return {
    name: '@stacklab/brandkit',
    hooks: {
      'astro:config:setup': function (params) {
        params.updateConfig({
          vite: {
            plugins: [vitePlugin]
          }
        });
      }
    }
  };
};
