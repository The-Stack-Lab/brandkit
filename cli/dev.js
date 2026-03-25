var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');

var MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

module.exports = function dev(args) {
  var dir = path.resolve(args[0] || '.');
  var port = 4800;

  // Parse --port flag
  for (var i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10) || 4800;
    }
  }

  // Validate directory has a config.json
  var configPath = path.join(dir, 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error('');
    console.error('  No config.json found in ' + dir);
    console.error('  Run: brandkit init ' + path.relative(process.cwd(), dir));
    console.error('');
    process.exit(1);
  }

  // SSE clients for live reload
  var sseClients = [];

  var server = http.createServer(function (req, res) {
    var parsed = url.parse(req.url);
    var pathname = parsed.pathname;

    // SSE endpoint for live reload
    if (pathname === '/__brandkit_reload') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write('data: connected\n\n');
      sseClients.push(res);
      req.on('close', function () {
        var idx = sseClients.indexOf(res);
        if (idx !== -1) sseClients.splice(idx, 1);
      });
      return;
    }

    // Serve static files
    if (pathname === '/') pathname = '/index.html';
    var filePath = path.join(dir, pathname);

    // Security: prevent path traversal
    if (!filePath.startsWith(dir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, function (err, data) {
      if (err) {
        res.writeHead(404);
        res.end('Not found: ' + pathname);
        return;
      }
      var ext = path.extname(filePath).toLowerCase();
      var mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });

      // Inject live reload script into HTML
      if (ext === '.html') {
        var html = data.toString();
        var reloadScript =
          '<script>' +
          '(function(){' +
          'var es=new EventSource("/__brandkit_reload");' +
          'es.onmessage=function(e){if(e.data==="reload")location.reload();};' +
          'es.onerror=function(){es.close();setTimeout(function(){location.reload();},2000);};' +
          '})();' +
          '</script>';
        html = html.replace('</body>', reloadScript + '</body>');
        res.end(html);
      } else {
        res.end(data);
      }
    });
  });

  server.listen(port, function () {
    console.log('');
    console.log('  brandkit dev');
    console.log('');
    console.log('  Serving brand guide at http://localhost:' + port + '/');
    console.log('  Watching ' + path.relative(process.cwd(), configPath) + ' for changes...');
    console.log('');
  });

  // Watch config.json for changes
  var debounce = null;
  fs.watch(dir, { recursive: true }, function (eventType, filename) {
    if (!filename) return;
    // Only reload on relevant file changes
    var ext = path.extname(filename).toLowerCase();
    if (['.json', '.html', '.css', '.js'].indexOf(ext) === -1) return;

    clearTimeout(debounce);
    debounce = setTimeout(function () {
      sseClients.forEach(function (client) {
        client.write('data: reload\n\n');
      });
    }, 100);
  });
};
