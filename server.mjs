import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const DEFAULT_HOST = process.env.HOST || '127.0.0.1';
const DEFAULT_PORT = Number(process.env.PORT ?? 8000);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(body);
}

async function handleStatic(request, response, url, root) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { sendJson(response, 400, { error: 'Invalid URL path.' }); return; }
  if (pathname === '/') pathname = '/index.html';
  const filePath = resolve(root, `.${pathname}`);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    sendJson(response, 403, { error: 'Forbidden.' });
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) { sendJson(response, 404, { error: 'Not found.' }); return; }
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://free.rpc.fastnear.com https://mainnet.neardata.xyz https://*.mainnet.neardata.xyz https://api.coingecko.com https://coins.llama.fi https://api.llama.fi https://stablecoins.llama.fi; base-uri 'self'; frame-ancestors 'none'",
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') { sendJson(response, 404, { error: 'Not found.' }); return; }
    sendJson(response, 500, { error: 'Local file could not be served.' });
  }
}

export function createAppServer({ root = ROOT, host = DEFAULT_HOST, port = DEFAULT_PORT } = {}) {
  if (!LOOPBACK_HOSTS.has(host)) throw new Error('NEAR SIGNAL server must bind to loopback only; public deployment is not implemented.');
  const server = createHttpServer(async (request, response) => {
    let url;
    try { url = new URL(request.url || '/', `http://${host}:${port}`); }
    catch { sendJson(response, 400, { error: 'Invalid request URL.' }); return; }
    if (url.pathname.startsWith('/api/')) { sendJson(response, 404, { error: 'No API routes are configured.' }); return; }
    if (request.method !== 'GET' && request.method !== 'HEAD') { sendJson(response, 405, { error: 'Method not allowed.' }); return; }
    await handleStatic(request, response, url, root);
  });
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`NEAR SIGNAL local server: http://${host}:${actualPort}`);
    console.log('Live sources are queried directly from the browser; no provider key is stored or proxied.');
  });
  return server;
}

const isDirectRun = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectRun) createAppServer();
