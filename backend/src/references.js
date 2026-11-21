'use strict';
// What can be cited: the paper's bibliography (read from the round's branch,
// never written) and the labels of its figures, tables, equations and sections.

const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');
const pandoc = require('./qmd/pandoc');
const { splitQmd } = require('./qmd/blocks');

const XREF_PREFIXES = ['fig', 'tbl', 'eq', 'sec', 'lst', 'thm', 'lem', 'cor', 'prp', 'cnj', 'def', 'exm', 'exr', 'rem', 'sol'];
const XREF_RE = new RegExp(`^(${XREF_PREFIXES.join('|')})-[\\w-]+$`);
const KIND_NAME = { fig: 'Figure', tbl: 'Table', eq: 'Equation', sec: 'Section', lst: 'Listing', thm: 'Theorem', lem: 'Lemma', cor: 'Corollary', prp: 'Proposition', cnj: 'Conjecture', def: 'Definition', exm: 'Example', exr: 'Exercise', rem: 'Remark', sol: 'Solution' };

const isXref = (id) => XREF_RE.test(id);
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');

function yamlOf(text) {
  const y = splitQmd(text).blocks.find((b) => b.kind === 'yaml');
  if (!y) return {};
  try { return yaml.load(y.source.replace(/^---\s*\n/, '').replace(/\n(---|\.\.\.)\s*$/, '')) || {}; } catch { return {}; }
}

const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string');

/** Bibliography files for a document: its own YAML, else the nearest _quarto.yml. */
async function bibliographyPaths(repo, ref, docPath, text) {
  const docDir = path.posix.dirname(docPath);
  const own = asList(yamlOf(text).bibliography);
  if (own.length) return own.map((p) => path.posix.normalize(path.posix.join(docDir, p)));
  for (let dir = docDir; ; dir = path.posix.dirname(dir)) {
    for (const name of ['_quarto.yml', '_quarto.yaml']) {
      const file = path.posix.join(dir === '.' ? '' : dir, name);
      const content = await repo.readFile(ref, file);
      if (content != null) {
        try {
          const bib = asList(yaml.load(content)?.bibliography);
          if (bib.length) return bib.map((p) => path.posix.normalize(path.posix.join(dir, p)));
        } catch { /* ignore broken project files */ }
      }
    }
    if (dir === '.' || dir === '/' || dir === '') break;
  }
  return [];
}

const READERS = { '.bib': 'biblatex', '.bibtex': 'bibtex', '.json': 'csljson' };
const cslCache = new Map();

async function toCsl(name, content) {
  const reader = READERS[path.extname(name).toLowerCase()];
  if (!reader) return [];
  const key = sha(reader + content);
  if (!cslCache.has(key)) {
    let items = [];
    try { items = reader === 'csljson' ? JSON.parse(content) : JSON.parse(await pandoc.run(['-f', reader, '-t', 'csljson'], content)); } catch { items = []; }
    cslCache.set(key, Array.isArray(items) ? items : []);
  }
  return cslCache.get(key);
}

function personName(p) {
  return p.family ? p.family : p.literal || p.given || '';
}

/** Short author-date label, e.g. "Smith et al. 2020". */
function shortLabel(item) {
  const people = item.author || item.editor || [];
  const names = people.map(personName).filter(Boolean);
  let who = names[0] || item.title || item.id;
  if (names.length === 2) who = `${names[0]} & ${names[1]}`;
  if (names.length > 2) who = `${names[0]} et al.`;
  return [who, year(item)].filter(Boolean).join(' ');
}

function year(item) {
  const parts = item.issued?.['date-parts'];
  if (parts && parts[0] && parts[0][0]) return String(parts[0][0]);
  return item.issued?.literal || '';
}

function fullReference(item) {
  const people = (item.author || item.editor || []).map((p) => [p.family, p.given].filter(Boolean).join(', ') || p.literal).filter(Boolean);
  const where = item['container-title'] || item.publisher || '';
  return [people.join('; '), year(item) && `(${year(item)})`, item.title && `${item.title}.`, where && `${where}.`, item.DOI && `doi:${item.DOI}`].filter(Boolean).join(' ');
}

async function loadBibliography(repo, ref, docPath, text) {
  const files = await bibliographyPaths(repo, ref, docPath, text);
  const entries = [];
  const missing = [];
  for (const f of files) {
    const content = await repo.readFile(ref, f);
    if (content == null) { missing.push(f); continue; }
    for (const item of await toCsl(f, content)) {
      if (!item || !item.id) continue;
      entries.push({ id: String(item.id), label: shortLabel(item), full: fullReference(item), title: item.title || '', year: year(item) });
    }
  }
  entries.sort((a, b) => a.label.localeCompare(b.label));
  return { files, missing, entries };
}

/** Labels defined in the document, with a short description. */
function documentLabels(text) {
  const labels = new Map();
  const add = (id, description) => {
    if (!isXref(id)) return;
    const prev = labels.get(id);
    if (!prev || (!prev.description && description)) labels.set(id, { id, kind: KIND_NAME[id.split('-')[0]], description: description || '' });
  };
  for (const b of splitQmd(text).blocks) {
    if (b.kind === 'chunk') {
      const cap = b.source.match(/^\s*#\|\s*(?:fig|tbl)-cap:\s*["']?(.*?)["']?\s*$/m);
      if (b.label) add(b.label, cap ? cap[1] : '');
      continue;
    }
    if (b.kind === 'yaml' || b.kind === 'code') continue;
    for (const m of b.source.matchAll(/\{#([\w-]+)[^}]*\}/g)) {
      let description = '';
      if (b.kind === 'table') description = (b.source.match(/^ {0,3}(?:Table)?:\s*(.*?)\s*\{#/m) || [])[1] || '';
      else if (/^#{1,6}\s/.test(b.source)) description = b.source.replace(/^#{1,6}\s+/, '').replace(/\s*\{[^}]*\}\s*$/, '');
      else if (b.kind === 'math') description = b.source.replace(/\{#[^}]*\}/, '').replace(/\$\$/g, '').trim().slice(0, 60);
      else {
        const img = b.source.match(/!\[([^\]]*)\]\([^)]*\)\{#/);
        if (img) description = img[1];
      }
      add(m[1], description);
    }
  }
  return [...labels.values()];
}

module.exports = { loadBibliography, documentLabels, isXref, shortLabel, KIND_NAME };
