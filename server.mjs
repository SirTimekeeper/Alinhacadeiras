import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve files from the directory containing this module instead of the
// process working directory. fileURLToPath also correctly handles escaped
// characters (such as spaces) and Windows paths in import.meta.url.
const root = fileURLToPath(new URL('.', import.meta.url));
const indexFile = join(root, 'index.html');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('Pedido inválido');
    return;
  }

  const requestedFile = resolve(root, `.${pathname}`);
  const staysInsideRoot = !relative(root, requestedFile).startsWith('..');
  let file = pathname === '/' ? indexFile : requestedFile;

  try {
    if (!staysInsideRoot || !statSync(file).isFile()) file = indexFile;
  } catch {
    // Client-side routes are served by the application entry point.
    file = indexFile;
  }

  response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(file).on('error', () => {
    if (!response.headersSent) response.writeHead(500);
    response.end('Não foi possível carregar a aplicação');
  }).pipe(response);
}).listen(port, '0.0.0.0', () => console.log(`Alinha disponível em http://localhost:${port}`));
