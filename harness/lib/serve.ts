import { createServer, type Server } from 'node:http';
import { statSync, createReadStream } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { shippedSource } from './strip.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wgsl': 'text/plain; charset=utf-8',
  '.css': 'text/css',
  '.png': 'image/png',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
};

// One byte range of a Range header, as [first, last] inclusive and clamped to
// the file; 'unsatisfiable' when it starts past the end; null when the header
// is absent or asks for something else (several ranges, another unit), in
// which case the whole file is sent, as servers commonly do.
export function parseRange(header: string | undefined, size: number): [number, number] | 'unsatisfiable' | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    const n = Math.min(Number(m[2]), size);
    return n === 0 ? 'unsatisfiable' : [size - n, size - 1];
  }
  const first = Number(m[1]);
  if (first >= size) return 'unsatisfiable';
  const last = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  return last < first ? 'unsatisfiable' : [first, last];
}

// Static file server for the repository root. No caching, so every bench
// iteration pays the full load cost a first-time visitor would. A .ts file
// is sent as the JavaScript left after stripping its types. Other files
// answer single-range Range requests with 206, as a static host would.
// aliases: URL prefix -> directory served there instead of under root (the
// harness's own pages when root is the built site).
export function serve(root: string, port = 0, host = '127.0.0.1', aliases: Record<string, string> = {}): Promise<Server> {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const alias = Object.keys(aliases).find((p) => path.startsWith(p));
    let file = alias ? join(aliases[alias], path.slice(alias.length)) : join(root, path);
    const headers: Record<string, string | number> = {
      'cache-control': 'no-store',
      // Cross-origin isolation: performance.now() gets 5 us resolution
      // instead of 100 us, which sub-millisecond frame times need.
      // Remote data must then be fetched with CORS.
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
    };
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      headers['content-type'] = TYPES[extname(file)] ?? 'application/octet-stream';
      if (file.endsWith('.ts')) {
        const body = shippedSource(file);
        res.writeHead(200, { ...headers, 'content-length': body.length }).end(body);
        return;
      }
      const size = statSync(file).size;
      headers['accept-ranges'] = 'bytes';
      const range = parseRange(req.headers.range, size);
      if (range === 'unsatisfiable') {
        res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` }).end();
        return;
      }
      if (range) {
        const [first, last] = range;
        res.writeHead(206, { ...headers, 'content-length': last - first + 1, 'content-range': `bytes ${first}-${last}/${size}` });
        createReadStream(file, { start: first, end: last }).pipe(res);
        return;
      }
      res.writeHead(200, { ...headers, 'content-length': size });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
