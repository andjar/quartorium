'use strict';
// Renders the whole document once with Quarto and cuts out the output of each
// locked block (plots, tables, equations, callouts, ...).
//
// Each locked block is wrapped in a fenced div with a known id before
// rendering, so its HTML can be found again reliably. Results are cached by a
// key built from everything that can change the outputs: the other files in
// the repository, the YAML header and the locked blocks themselves. Editing
// prose therefore never triggers a re-render.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const config = require('./config');
const { splitQmd } = require('./qmd/blocks');

const NOT_RENDERED = new Set(['yaml', 'comment', 'def']);

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function instrument(text) {
  const { blocks } = splitQmd(text);
  const parts = blocks.map((b, i) => {
    if (!b.locked || NOT_RENDERED.has(b.kind)) return b.source;
    const longest = Math.max(2, ...(b.source.match(/^ {0,3}(:{3,})/gm) || []).map((m) => m.trim().length));
    const fence = ':'.repeat(longest + 1);
    return `${fence} {#qtm-${i} .quartorium-block}\n${b.source}\n${fence}`;
  });
  return { text: parts.join('\n\n') + '\n', blocks };
}

/** End index (exclusive) of the <div> opened at `start`, or -1. */
function divEnd(html, start) {
  const re = /<div\b|<\/div>/g;
  re.lastIndex = html.indexOf('>', start) + 1;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/** Find the element with the given id and return its inner HTML (balanced on <div>). */
function extractDiv(html, id) {
  const start = html.search(new RegExp(`<div[^>]*\\bid="${id}"[^>]*>`));
  if (start === -1) return null;
  const end = divEnd(html, start);
  if (end === -1) return null;
  return html.slice(html.indexOf('>', start) + 1, end - '</div>'.length).trim();
}

/** Remove echoed source code; reviewers can still look at the code via "show code". */
function stripCode(html) {
  html = html.replace(/<details class="code-fold">[\s\S]*?<\/details>/g, '');
  const re = /<div class="(code-copy-outer-scaffold|sourceCode cell-code)[^"]*"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const end = divEnd(html, m.index);
    if (end === -1) break;
    html = html.slice(0, m.index) + html.slice(end);
    re.lastIndex = m.index;
  }
  return html;
}

function findFile(dir, name) {
  let best = null;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === '.quarto') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === name) {
        const t = fs.statSync(p).mtimeMs;
        if (!best || t > best.t) best = { p, t };
      }
    }
  })(dir);
  return best && best.p;
}

function runQuarto(args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(config.quarto, args, { cwd, env: { ...process.env, QUARTO_PRINT_STACK: '0' } });
    const timer = setTimeout(() => p.kill('SIGKILL'), config.renderTimeoutMs);
    let log = '';
    p.stdout.on('data', (d) => { log += d; });
    p.stderr.on('data', (d) => { log += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(new Error(`Could not start Quarto (${config.quarto}): ${e.message}`)); });
    p.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(log);
      else reject(new Error(signal === 'SIGKILL' ? 'Rendering took too long and was stopped.' : log.split('\n').slice(-30).join('\n') || `quarto exited with ${code}`));
    });
  });
}

class Renderer {
  constructor(cacheRoot) {
    this.cacheRoot = cacheRoot;
    this.running = new Map(); // key -> promise
    this.queue = Promise.resolve();
  }

  async keyFor(repo, ref, docPath, text) {
    const { blocks } = splitQmd(text);
    const locked = blocks.filter((b) => b.locked && b.kind !== 'comment').map((b) => b.source);
    const tree = await repo.treeKeyWithout(ref, docPath);
    return sha1([tree, docPath, ...locked].join('\0'));
  }

  dirFor(key) {
    return path.join(this.cacheRoot, key);
  }

  /** Cached result or null: { status: 'ok'|'error', outputs: {blockKey: html}, error } */
  get(key) {
    try { return JSON.parse(fs.readFileSync(path.join(this.dirFor(key), 'result.json'), 'utf8')); } catch { return null; }
  }

  status(key) {
    const r = this.get(key);
    if (r) return r.status;
    return this.running.has(key) ? 'rendering' : 'none';
  }

  /** Start (or join) a render. Resolves with the result. */
  ensure({ repo, ref, docPath, text, key, force = false }) {
    if (!force) {
      const cached = this.get(key);
      if (cached) return Promise.resolve(cached);
    }
    if (this.running.has(key)) return this.running.get(key);
    const job = this.queue.then(() => this.render({ repo, ref, docPath, text, key }));
    this.queue = job.catch(() => {});
    this.running.set(key, job);
    job.finally(() => this.running.delete(key));
    return job;
  }

  async render({ repo, ref, docPath, text, key }) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quartorium-render-'));
    const outDir = this.dirFor(key);
    let result;
    try {
      await repo.archiveTo(ref, tmp);
      const { text: instrumented, blocks } = instrument(text);
      const docFile = path.join(tmp, docPath);
      fs.mkdirSync(path.dirname(docFile), { recursive: true });
      fs.writeFileSync(docFile, instrumented);
      await runQuarto(['render', docPath, '--to', 'html', '--no-clean'], tmp);
      const htmlFile = findFile(tmp, path.basename(docPath).replace(/\.qmd$/i, '.html'));
      if (!htmlFile) throw new Error('Quarto finished but no HTML output was found.');
      const html = fs.readFileSync(htmlFile, 'utf8');
      const htmlDir = path.dirname(htmlFile);
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });
      const outputs = {};
      blocks.forEach((b, i) => {
        if (!b.locked || NOT_RENDERED.has(b.kind)) return;
        const inner = extractDiv(html, `qtm-${i}`);
        if (inner == null) return;
        outputs[b.key] = this.rewriteAssets(b.kind === 'chunk' ? stripCode(inner) : inner, htmlDir, tmp, outDir, key);
      });
      result = { status: 'ok', outputs, renderedAt: new Date().toISOString() };
    } catch (e) {
      result = { status: 'error', outputs: {}, error: String(e.message || e).slice(0, 5000), renderedAt: new Date().toISOString() };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result));
    return result;
  }

  /** Copy files referenced by src="..." into the cache and point the HTML at them. */
  rewriteAssets(html, htmlDir, root, outDir, key) {
    return html.replace(/\b(src|data)="([^"]+)"/g, (whole, attr, url) => {
      if (/^([a-z]+:|\/|#)/i.test(url)) return whole;
      const clean = decodeURI(url.split(/[?#]/)[0]);
      const abs = path.resolve(htmlDir, clean);
      if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs)) return whole;
      const rel = path.relative(root, abs);
      const dest = path.join(outDir, 'assets', rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(abs, dest);
      return `${attr}="/api/render/${key}/${rel.split(path.sep).map(encodeURIComponent).join('/')}"`;
    });
  }

  assetPath(key, rel) {
    if (!/^[0-9a-f]{40}$/.test(key)) return null;
    const base = path.join(this.dirFor(key), 'assets');
    const p = path.resolve(base, rel);
    return p.startsWith(base + path.sep) && fs.existsSync(p) ? p : null;
  }
}

module.exports = { Renderer, instrument, extractDiv, stripCode };
