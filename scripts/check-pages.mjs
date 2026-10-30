import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../artifacts/acoustic-maze/dist/public/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const html = await readFile(path.join(root, 'index.html'), 'utf8');
assert.ok(html.includes('name="viewport"'), 'Mobile viewport is missing');
assert.ok(!/\.tsx?["']/i.test(html), 'Publish the built output, not raw TypeScript');
assert.ok(!/http:\/\//i.test(html), 'Use HTTPS for external resources');
await stat(path.join(root, '.nojekyll'));

async function filesIn(dir) {
  const files = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(files.map(f => f.isDirectory() ? filesIn(path.join(dir, f.name)) : path.join(dir, f.name)))).flat();
}
const files = await filesIn(root);
let references = 0;
for (const file of files) {
  const ext = path.extname(file);
  if (!['.html', '.css', '.js'].includes(ext)) continue;
  const text = await readFile(file, 'utf8');
  const matches = ext === '.html'
    ? [...text.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map(m => m[1])
    : ext === '.css'
      ? [...text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map(m => m[1])
      : [...text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)]
          .map(m => m[1])
          // Three.js also embeds shader text containing the word "from".
          .filter(ref => /^(?:\.{1,2}\/|\/|https?:\/\/)/.test(ref));
  for (const ref of matches) {
    if (/^(https:|data:|#)/.test(ref)) continue;
    // A fragment can also appear percent-encoded inside an embedded SVG.
    if (decodeURIComponent(ref).startsWith('#')) continue;
    assert.ok(!ref.startsWith('/') && !ref.startsWith('http:'), `Non-relative reference in ${file}: ${ref}`);
    const target = path.resolve(path.dirname(file), decodeURIComponent(ref.split(/[?#]/)[0]));
    assert.ok(target.startsWith(root), `Asset escapes output directory: ${ref}`);
    assert.ok((await stat(target)).isFile(), `Missing built asset: ${ref}`);
    references++;
  }
}

// No SPA rewrite: a missing asset must really fail, just as on GitHub Pages.
const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.startsWith('/Unseen-Maze/')) pathname = pathname.slice('/Unseen-Maze'.length);
    const file = path.resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
    if (!file.startsWith(root)) throw new Error('Outside output directory');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const prefix of ['/', '/Unseen-Maze/']) {
    const entry = await fetch(`${origin}${prefix}`);
    assert.equal(entry.status, 200);
    assert.ok(entry.headers.get('content-type').includes('text/html'));
    for (const file of files) {
      const response = await fetch(`${origin}${prefix}${path.relative(root, file).split(path.sep).join('/')}`);
      assert.equal(response.status, 200, `Missing asset under ${prefix}: ${file}`);
      const expected = types[path.extname(file)];
      if (expected) assert.ok(response.headers.get('content-type').includes(expected), `Incorrect MIME type: ${file}`);
      await response.arrayBuffer();
    }
    assert.equal((await fetch(`${origin}${prefix}missing.js`)).status, 404);
  }
  console.log(`Pages checks passed: ${files.length} files, ${references} relative references, root and /Unseen-Maze/ mounts, valid MIME types.`);
} finally {
  await new Promise(resolve => server.close(resolve));
}
