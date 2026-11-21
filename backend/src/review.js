'use strict';
// Block-level change tracking for review rounds.
//
// Every reviewer edits a private copy. A "change" is a run of blocks that
// differs between the base the reviewer started from and their copy. Because
// untouched blocks keep their exact bytes, comparing blocks by content is
// exact. The lead accepts a change by splicing the reviewer's blocks into the
// round's text; copies are brought up to date with a three-way merge on
// blocks. When the same paragraph was changed on both sides, the round's text
// wins and the reviewer's version is kept as an "outdated" suggestion, so
// nothing is lost and nothing is silently overwritten.

const crypto = require('crypto');
const { diffArrays } = require('diff');
const { splitQmd, joinBlocks } = require('./qmd/blocks');
const { injectMeta, mergeMeta } = require('./qmd/meta');

const keysOf = (items) => items.map((b) => b.key);
const sameKeys = (a, b) => a.length === b.length && a.every((x, i) => x.key === b[i].key);

/** Prose-only view of a .qmd (comment block removed). */
function blocksOf(text) {
  const s = splitQmd(text || '');
  return { lead: s.lead, blocks: s.blocks, eol: s.eol };
}

function join(lead, items, eol = '\n') {
  const body = joinBlocks(lead, items);
  return eol === '\r\n' ? body.replace(/\n/g, '\r\n') : body;
}

/** Hunks turning a into b: [{ aStart, aEnd, bStart, bEnd }] */
function diffBlocks(a, b) {
  const hunks = [];
  let ia = 0, ib = 0, cur = null;
  for (const c of diffArrays(keysOf(a), keysOf(b))) {
    if (!c.added && !c.removed) {
      if (cur) { hunks.push(cur); cur = null; }
      ia += c.count; ib += c.count;
      continue;
    }
    if (!cur) cur = { aStart: ia, aEnd: ia, bStart: ib, bEnd: ib };
    if (c.removed) { ia += c.count; cur.aEnd = ia; }
    if (c.added) { ib += c.count; cur.bEnd = ib; }
  }
  if (cur) hunks.push(cur);
  // One change per paragraph when a run of paragraphs was edited one-for-one,
  // so each can be accepted or rejected on its own.
  return hunks.flatMap((h) => {
    const n = h.aEnd - h.aStart;
    if (n <= 1 || n !== h.bEnd - h.bStart) return [h];
    return Array.from({ length: n }, (_, k) => ({ aStart: h.aStart + k, aEnd: h.aStart + k + 1, bStart: h.bStart + k, bEnd: h.bStart + k + 1 }));
  });
}

/** Index where `needle` occurs in `hay` (by key), closest to `near`; -1 if absent. */
function locate(hay, needle, near) {
  let best = -1;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((n, k) => hay[i + k].key === n.key) && (best === -1 || Math.abs(i - near) < Math.abs(best - near))) best = i;
  }
  return best;
}

/**
 * Three-way merge of block lists. `o` is the common ancestor, `a` "mine",
 * `b` "theirs". Changes on one side are applied; overlapping changes that
 * differ resolve to `b` and are reported in `conflicts` as { old, new, theirs }
 * where `new` is a's version of the region and `theirs` is b's.
 */
function merge3(o, a, b, { keepBothInsertions = false } = {}) {
  const hunks = [
    ...diffBlocks(o, a).map((h) => ({ ...h, side: 'a', items: a })),
    ...diffBlocks(o, b).map((h) => ({ ...h, side: 'b', items: b })),
  ].sort((x, y) => x.aStart - y.aStart || (x.aEnd - x.aStart) - (y.aEnd - y.aStart));

  // Group hunks that touch the same region of o (adjacent edits do not conflict).
  const clusters = [];
  for (const h of hunks) {
    const c = clusters[clusters.length - 1];
    const overlaps = c && (h.aStart < c.end || (h.aStart === c.start && h.aStart === c.end && h.aStart === h.aEnd));
    if (overlaps) { c.hunks.push(h); c.end = Math.max(c.end, h.aEnd); }
    else clusters.push({ start: h.aStart, end: h.aEnd, hunks: [h] });
  }

  const version = (side, cl) => {
    const out = [];
    let i = cl.start;
    for (const h of cl.hunks.filter((x) => x.side === side)) {
      out.push(...o.slice(i, h.aStart), ...h.items.slice(h.bStart, h.bEnd));
      i = h.aEnd;
    }
    out.push(...o.slice(i, cl.end));
    return out;
  };

  const result = [];
  const conflicts = [];
  let i = 0;
  for (const cl of clusters) {
    result.push(...o.slice(i, cl.start));
    const sides = new Set(cl.hunks.map((h) => h.side));
    if (sides.size === 1) {
      result.push(...version([...sides][0], cl));
    } else {
      const va = version('a', cl), vb = version('b', cl);
      if (keepBothInsertions && cl.start === cl.end && !sameKeys(va, vb)) {
        // Both sides only added text at the same place: keep both.
        result.push(...vb, ...va);
      } else {
        result.push(...vb);
        if (!sameKeys(va, vb)) conflicts.push({ old: o.slice(cl.start, cl.end), new: va, theirs: vb });
      }
    }
    i = cl.end;
  }
  result.push(...o.slice(i));
  return { items: result, conflicts };
}

const changeId = (memberId, oldItems, newItems) =>
  crypto.createHash('sha1').update(JSON.stringify([memberId, keysOf(oldItems), keysOf(newItems)])).digest('hex').slice(0, 12);

const matchesResolved = (entry, oldItems, newItems) =>
  JSON.stringify(entry.old) === JSON.stringify(keysOf(oldItems)) && JSON.stringify(entry.new) === JSON.stringify(keysOf(newItems));

/**
 * The open changes of one reviewer, positioned against the current base.
 * @returns [{ id, status: 'open'|'outdated', pos, old: [block], new: [block] }]
 */
function changesOf({ memberId, copyBase, copy, base, resolved = [], orphans = [] }) {
  const o = blocksOf(copyBase).blocks;
  const c = blocksOf(copy).blocks;
  const bb = blocksOf(base).blocks;
  const out = [];
  for (const h of diffBlocks(o, c)) {
    const oldItems = o.slice(h.aStart, h.aEnd);
    const newItems = c.slice(h.bStart, h.bEnd);
    if (resolved.some((r) => matchesResolved(r, oldItems, newItems))) continue;
    let pos;
    if (oldItems.length) {
      pos = locate(bb, oldItems, h.aStart);
    } else if (h.aStart === 0) {
      pos = 0;
    } else {
      const prev = locate(bb, [o[h.aStart - 1]], h.aStart - 1);
      pos = prev === -1 ? -1 : prev + 1;
    }
    out.push({ id: changeId(memberId, oldItems, newItems), status: pos === -1 ? 'outdated' : 'open', pos, old: oldItems, new: newItems });
  }
  for (const orphan of orphans) {
    if (resolved.some((r) => matchesResolved(r, orphan.old, orphan.new))) continue;
    out.push({ id: changeId(memberId, orphan.old, orphan.new), status: 'outdated', pos: -1, old: orphan.old, new: orphan.new });
  }
  return out;
}

/** Apply one change to the base text. Returns the new base prose text. */
function applyChange(baseText, change) {
  const { lead, blocks, eol } = blocksOf(baseText);
  const items = [...blocks.slice(0, change.pos), ...change.new, ...blocks.slice(change.pos + change.old.length)];
  return join(lead, items, eol);
}

/**
 * Bring a reviewer's copy up to date with the base.
 * Rejected changes are reverted first. Returns { copy, conflicts }.
 */
function rebaseCopy({ copyBase, copy, base, rejected = [] }) {
  const o = blocksOf(copyBase);
  let a = blocksOf(copy).blocks;
  for (const r of rejected) {
    const at = locate(a, r.new.map((key) => ({ key })), 0);
    if (at !== -1 && (r.new.length > 0)) {
      const oldItems = r.old.map((key) => o.blocks.find((b) => b.key === key)).filter(Boolean);
      a = [...a.slice(0, at), ...oldItems, ...a.slice(at + r.new.length)];
    } else if (r.new.length === 0) {
      // A rejected deletion: put the blocks back where they were.
      const oldItems = r.old.map((key) => o.blocks.find((b) => b.key === key)).filter(Boolean);
      const firstOld = o.blocks.findIndex((b) => b.key === r.old[0]);
      const prevKey = firstOld > 0 ? o.blocks[firstOld - 1].key : null;
      const at2 = prevKey ? a.findIndex((b) => b.key === prevKey) + 1 : 0;
      a = [...a.slice(0, at2), ...oldItems, ...a.slice(at2)];
    }
  }
  const b = blocksOf(base);
  const merged = merge3(o.blocks, a, b.blocks);
  return { copy: join(b.lead, merged.items, b.eol), conflicts: merged.conflicts };
}

/**
 * Three-way merge of a whole .qmd file, paragraph by paragraph, for merges
 * between branches (main and a review round). Unlike Git's line merge, edits
 * to different paragraphs never conflict, and comment threads are merged by
 * id instead of as text. When both sides changed the same paragraph, `theirs`
 * wins and `ours` is returned in `conflicts` ({ old, new, theirs } blocks).
 */
function mergeQmd(baseText, oursText, theirsText) {
  const o = splitQmd(baseText || '');
  const a = splitQmd(oursText);
  const b = splitQmd(theirsText);
  const { items, conflicts } = merge3(o.blocks, a.blocks, b.blocks, { keepBothInsertions: true });
  const lead = a.lead !== o.lead ? a.lead : b.lead;
  const meta = mergeMeta(o.meta, a.meta, b.meta);
  let text = injectMeta(joinBlocks(lead, items), meta);
  if (b.eol === '\r\n') text = text.replace(/\n/g, '\r\n');
  return { text, conflicts };
}

module.exports = { blocksOf, diffBlocks, merge3, mergeQmd, changesOf, applyChange, rebaseCopy, locate, keysOf };
