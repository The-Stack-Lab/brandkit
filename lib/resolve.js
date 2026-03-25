var path = require('path');

/**
 * Returns the absolute path to the dist/ directory containing
 * the universal static assets (engine.js, styles.css, index.html).
 */
function getDistPath() {
  return path.resolve(__dirname, '..', 'dist');
}

module.exports = { getDistPath: getDistPath };
