var fs = require('fs');
var path = require('path');

/**
 * Vite plugin for @stacklist-app/brandkit.
 * Serves brand guide files at /brand during dev.
 * Copies built files to output on build.
 *
 * Usage in vite.config.js:
 *   import brandkit from '@stacklist-app/brandkit/integrations/vite'
 *   export default defineConfig({ plugins: [brandkit()] })
 */
module.exports = function brandkitVite(options) {
  var brandDir = (options && options.dir) || 'brand';
  var route = (options && options.route) || '/brand';

  return {
    name: '@stacklist-app/brandkit',

    configureServer: function (server) {
      var dir = path.resolve(brandDir);
      if (!fs.existsSync(dir)) return;

      server.middlewares.use(route, function (req, res, next) {
        var filePath = path.join(dir, req.url === '/' ? '/index.html' : req.url);

        if (!filePath.startsWith(dir)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        if (!fs.existsSync(filePath)) {
          next();
          return;
        }

        var ext = path.extname(filePath).toLowerCase();
        var mimeTypes = {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'application/javascript',
          '.json': 'application/json',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.jpg': 'image/jpeg'
        };

        res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
        fs.createReadStream(filePath).pipe(res);
      });
    },

    closeBundle: function () {
      var srcDir = path.resolve(brandDir);
      if (!fs.existsSync(srcDir)) return;

      var outDir = path.resolve('dist', route.replace(/^\//, ''));
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      // Copy assets (config.json, logos, anything in brand/) to the output.
      copyDir(srcDir, outDir);

      // Then produce a real production build into the output: theme baked into
      // styles.css, engine.js copied, and the agent-native exports written +
      // embedded in index.html. This makes the deployed /brand carry brand.json,
      // tokens.json, brand.md and the inline <script id="brandkit-brand"> — so an
      // agent pointed at the URL gets structured brand data without a manual
      // `brandkit build` step. Falls back to the raw copy if config is missing.
      var configPath = path.join(srcDir, 'config.json');
      if (fs.existsSync(configPath)) {
        try {
          var config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          var template = require('../lib/template');
          var resolve = require('../lib/resolve');
          template.build(resolve.getDistPath(), outDir, config);
        } catch (e) {
          // Leave the raw copy in place; don't fail the host build.
        }
      }
    }
  };
};

function copyDir(src, dest) {
  var entries = fs.readdirSync(src, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var srcPath = path.join(src, entries[i].name);
    var destPath = path.join(dest, entries[i].name);
    if (entries[i].isDirectory()) {
      if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
