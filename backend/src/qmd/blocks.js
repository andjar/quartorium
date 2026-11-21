'use strict';
// Splits a .qmd source into top-level blocks without losing a single byte.
//
// Every block keeps its exact source text and the exact separator that follows
// it, so `joinBlocks(splitQmd(text))` === text. Blocks that collaborators must
// not edit (YAML, code chunks, fenced divs, tables, display math, raw HTML, ...)
// are marked `locked`. Everything else is prose that the editor may change.
//
// Splitting does not need to match Pandoc's block structure exactly: a "text"
// block may hold several Pandoc blocks (e.g. a list followed by a paragraph).
// The granularity only decides how much gets re-written when something in the
// block is edited, never whether untouched text survives.

const crypto = require('crypto');
const { extractMeta } = require('./meta');

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

const isBlank = (l) => /^\s*$/.test(l);
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const DIV_OPEN = /^ {0,3}(:{3,})\s*[^\s:]/;
const DIV_CLOSE = /^ {0,3}:{3,}\s*$/;
const COMMENT_START = /^ {0,3}<!--/;
const MATH_START = /^ {0,3}\$\$/;
const SHORTCODE_LINE = /^\s*\{\{\{?<.*>\}?\}\}\s*$/;
const TABLE_LINE = /^ {0,3}(\||\+[-=])/;
const CAPTION_LINE = /^ {0,3}(Table)?:\s/;
const DEF_LINE = /^ {0,3}\[\^?[^\]\s][^\]]*\]:/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const LIST_START = /^ {0,3}([-*+]|\(?(\d+|[a-zA-Z]|#|@)[.)])\s/;
const HTML_BLOCK = /^ {0,3}<\/?(address|article|aside|audio|blockquote|br|canvas|center|details|div|dl|embed|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|iframe|img|main|math|nav|object|ol|p|pre|script|section|style|summary|svg|table|ul|video)(\s|>|\/|$)/i;

function fenceInfoKind(info) {
  const s = info.trim();
  if (/^\{=/.test(s)) return 'raw';
  if (/^\{\s*[a-zA-Z]/.test(s)) return 'chunk';
  return 'code';
}

function chunkLabel(lines) {
  const first = lines[0] || '';
  const m1 = first.match(/label\s*=\s*["']?([\w.-]+)/);
  if (m1) return m1[1];
  for (const l of lines.slice(1)) {
    const m = l.match(/^\s*#\|\s*label:\s*["']?([\w.-]+)/);
    if (m) return m[1];
  }
  const m2 = first.match(/\{\s*[a-zA-Z]\w*[\s,]+([a-zA-Z][\w.-]*)\s*[,}]/);
  if (m2 && !m2[1].includes('=')) return m2[1];
  return null;
}

function chunkLang(firstLine) {
  const m = firstLine.match(/\{\s*([a-zA-Z]\w*)/);
  return m ? m[1] : null;
}

/** Scan a fenced code block starting at line i. Returns the index of its last line. */
function scanFence(lines, i) {
  const m = lines[i].match(FENCE_OPEN);
  const ch = m[2][0];
  const len = m[2].length;
  const close = new RegExp(`^ {0,3}\\${ch}{${len},}\\s*$`);
  for (let j = i + 1; j < lines.length; j++) if (close.test(lines[j])) return j;
  return lines.length - 1; // unclosed: runs to the end, like Pandoc
}

/** Scan a fenced div (with nesting and code fences inside). */
function scanDiv(lines, i) {
  let depth = 0;
  for (let j = i; j < lines.length; j++) {
    const l = lines[j];
    if (j > i && FENCE_OPEN.test(l)) { j = scanFence(lines, j); continue; }
    if (DIV_OPEN.test(l)) depth++;
    else if (DIV_CLOSE.test(l)) { depth--; if (depth === 0) return j; }
  }
  return lines.length - 1;
}

function scanUntilBlank(lines, i) {
  let j = i;
  while (j + 1 < lines.length && !isBlank(lines[j + 1])) j++;
  return j;
}

function nextNonBlank(lines, j) {
  let k = j + 1;
  while (k < lines.length && isBlank(lines[k])) k++;
  return k < lines.length ? k : -1;
}

function scanText(lines, i) {
  const isList = LIST_START.test(lines[i]);
  let j = i;
  for (;;) {
    // Accumulate lines until a blank line or a fence that must stand alone.
    while (j + 1 < lines.length && !isBlank(lines[j + 1])) {
      const nl = lines[j + 1];
      if (FENCE_OPEN.test(nl) || DIV_OPEN.test(nl) || DIV_CLOSE.test(nl)) {
        if (!(isList && /^(\s{4,}|\t)/.test(nl))) return j;
      }
      j++;
    }
    if (!isList) return j;
    // Lists continue across blank lines when the next line is indented or is
    // another list item (loose lists).
    const k = nextNonBlank(lines, j);
    if (k === -1) return j;
    const nl = lines[k];
    if (/^(\s{2,}|\t)/.test(nl) || LIST_START.test(nl)) {
      j = k;
      if (/^(\s{2,}|\t)/.test(nl) && FENCE_OPEN.test(nl.trimStart())) {
        // A fence inside a list item (may contain blank lines): take it whole.
        const ind = nl.match(/^\s*/)[0];
        const ded = lines.slice(k).map((l) => (l.startsWith(ind) ? l.slice(ind.length) : l));
        j = k + scanFence(ded, 0);
      }
      continue;
    }
    return j;
  }
}

/** Find the extent and kind of the block starting at line i. */
function scanBlock(lines, i) {
  const l = lines[i];
  if (i === 0 && /^---\s*$/.test(l)) {
    for (let j = 1; j < lines.length; j++) {
      if (/^(---|\.\.\.)\s*$/.test(lines[j])) return { end: j, kind: 'yaml' };
    }
  }
  if (FENCE_OPEN.test(l)) {
    const info = l.match(FENCE_OPEN)[3];
    return { end: scanFence(lines, i), kind: fenceInfoKind(info) };
  }
  if (DIV_OPEN.test(l)) return { end: scanDiv(lines, i), kind: 'div' };
  if (COMMENT_START.test(l)) {
    for (let j = i; j < lines.length; j++) {
      const from = j === i ? l.indexOf('<!--') + 4 : 0;
      if (lines[j].indexOf('-->', from) !== -1) return { end: j, kind: 'comment' };
    }
    return { end: lines.length - 1, kind: 'comment' };
  }
  if (MATH_START.test(l)) {
    const rest = l.slice(l.indexOf('$$') + 2);
    if (rest.includes('$$')) return { end: i, kind: 'math' };
    for (let j = i + 1; j < lines.length; j++) if (lines[j].includes('$$')) return { end: j, kind: 'math' };
    return { end: lines.length - 1, kind: 'math' };
  }
  if (SHORTCODE_LINE.test(l)) return { end: i, kind: 'shortcode' };
  if (TABLE_LINE.test(l)) {
    let end = scanUntilBlank(lines, i);
    const k = nextNonBlank(lines, end);
    if (k !== -1 && k - end <= 2 && CAPTION_LINE.test(lines[k])) end = scanUntilBlank(lines, k);
    return { end, kind: 'table' };
  }
  if (DEF_LINE.test(l)) {
    let end = scanUntilBlank(lines, i);
    for (;;) {
      const k = nextNonBlank(lines, end);
      if (k === -1 || !/^(\s{4,}|\t)/.test(lines[k])) break;
      end = scanUntilBlank(lines, k);
    }
    return { end, kind: 'def' };
  }
  if (HTML_BLOCK.test(l)) return { end: scanUntilBlank(lines, i), kind: 'html' };
  if (HEADING.test(l)) return { end: i, kind: 'text' };
  return { end: scanText(lines, i), kind: 'text' };
}

const LOCKED_KINDS = new Set(['yaml', 'chunk', 'code', 'raw', 'div', 'comment', 'math', 'shortcode', 'table', 'def', 'html', 'other']);

/**
 * @returns {{eol: string, lead: string, blocks: Array<{key, kind, locked, source, sep, label?, lang?}>, meta: object|null}}
 */
function splitQmd(input) {
  const eol = input.includes('\r\n') ? '\r\n' : '\n';
  const { body, meta } = extractMeta(input.replace(/\r\n/g, '\n'));
  const lines = body.split('\n');
  const ranges = [];
  let i = 0;
  while (i < lines.length) {
    if (isBlank(lines[i])) { i++; continue; }
    const { end, kind } = scanBlock(lines, i);
    ranges.push({ start: i, end, kind });
    i = end + 1;
  }
  // A caption line right before a table belongs to the table.
  for (let r = ranges.length - 2; r >= 0; r--) {
    const a = ranges[r], b = ranges[r + 1];
    if (a.kind === 'text' && a.start === a.end && CAPTION_LINE.test(lines[a.start]) && b.kind === 'table' && b.start - a.end <= 2) {
      b.start = a.start;
      ranges.splice(r, 1);
    }
  }

  const lead = ranges.length ? lines.slice(0, ranges[0].start).map((l) => l + '\n').join('') : body;
  const blocks = ranges.map((r, idx) => {
    const src = lines.slice(r.start, r.end + 1);
    const source = src.join('\n');
    const isLast = idx === ranges.length - 1;
    const sep = isLast
      ? lines.slice(r.end + 1).map((l) => '\n' + l).join('')
      : lines.slice(r.end + 1, ranges[idx + 1].start).map((l) => '\n' + l).join('') + '\n';
    const block = { key: hash(source), kind: r.kind, locked: LOCKED_KINDS.has(r.kind), source, sep };
    if (r.kind === 'chunk') {
      block.lang = chunkLang(src[0]);
      block.label = chunkLabel(src);
    }
    return block;
  });
  blocks.forEach((b, idx) => { b.next = idx + 1 < blocks.length ? blocks[idx + 1].key : null; });
  return { eol, lead, blocks, meta };
}

/**
 * Join blocks back into text. Each item is { source, sep?, next?, key? }.
 * An item's original separator is reused when the block that originally
 * followed it still follows it; otherwise a blank line is guaranteed.
 */
function joinBlocks(lead, items) {
  let out = lead || '';
  items.forEach((it, idx) => {
    const isLast = idx === items.length - 1;
    const nextKey = isLast ? null : (items[idx + 1].key || hash(items[idx + 1].source));
    let sep = it.sep;
    if (isLast) {
      sep = it.next === null && sep !== undefined ? sep : '\n';
      if (!sep.endsWith('\n')) sep = sep.replace(/\s*$/, '') + '\n';
    } else if (sep === undefined || it.next !== nextKey) {
      sep = sep && /\n[ \t]*\n/.test(sep) ? sep : '\n\n';
    }
    out += it.source + sep;
  });
  return out;
}

module.exports = { splitQmd, joinBlocks, hash, LOCKED_KINDS };
