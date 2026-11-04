#!/usr/bin/env node
// Minimal static file server for the public/ folder (no dependencies).
// Usage: npm run serve            -> http://localhost:4173
//        PORT=8080 npm run serve

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT) || 4173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
      if (!file.startsWith(ROOT)) throw Object.assign(new Error('forbidden'), { code: 'EACCES' });
      if ((await fs.stat(file).catch(() => null))?.isDirectory()) file = path.join(file, 'index.html');
      const body = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch (err) {
      res.writeHead(err.code === 'EACCES' ? 403 : 404, { 'Content-Type': 'text/plain' });
      res.end(err.code === 'EACCES' ? 'Forbidden' : 'Not found');
    }
  })
  .listen(PORT, () => console.log(`Manga rare tracker running at http://localhost:${PORT}`));
