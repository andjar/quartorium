'use strict';
// QMD <-> editor document.
//
// parseQmd(text)  -> { doc, blocks, meta, lead, eol }
// serializeQmd(doc, contexts) -> text
//
// The guarantee: a block whose content was not changed in the editor is
// written back with its original bytes. Only edited prose is regenerated (by
// Pandoc). Locked blocks are restored from the server's copy by key, so the
// browser can neither alter nor inject code.

const yaml = require('js-yaml');
const { splitQmd, joinBlocks, hash } = require('./blocks');
const { injectMeta } = require('./meta');
const { protect, collectDefLabels } = require('./protect');
const pandoc = require('./pandoc');
const { blocksToPm, pmBlocksToAst, blocksToPlain, stringify, textToAst, Unsupported } = require('./pm');
const { reflow } = require('./reflow');

class LockedBlocksChanged extends Error {
  constructor() { super('Locked blocks (code, tables, equations, ...) cannot be removed, added or reordered in the browser.'); this.status = 409; }
}

// Parse results are cached by protected source: identical text parses identically.
const astCache = new Map();
const CACHE_MAX = 20000;

async function parseProse(sources) {
  const missing = [...new Set(sources.filter((s) => !astCache.has(s)))];
  if (missing.length) {
    const asts = await pandoc.parseSegments(missing);
    missing.forEach((s, i) => astCache.set(s, asts[i]));
    if (astCache.size > CACHE_MAX) {
      for (const k of [...astCache.keys()].slice(0, astCache.size - CACHE_MAX)) astCache.delete(k);
    }
  }
  return sources.map((s) => astCache.get(s));
}

function yamlSummary(source) {
  try {
    const body = source.replace(/^---\s*\n/, '').replace(/\n(---|\.\.\.)\s*$/, '');
    const data = yaml.load(body) || {};
    const asText = (v) => (v == null ? null : typeof v === 'string' ? v : v.name ? (typeof v.name === 'string' ? v.name : v.name.literal || [v.name.given, v.name.family].filter(Boolean).join(' ')) : String(v));
    let authors = data.author || data.authors || [];
    if (!Array.isArray(authors)) authors = [authors];
    return {
      title: asText(data.title),
      subtitle: asText(data.subtitle),
      date: data.date instanceof Date ? data.date.toISOString().slice(0, 10) : data.date ? String(data.date) : null,
      authors: authors.map(asText).filter(Boolean),
    };
  } catch {
    return { title: null, subtitle: null, date: null, authors: [] };
  }
}

function lockedNode(b) {
  const attrs = { key: b.key, kind: b.kind, source: b.source };
  if (b.label) attrs.label = b.label;
  if (b.lang) attrs.lang = b.lang;
  if (b.kind === 'yaml') attrs.meta = yamlSummary(b.source);
  return { type: 'locked', attrs };
}

/** Canonical form of a run of prose nodes, used to detect "unchanged". */
function canon(nodes) {
  return JSON.stringify(pmBlocksToAst(nodes));
}

async function parseQmd(text) {
  const split = splitQmd(text);
  const defLabels = collectDefLabels(split.blocks.filter((b) => b.kind === 'def').map((b) => b.source));
  const prose = split.blocks.filter((b) => !b.locked);
  const asts = await parseProse(prose.map((b) => protect(b.source, defLabels)));
  prose.forEach((b, i) => {
    try {
      b.nodes = blocksToPm(asts[i]);
      if (b.nodes.length === 0) throw new Unsupported('empty');
      b.canon = canon(b.nodes);
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      b.kind = 'other';
      b.locked = true;
      delete b.nodes;
    }
  });
  const content = [];
  for (const b of split.blocks) {
    if (b.locked) content.push(lockedNode(b));
    else for (const n of b.nodes) content.push({ ...n, attrs: { ...(n.attrs || {}), seg: b.key } });
  }
  if (content.length === 0) content.push({ type: 'paragraph' });
  return { ...split, doc: { type: 'doc', content } };
}

function isEmptyParagraph(n) {
  return n.type === 'paragraph' && !(n.content || []).some((c) => c.type !== 'text' || c.text.trim() !== '');
}

function walkOpaque(nodes, fn) {
  for (const n of nodes || []) {
    if (n.type === 'opaque') fn(n);
    if (n.content) walkOpaque(n.content, fn);
  }
}

const CITE_MODES = new Set(['NormalCitation', 'AuthorInText', 'SuppressAuthor']);
const plainInlines = (list) => textToAst(stringify(Array.isArray(list) ? list : []).slice(0, 200));

/**
 * A citation inserted in the browser. Accepted only when every key is known
 * (bibliography entry or label in the paper); the AST is rebuilt from scratch.
 */
function cleanCite(ast, citeIds) {
  const list = ast && ast.t === 'Cite' && Array.isArray(ast.c) && Array.isArray(ast.c[0]) ? ast.c[0] : null;
  if (!citeIds || !list || list.length === 0 || list.length > 20) return null;
  const citations = [];
  for (const c of list) {
    const id = String(c?.citationId || '');
    if (!citeIds.has(id)) return null;
    citations.push({
      citationId: id,
      citationPrefix: plainInlines(c.citationPrefix),
      citationSuffix: plainInlines(c.citationSuffix),
      citationMode: { t: CITE_MODES.has(c.citationMode?.t) ? c.citationMode.t : 'NormalCitation' },
      citationNoteNum: 0,
      citationHash: 0,
    });
  }
  return { t: 'Cite', c: [citations, [{ t: 'Str', c: citations.map((c) => '@' + c.citationId).join('; ') }]] };
}

/** Replace inline chips that did not exist in any context document with plain text. */
function sanitizeOpaque(nodes, allowed, citeIds) {
  return (nodes || []).map((n) => {
    if (n.type === 'opaque') {
      if (n.attrs && n.attrs.ast && allowed.has(JSON.stringify(n.attrs.ast))) return n;
      const cite = cleanCite(n.attrs?.ast, citeIds);
      if (cite) return { ...n, attrs: { ...n.attrs, ast: cite } };
      return { type: 'text', text: String(n.attrs?.label || ''), marks: n.marks };
    }
    return n.content ? { ...n, content: sanitizeOpaque(n.content, allowed, citeIds) } : n;
  }).filter((n) => n.type !== 'text' || n.text !== '');
}

/**
 * Serialize an editor document back to .qmd text.
 * @param {object} doc ProseMirror JSON from the browser
 * @param {Array} contexts parse results the document may derive from; contexts[0]
 *   is the reference (its lead text, line endings and locked skeleton apply)
 * @param {object} opts { meta, enforceLocked = true, citeIds: Set of keys/labels new citations may use }
 */
async function serializeQmd(doc, contexts, opts = {}) {
  if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content)) throw Object.assign(new Error('Invalid document'), { status: 400 });
  const ref = contexts[0];
  const registry = new Map();
  const allowed = new Set();
  for (const ctx of contexts) {
    for (const b of ctx.blocks) if (!registry.has(b.key)) registry.set(b.key, b);
    walkOpaque(ctx.doc.content, (n) => allowed.add(JSON.stringify(n.attrs.ast)));
  }

  // Group top-level nodes into runs: one per locked block, one per original
  // prose block (consecutive nodes sharing a `seg`), one per new node.
  const runs = [];
  for (const node of doc.content) {
    if (!node || typeof node.type !== 'string') continue;
    if (node.type === 'locked') { runs.push({ locked: true, key: node.attrs?.key }); continue; }
    if (isEmptyParagraph(node)) continue;
    const seg = node.attrs?.seg || null;
    const last = runs[runs.length - 1];
    if (seg && last && !last.locked && last.seg === seg) last.nodes.push(node);
    else runs.push({ locked: false, seg, nodes: [node] });
  }

  const lockedKeys = runs.filter((r) => r.locked).map((r) => r.key);
  const expected = ref.blocks.filter((b) => b.locked).map((b) => b.key);
  if (opts.enforceLocked !== false && JSON.stringify(lockedKeys) !== JSON.stringify(expected)) throw new LockedBlocksChanged();

  const items = [];
  const toWrite = [];
  for (const run of runs) {
    if (run.locked) {
      const b = registry.get(run.key);
      if (b && b.locked) items.push({ source: b.source, sep: b.sep, next: b.next, key: b.key });
      continue;
    }
    const nodes = sanitizeOpaque(run.nodes, allowed, opts.citeIds);
    const orig = run.seg ? registry.get(run.seg) : null;
    if (orig && !orig.locked && orig.canon === canon(nodes)) {
      items.push({ source: orig.source, sep: orig.sep, next: orig.next, key: orig.key });
    } else {
      toWrite.push(pmBlocksToAst(nodes));
      const singlePara = nodes.length === 1 && nodes[0].type === 'paragraph' && orig && !orig.locked && orig.nodes.length === 1 && orig.nodes[0].type === 'paragraph';
      items.push({ pending: toWrite.length - 1, sep: orig?.sep, next: orig?.next, reflowFrom: singlePara ? orig.source : null });
    }
  }
  const written = await pandoc.writeSegments(toWrite);
  const finalItems = [];
  for (const it of items) {
    if (it.pending === undefined) { finalItems.push(it); continue; }
    let source = written[it.pending];
    if (source.trim() === '') continue;
    if (it.reflowFrom) source = reflow(it.reflowFrom, source);
    finalItems.push({ source, sep: it.sep, next: it.next, key: hash(source) });
  }
  let body = joinBlocks(ref.lead, finalItems);
  body = injectMeta(body, opts.meta === undefined ? ref.meta : opts.meta);
  return ref.eol === '\r\n' ? body.replace(/\n/g, '\r\n') : body;
}

/** Text with a different comment block (or none). Prose is untouched. */
function withMeta(text, meta) {
  const split = splitQmd(text);
  const body = split.lead + split.blocks.map((b) => b.source + b.sep).join('');
  const out = injectMeta(body, meta);
  return split.eol === '\r\n' ? out.replace(/\n/g, '\r\n') : out;
}

const LOCKED_LABELS = {
  yaml: 'Title and settings', chunk: 'Code chunk', code: 'Code block', raw: 'Raw block', div: 'Section block',
  comment: 'Hidden note', math: 'Equation', shortcode: 'Shortcode', table: 'Table', def: 'Footnote / link definition',
  html: 'HTML block', other: 'Block',
};

/**
 * How blocks from splitQmd look in the editor: [{ key, kind, locked, text, nodes }].
 * `nodes` (ProseMirror JSON) lets the browser show differences with chips as
 * readable labels; `text` is used for commit messages.
 */
async function blockViews(blocks) {
  const prose = blocks.filter((b) => !b.locked);
  const asts = await parseProse(prose.map((b) => protect(b.source)));
  const byKey = new Map();
  prose.forEach((b, i) => {
    let nodes = null;
    try { nodes = blocksToPm(asts[i]); } catch { nodes = null; }
    byKey.set(b.key, { text: blocksToPlain(asts[i]), nodes });
  });
  return blocks.map((b) => (b.locked
    ? { key: b.key, kind: b.kind, locked: true, text: `[${LOCKED_LABELS[b.kind] || 'Block'}${b.label ? ': ' + b.label : ''}]`, nodes: null }
    : { key: b.key, kind: b.kind, locked: false, ...byKey.get(b.key) }));
}

module.exports = { parseQmd, serializeQmd, withMeta, blockViews, LockedBlocksChanged, yamlSummary };
