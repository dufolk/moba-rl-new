// Zero-dependency static server for the game client + replay listing.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || process.argv[2] || 8080);
const REPLAY_DIRS = [path.join(ROOT, 'replays'), path.join(ROOT, 'runs')];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ico': 'image/x-icon',
};

function listReplays() {
  const out = [];
  const walk = (dir, depth) => {
    if (!fs.existsSync(dir) || depth > 4) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p, depth + 1);
      else if (ent.name.endsWith('.json')) {
        const st = fs.statSync(p);
        out.push({ path: path.relative(ROOT, p).replaceAll('\\', '/'), size: st.size, mtime: st.mtimeMs });
      }
    }
  };
  for (const d of REPLAY_DIRS) walk(d, 0);
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, 200);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (p === '/api/replays') {
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    res.end(JSON.stringify(listReplays()));
    return;
  }
  if (p === '/') p = '/web/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, () => console.log(`MOBA client: http://localhost:${PORT}`));
